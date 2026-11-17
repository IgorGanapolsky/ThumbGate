'use strict';

// Shared MCP daemon + thin shim (scripts/mcp-daemon.js, scripts/mcp-shim.js).
// Every test starts its own daemon in a private run dir, so none of it can
// attach to a daemon that is serving real agent sessions.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
const IS_WINDOWS = process.platform === 'win32';
const skip = IS_WINDOWS ? 'Unix sockets and signals are exercised on POSIX only' : false;

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `tg-shared-${label}-`));
}

function baseEnv(runDir, feedbackDir, extra = {}) {
  return {
    ...process.env,
    THUMBGATE_RUN_DIR: runDir,
    THUMBGATE_FEEDBACK_DIR: feedbackDir,
    THUMBGATE_PROJECT_DIR: feedbackDir,
    THUMBGATE_DAEMON_IDLE_MS: '60000',
    THUMBGATE_API_URL: 'http://127.0.0.1:1',
    THUMBGATE_NO_TELEMETRY: '1',
    THUMBGATE_PROOF_DIR: path.join(feedbackDir, 'proof'),
    THUMBGATE_NO_RATE_LIMIT: '1',
    THUMBGATE_DISABLE_MCP_FIREWALL: '1',
    THUMBGATE_MCP_PROFILE: 'default',
    ...extra,
  };
}

