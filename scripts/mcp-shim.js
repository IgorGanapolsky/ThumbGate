'use strict';

// Thin per-client stdio shim for the shared ThumbGate MCP daemon.
//
// `thumbgate serve` runs this instead of a full server. It speaks MCP over
// stdio to the client (framed or NDJSON, auto-detected) and forwards each
// JSON-RPC message to the shared daemon over a Unix socket. Keep the require
// list short: this process exists once per agent session, so its resident
// memory is what the shared design is meant to keep small.
//
// Failure behaviour (it never leaves a client waiting forever):
//   - daemon dies mid-request: every in-flight request gets a JSON-RPC error,
//     and the next request starts a fresh daemon;
//   - daemon stops answering: a request that outlives
//     THUMBGATE_SERVE_REQUEST_TIMEOUT_MS gets an error, the shim probes the
//     daemon, and kills it if the probe also gets no answer;
//   - daemon cannot be started: the shim falls back to the standalone server.

const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { tryParseMessage, frameJsonRpc } = require('./mcp-framing');
const { ensureRunDir, getRuntimePaths, numberFromEnv } = require('./mcp-runtime');

const ERROR_CODE = -32000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryConnect(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

// Sends the hello and waits for the daemon's ack; resolves with { socket, rest }.
function handshake(socket, ackTimeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(Object.assign(new Error('daemon did not answer the hello'), { code: 'EDAEMONBLOCKED' }));
    }, ackTimeoutMs);
    const onData = (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      cleanup();
      resolve({ socket, rest: buffer.slice(newline + 1) });
    };
    const onFail = (err) => { cleanup(); reject(err || new Error('daemon closed during hello')); };
    function cleanup() {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', onFail);
      socket.removeListener('close', onFail);
    }
    socket.setEncoding('utf8');
    socket.on('data', onData);
    socket.once('error', onFail);
    socket.once('close', () => onFail());
    socket.write(`${JSON.stringify({ tgShim: 1, env: process.env, cwd: process.cwd() })}\n`);
  });
}

// Only one shim spawns the daemon: a claim file created with 'wx' marks a start
// in progress, so N clients opening at once do not launch N cold server loads.
function claimDaemonStart(paths) {
  const claim = `${paths.pidFile}.starting`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.closeSync(fs.openSync(claim, 'wx', 0o600));
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') return false;
      try {
        if (Date.now() - fs.statSync(claim).mtimeMs < 60000) return false;
        fs.unlinkSync(claim); // abandoned claim from a daemon that never started
      } catch { return false; }
    }
  }
  return false;
}

