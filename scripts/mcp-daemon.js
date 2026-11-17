'use strict';

// Shared ThumbGate MCP daemon: one long-lived process serves every client
// session on this machine. Each client runs a thin shim (scripts/mcp-shim.js)
// that forwards JSON-RPC over a Unix socket. Wire format is NDJSON after a
// one-line hello that carries the client's env and cwd.

const fs = require('fs');
const net = require('net');
const path = require('path');
const {
  ensureRunDir,
  getRuntimePaths,
  numberFromEnv,
} = require('./mcp-runtime');
const {
  createSession,
  installSessionContext,
  runInSession,
} = require('./mcp-session-context');

const DEFAULT_IDLE_EXIT_MS = 5 * 60 * 1000;

function log(message) {
  process.stderr.write(`[thumbgate-daemon ${new Date().toISOString()}] ${message}\n`);
}

function probeSocket(socketPath) {
  return new Promise((resolve) => {
    const probe = net.connect(socketPath);
    const finish = (alive) => { probe.destroy(); resolve(alive); };
    probe.once('connect', () => finish(true));
    probe.once('error', () => finish(false));
    setTimeout(() => finish(false), 1000).unref();
  });
}

function errorLine(id, code, message) {
  return `${JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })}\n`;
}

function createConnectionHandler(server, handlers) {
  return (socket) => {
    let buffer = '';
    let session = null;
    let chain = Promise.resolve();
    server.connections += 1;
    handlers.onConnectionChange();

    const handleHello = (hello) => {
      session = createSession({ env: hello.env, cwd: hello.cwd });
      // Ack first: the shim treats a missing ack as a wedged daemon.
      socket.write(`${JSON.stringify({ tgDaemon: 1, pid: process.pid })}\n`);
      // Queued ahead of this connection's requests so they carry the identity.
      chain = chain
        .then(() => new Promise((resolve) => setImmediate(resolve)))
        .then(() => runInSession(session, () => handlers.registerSessionIdentity()));
    };

    const handleRequestLine = async (line) => {
      let request;
      try {
        request = JSON.parse(line);
      } catch (err) {
        socket.write(errorLine(null, -32700, err.message));
        return;
      }
      try {
        const result = await runInSession(session, () => handlers.handleRequest(request));
        if (result !== null && !socket.destroyed) {
          socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id ?? null, result })}\n`);
        }
      } catch (err) {
        if (!socket.destroyed) socket.write(errorLine(request.id, -32603, err.message));
      }
    };

    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line) continue;
        if (!session) {
          let hello;
          try { hello = JSON.parse(line); } catch { socket.destroy(); return; }
          if (!hello || hello.tgShim !== 1) { socket.destroy(); return; }
          handleHello(hello);
          continue;
        }
        chain = chain.then(() => handleRequestLine(line));
      }
    });
    const closed = () => {
      if (socket.tgClosed) return;
      socket.tgClosed = true;
      server.connections -= 1;
      handlers.onConnectionChange();
    };
    socket.on('close', closed);
    socket.on('error', () => socket.destroy());
  };
}

async function listen(server, socketPath) {
  const attempt = () => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  try {
    await attempt();
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    if (await probeSocket(socketPath)) return false; // another daemon owns it
    try { fs.unlinkSync(socketPath); } catch { /* raced with another cleaner */ }
    await attempt();
  }
  return true;
}

async function run(options = {}) {
  const paths = getRuntimePaths();
  ensureRunDir(paths.dir);
  const idleMs = numberFromEnv('THUMBGATE_DAEMON_IDLE_MS', DEFAULT_IDLE_EXIT_MS);

  installSessionContext();

  // Loaded after the session context is installed so any module-level env
  // read is routed through it. Heavy: this is the one copy every client shares.
  const serverStdio = require('../adapters/mcp/server-stdio');

  const server = net.createServer();
  server.connections = 0;
  let idleTimer = null;
  const onConnectionChange = () => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (server.connections === 0) {
      idleTimer = setTimeout(() => shutdown('idle'), idleMs);
      idleTimer.unref();
    }
  };

  const handlers = {
    handleRequest: serverStdio.handleRequest,
    registerSessionIdentity: serverStdio.registerSessionIdentity,
    onConnectionChange,
  };
  server.on('connection', createConnectionHandler(server, handlers));

  const owner = await listen(server, paths.socket);
  if (!owner) {
    log('another daemon already owns the socket; exiting');
    try { fs.unlinkSync(`${paths.pidFile}.starting`); } catch { /* not ours */ }
    return false;
  }
  try { fs.chmodSync(paths.socket, 0o600); } catch { /* best effort */ }
  fs.writeFileSync(paths.pidFile, String(process.pid), { mode: 0o600 });
  try { fs.unlinkSync(`${paths.pidFile}.starting`); } catch { /* no claim file */ }

  let closing = false;
  function shutdown(reason) {
    if (closing) return;
    closing = true;
    log(`shutting down (${reason})`);
    try { fs.unlinkSync(paths.socket); } catch { /* already gone */ }
    try {
      if (fs.readFileSync(paths.pidFile, 'utf8').trim() === String(process.pid)) fs.unlinkSync(paths.pidFile);
    } catch { /* already gone */ }
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  // One client's bug must not take every session down.
  process.on('uncaughtException', (err) => log(`uncaughtException: ${err && err.stack ? err.stack : err}`));
  process.on('unhandledRejection', (err) => log(`unhandledRejection: ${err && err.stack ? err.stack : err}`));

  // Once per daemon instead of once per client session.
  try {
    require('./codex-self-heal').repairCodexHooks();
  } catch { /* self-heal is best-effort */ }
  try {
    require('./jsonl-watcher').watch();
  } catch { /* watcher is non-critical */ }

  onConnectionChange();
  log(`listening on ${path.basename(paths.socket)} pid ${process.pid}`);
  if (options.onReady) options.onReady(paths);
  return true;
}

module.exports = { run };