class Client {
  constructor(env, cwd, args = ['serve']) {
    this.child = spawn(process.execPath, [CLI, ...args], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.buffer = '';
    this.waiters = new Map();
    this.nextId = 1;
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf('\n');
      while (newline !== -1) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        newline = this.buffer.indexOf('\n');
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        const waiter = this.waiters.get(message.id);
        if (waiter) { this.waiters.delete(message.id); waiter(message); }
      }
    });
  }

  request(method, params, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error(`no response to ${method} within ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiters.set(id, (message) => { clearTimeout(timer); resolve(message); });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async call(name, args, timeoutMs) {
    const response = await this.request('tools/call', { name, arguments: args }, timeoutMs);
    if (response.error) throw new Error(response.error.message);
    return JSON.parse(response.result.content[0].text);
  }

  close() {
    try { this.child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

function daemonPid(runDir) {
  const pidFile = fs.readdirSync(runDir).find((name) => name.endsWith('.pid'));
  return pidFile ? Number(fs.readFileSync(path.join(runDir, pidFile), 'utf8')) : null;
}

function stopDaemon(runDir) {
  try {
    const pid = daemonPid(runDir);
    if (pid) { process.kill(pid, 'SIGCONT'); process.kill(pid, 'SIGKILL'); }
  } catch { /* already gone */ }
}

function waitFor(predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      let value;
      try { value = predicate(); } catch { value = null; }
      if (value) return resolve(value);
      if (Date.now() - started > timeoutMs) return reject(new Error(`timed out waiting for ${label}`));
      return setTimeout(tick, 50);
    };
    tick();
  });
}

test('two shims share one daemon and keep their feedback separate', { skip, timeout: 120000 }, async () => {
  const runDir = tempDir('run');
  const dirA = tempDir('a');
  const dirB = tempDir('b');
  const a = new Client(baseEnv(runDir, dirA), dirA);
  const b = new Client(baseEnv(runDir, dirB), dirB);
  try {
    await Promise.all([a.request('initialize', {}), b.request('initialize', {})]);

    const [capA, capB] = await Promise.all([
      a.call('capture_feedback', {
        signal: 'down',
        context: 'ALPHA-MARKER deploy skipped the health check',
        whatWentWrong: 'ALPHA-MARKER no curl after deploy',
        whatToChange: 'ALPHA-MARKER always curl /health after deploy',
        tags: ['alpha'],
      }),
      b.call('capture_feedback', {
        signal: 'down',
        context: 'BRAVO-MARKER migration ran against the wrong database',
        whatWentWrong: 'BRAVO-MARKER wrong database target',
        whatToChange: 'BRAVO-MARKER confirm the database name first',
        tags: ['bravo'],
      }),
    ]);
    assert.ok(capA.feedbackEvent, 'client A capture was accepted');
    assert.ok(capB.feedbackEvent, 'client B capture was accepted');

    const logA = fs.readFileSync(path.join(dirA, 'feedback-log.jsonl'), 'utf8');
    const logB = fs.readFileSync(path.join(dirB, 'feedback-log.jsonl'), 'utf8');
    assert.match(logA, /ALPHA-MARKER/);
    assert.doesNotMatch(logA, /BRAVO-MARKER/, 'A\'s feedback dir holds none of B\'s feedback');
    assert.match(logB, /BRAVO-MARKER/);
    assert.doesNotMatch(logB, /ALPHA-MARKER/, 'B\'s feedback dir holds none of A\'s feedback');

    const [lessonsA, lessonsB] = await Promise.all([
      a.call('retrieve_lessons', { toolName: 'Bash', actionContext: 'ALPHA-MARKER deploy curl health check' }),
      b.call('retrieve_lessons', { toolName: 'Bash', actionContext: 'BRAVO-MARKER migration database target' }),
    ]);
    const textA = JSON.stringify(lessonsA);
    const textB = JSON.stringify(lessonsB);
    assert.doesNotMatch(textA, /BRAVO-MARKER/, 'A never retrieves B\'s lesson');
    assert.doesNotMatch(textB, /ALPHA-MARKER/, 'B never retrieves A\'s lesson');

    const daemons = fs.readdirSync(runDir).filter((name) => name.endsWith('.pid'));
    assert.equal(daemons.length, 1, 'both shims attached to a single daemon');
  } finally {
    a.close();
    b.close();
    stopDaemon(runDir);
  }
});

test('shim tools/list matches the standalone server', { skip, timeout: 120000 }, async () => {
  const runDir = tempDir('run');
  const dir = tempDir('list');
  const shared = new Client(baseEnv(runDir, dir), dir);
  const standalone = new Client(baseEnv(runDir, dir, { THUMBGATE_SERVE_MODE: 'standalone' }), dir);
  try {
    const [sharedList, standaloneList] = await Promise.all([
      shared.request('tools/list', {}),
      standalone.request('tools/list', {}),
    ]);
    assert.deepEqual(sharedList.result, standaloneList.result);
    assert.ok(sharedList.result.tools.length > 0);
  } finally {
    shared.close();
    standalone.close();
    stopDaemon(runDir);
  }
});

test('a killed daemon returns an MCP error for in-flight calls, then restarts', { skip, timeout: 120000 }, async () => {
  const runDir = tempDir('run');
  const dir = tempDir('kill');
  const client = new Client(baseEnv(runDir, dir), dir);
  try {
    await client.request('initialize', {});
    const firstPid = daemonPid(runDir);
    assert.ok(firstPid, 'daemon is running');

    process.kill(firstPid, 'SIGSTOP'); // the call stays in flight
    const inFlight = client.request('tools/list', {}, 20000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    process.kill(firstPid, 'SIGKILL');

    const failed = await inFlight;
    assert.ok(failed.error, 'in-flight call got an error response, not a hang');
    assert.match(failed.error.message, /daemon/i);

    const recovered = await client.request('tools/list', {}, 30000);
    assert.ok(recovered.result && recovered.result.tools.length > 0, 'next call works after restart');
    const secondPid = await waitFor(() => { const pid = daemonPid(runDir); return pid && pid !== firstPid ? pid : null; }, 5000, 'new daemon pid');
    assert.notEqual(secondPid, firstPid);
  } finally {
    client.close();
    stopDaemon(runDir);
  }
});

test('a stalled daemon times out the call, is killed, and the next call works', { skip, timeout: 120000 }, async () => {
  const runDir = tempDir('run');
  const dir = tempDir('stall');
  const client = new Client(baseEnv(runDir, dir, {
    THUMBGATE_SERVE_REQUEST_TIMEOUT_MS: '1500',
    THUMBGATE_SERVE_PROBE_MS: '500',
  }), dir);
  try {
    await client.request('initialize', {});
    const firstPid = daemonPid(runDir);
    process.kill(firstPid, 'SIGSTOP'); // socket stays open: no close event

    const started = Date.now();
    const stalled = await client.request('tools/list', {}, 20000);
    assert.ok(stalled.error, 'stalled call returned an error');
    assert.match(stalled.error.message, /timed out/i);
    assert.ok(Date.now() - started < 10000, 'error arrived promptly');

    await waitFor(() => {
      try { process.kill(firstPid, 0); return false; } catch { return true; }
    }, 10000, 'stalled daemon to be killed');

    const recovered = await client.request('tools/list', {}, 30000);
    assert.ok(recovered.result && recovered.result.tools.length > 0, 'next call works on a fresh daemon');
  } finally {
    client.close();
    stopDaemon(runDir);
  }
});

test('the shim falls back to the standalone server when the daemon cannot start', { skip, timeout: 120000 }, async () => {
  const dir = tempDir('fallback');
  // A run dir that is a file makes the daemon unable to bind its socket.
  const blocked = path.join(dir, 'not-a-dir');
  fs.writeFileSync(blocked, 'x');
  const client = new Client(baseEnv(blocked, dir, { THUMBGATE_SERVE_START_TIMEOUT_MS: '1500' }), dir);
  try {
    const response = await client.request('tools/list', {}, 60000);
    assert.ok(response.result && response.result.tools.length > 0, 'standalone server answered');
  } finally {
    client.close();
  }
});

test('session context gives each async call its own env and cwd', async () => {
  const {
    createSession,
    installSessionContext,
    runInSession,
  } = require('../scripts/mcp-session-context');
  const realEnv = process.env;
  const realCwd = process.cwd;
  installSessionContext();
  try {
    const one = createSession({ env: { TG_PROBE: 'one', PATH: '/bin' }, cwd: '/tmp/one' });
    const two = createSession({ env: { TG_PROBE: 'two' }, cwd: '/tmp/two' });
    const read = async (session) => runInSession(session, async () => {
      await new Promise((resolve) => setImmediate(resolve));
      process.env.TG_WRITTEN = process.env.TG_PROBE;
      return [process.env.TG_PROBE, process.cwd(), process.env.TG_WRITTEN, Object.keys(process.env).sort().join(',')];
    });
    const [r1, r2] = await Promise.all([read(one), read(two)]);
    assert.deepEqual(r1, ['one', '/tmp/one', 'one', 'PATH,TG_PROBE,TG_WRITTEN']);
    assert.deepEqual(r2, ['two', '/tmp/two', 'two', 'TG_PROBE,TG_WRITTEN']);
    assert.equal(process.env.TG_PROBE, realEnv.TG_PROBE, 'daemon-level env is untouched');
    assert.equal(execFileSync(process.execPath, ['-e', 'process.stdout.write(process.env.TG_X||"")'], { env: { ...realEnv, TG_X: 'child' }, encoding: 'utf8' }), 'child');
  } finally {
    process.env = realEnv;
    process.cwd = realCwd;
  }
});

test('the shim answers Content-Length framed clients in kind', { skip, timeout: 120000 }, async () => {
  const runDir = tempDir('run');
  const dir = tempDir('framed');
  const child = spawn(process.execPath, [CLI, 'serve'], { env: baseEnv(runDir, dir), cwd: dir, stdio: ['pipe', 'pipe', 'ignore'] });
  try {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    const raw = await new Promise((resolve, reject) => {
      let data = '';
      const timer = setTimeout(() => reject(new Error('no framed response')), 30000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        data += chunk;
        if (/\r\n\r\n.*\}$/s.test(data)) { clearTimeout(timer); resolve(data); }
      });
    });
    assert.match(raw, /^Content-Length: \d+\r\n\r\n\{"jsonrpc":"2\.0","id":7,"result":\{\}\}$/);
  } finally {
    child.kill('SIGKILL');
    stopDaemon(runDir);
  }
});

test('an idle daemon exits once its last client is gone', { skip, timeout: 120000 }, async () => {
  const runDir = tempDir('run');
  const dir = tempDir('idle');
  const client = new Client(baseEnv(runDir, dir, { THUMBGATE_DAEMON_IDLE_MS: '1000' }), dir);
  try {
    await client.request('initialize', {});
    const pid = daemonPid(runDir);
    assert.ok(pid);
    client.close();
    await waitFor(() => {
      try { process.kill(pid, 0); return false; } catch { return true; }
    }, 15000, 'idle daemon to exit');
    assert.equal(fs.readdirSync(runDir).some((name) => name.endsWith('.sock')), false, 'socket file removed');
  } finally {
    client.close();
    stopDaemon(runDir);
  }
});