function spawnDaemon(paths) {
  ensureRunDir(paths.dir);
  if (!claimDaemonStart(paths)) return;
  const logFd = fs.openSync(paths.logFile, 'a', 0o600);
  const child = spawn(process.execPath, [process.argv[1], 'serve', '--daemon'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  child.unref();
  fs.closeSync(logFd);
}

async function connectDaemon(paths, { startTimeoutMs, ackTimeoutMs }) {
  const deadline = Date.now() + startTimeoutMs;
  let spawned = false;
  for (;;) {
    try {
      const socket = await tryConnect(paths.socket);
      return await handshake(socket, ackTimeoutMs);
    } catch (err) {
      if (err.code === 'EDAEMONBLOCKED') throw err;
      if (Date.now() >= deadline) throw err;
      if (!spawned) {
        spawned = true;
        spawnDaemon(paths);
      }
      await sleep(100);
    }
  }
}

function daemonPidFromFile(paths) {
  try {
    const pid = Number(fs.readFileSync(paths.pidFile, 'utf8').trim());
    return Number.isInteger(pid) && pid > 1 ? pid : null;
  } catch {
    return null;
  }
}

function killBlockedDaemon(paths) {
  const pid = daemonPidFromFile(paths);
  if (!pid) return false;
  try {
    // Guard against a recycled pid: only kill what is still a thumbgate daemon.
    const command = require('child_process').execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    if (!/serve\s+--daemon/.test(command)) return false;
    process.kill(pid, 'SIGKILL');
  } catch {
    return false;
  }
  try { fs.unlinkSync(paths.socket); } catch { /* already gone */ }
  try { fs.unlinkSync(paths.pidFile); } catch { /* already gone */ }
  return true;
}

async function runShim() {
  const paths = getRuntimePaths();
  const requestTimeoutMs = numberFromEnv('THUMBGATE_SERVE_REQUEST_TIMEOUT_MS', 120000);
  const startTimeoutMs = numberFromEnv('THUMBGATE_SERVE_START_TIMEOUT_MS', 45000);
  const ackTimeoutMs = numberFromEnv('THUMBGATE_SERVE_ACK_TIMEOUT_MS', 20000);
  const connectOptions = { startTimeoutMs, ackTimeoutMs };

  let transport = process.env.MCP_TRANSPORT || null;
  let daemon = null; // { socket }
  let connecting = null;
  let stdinEnded = false;
  let probing = false;
  const queue = [];
  const pending = new Map(); // id -> timeout handle

  const writeClient = (body) => process.stdout.write(frameJsonRpc(body, transport || 'framed'));
  const replyError = (id, message) => {
    writeClient(JSON.stringify({ jsonrpc: '2.0', id, error: { code: ERROR_CODE, message } }));
  };
  const settle = (id) => {
    const timer = pending.get(id);
    if (timer === undefined) return false;
    clearTimeout(timer);
    pending.delete(id);
    return true;
  };
  const maybeExit = () => {
    if (stdinEnded && pending.size === 0 && queue.length === 0) process.exit(0);
  };
  const failPending = (message) => {
    for (const id of [...pending.keys()]) {
      settle(id);
      replyError(id, message);
    }
    for (const item of queue.splice(0)) {
      if (item.id !== undefined && item.id !== null && settle(item.id)) replyError(item.id, message);
    }
    maybeExit();
  };

  function attach({ socket, rest }) {
    daemon = { socket };
    let buffer = rest;
    const drain = () => {
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.trim()) continue;
        let id;
        try { id = JSON.parse(line).id; } catch { continue; }
        if (id !== undefined && id !== null && !settle(id)) continue; // timed out already
        writeClient(line);
        maybeExit();
      }
    };
    socket.on('data', (chunk) => { buffer += chunk; drain(); });
    const lost = () => {
      if (!daemon || daemon.socket !== socket) return;
      daemon = null;
      failPending('ThumbGate shared daemon connection was lost; retry the call');
    };
    socket.on('close', lost);
    socket.on('error', () => socket.destroy());
    drain();
  }

  async function ensureConnected() {
    if (daemon) { flush(); return; }
    if (!connecting) {
      connecting = connectDaemon(paths, connectOptions)
        .then((conn) => { attach(conn); })
        .catch((err) => {
          if (err.code === 'EDAEMONBLOCKED') killBlockedDaemon(paths);
          failPending(`ThumbGate shared daemon is unavailable: ${err.message}`);
        })
        .finally(() => { connecting = null; });
    }
    await connecting;
    if (daemon) flush();
  }

  function flush() {
    for (const item of queue.splice(0)) {
      if (daemon) daemon.socket.write(`${JSON.stringify(item.message)}\n`);
    }
  }

  // A fresh hello that gets no ack means the daemon is wedged (a sync-heavy
  // tool call blocks its event loop). Kill it so every client recovers.
  async function probeAfterTimeout() {
    if (probing) return;
    probing = true;
    try {
      const probeAck = numberFromEnv('THUMBGATE_SERVE_PROBE_MS', 3000);
      const socket = await tryConnect(paths.socket);
      const conn = await handshake(socket, probeAck);
      conn.socket.destroy();
    } catch {
      killBlockedDaemon(paths);
      if (daemon) daemon.socket.destroy();
    } finally {
      probing = false;
    }
  }

  function send(message) {
    const id = message.id;
    if (id !== undefined && id !== null) {
      pending.set(id, setTimeout(() => {
        if (!settle(id)) return;
        replyError(id, `ThumbGate request timed out after ${requestTimeoutMs} ms`);
        probeAfterTimeout();
        maybeExit();
      }, requestTimeoutMs));
    }
    queue.push({ id, message });
    ensureConnected();
  }

  let inbound = Buffer.alloc(0);
  const startReading = () => {
  process.stdin.on('data', (chunk) => {
    inbound = Buffer.concat([inbound, Buffer.from(chunk)]);
    while (inbound.length > 0) {
      let parsed;
      try {
        parsed = tryParseMessage(inbound);
      } catch (err) {
        if (!transport && err.transport) transport = err.transport;
        writeClient(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: err.jsonrpcCode || -32700, message: err.message } }));
        inbound = Buffer.alloc(0);
        return;
      }
      if (!parsed) return;
      inbound = parsed.remaining;
      if (!parsed.request) continue;
      if (!transport && parsed.transport) transport = parsed.transport;
      send(parsed.request);
    }
  });
  const onStdinEnd = () => { stdinEnded = true; maybeExit(); };
  process.stdin.on('end', onStdinEnd);
  process.stdin.on('close', onStdinEnd);
  process.stdin.resume();
  };

  // Connect (and start the daemon) before reading stdin so a failure can still
  // fall back to the standalone server with the client's bytes untouched.
  const first = await connectDaemon(paths, connectOptions);
  attach(first);
  startReading();
}

async function main() {
  if (process.env.THUMBGATE_SERVE_MODE === 'standalone') {
    require('./mcp-standalone').runStandalone();
    return;
  }
  try {
    await runShim();
  } catch (err) {
    process.stderr.write(`[thumbgate] shared daemon unavailable (${err.message}); running standalone\n`);
    require('./mcp-standalone').runStandalone();
  }
}

module.exports = { main };
