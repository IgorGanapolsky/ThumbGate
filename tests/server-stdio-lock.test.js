// tests/server-stdio-lock.test.js
'use strict';

const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const CLI = path.resolve(__dirname, '../bin/cli.js');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-'));
  // Point getFeedbackPaths at our temp dir
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.THUMBGATE_FEEDBACK_DIR;
  // Clean up temp dir
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function freshRequire() {
  // Clear module cache so acquireLock picks up fresh env
  delete require.cache[require.resolve('../adapters/mcp/server-stdio')];
  delete require.cache[require.resolve('../scripts/feedback-loop')];
  return require('../adapters/mcp/server-stdio');
}

// ── No lock file: normal startup ──────────────────────────────────────

test('acquireLock: no existing lock file — creates lock and returns cleanupLock', () => {
  const { acquireLock } = freshRequire();
  const lockPath = path.join(tmpDir, '.mcp-server.lock');

  assert.ok(!fs.existsSync(lockPath), 'lock should not exist before acquire');
  const { lockFile, cleanupLock } = acquireLock();

  assert.ok(fs.existsSync(lockPath), 'lock file should be created');
  const data = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.strictEqual(data.pid, process.pid);
  assert.ok(data.startedAt, 'startedAt should be set');
  assert.strictEqual(typeof cleanupLock, 'function');

  // Cleanup so afterEach can remove the dir
  cleanupLock();
});

// ── Stale lock (dead PID): cleaned up, server continues ──────────────

test('acquireLock: stale lock from dead PID — removes it and acquires new lock', () => {
  const lockPath = path.join(tmpDir, '.mcp-server.lock');
  // PID 2147483647 is almost certainly not running
  const stalePid = 2147483647;
  fs.writeFileSync(lockPath, JSON.stringify({ pid: stalePid, startedAt: '2020-01-01T00:00:00.000Z' }));

  const { acquireLock } = freshRequire();
  // Should NOT exit — stale lock gets cleaned up
  const { lockFile, cleanupLock } = acquireLock();

  assert.ok(fs.existsSync(lockPath), 'new lock file should be written');
  const data = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.strictEqual(data.pid, process.pid, 'lock should now belong to current process');

  cleanupLock();
});

// ── Active lock (live PID, fresh): coexist with per-session lock ─────

test('acquireLock: lock held by active PID (fresh) — creates per-session lock and coexists', () => {
  const lockPath = path.join(tmpDir, '.mcp-server.lock');
  // Use current PID — guaranteed to be running; startedAt is NOW (not stale)
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

  const { acquireLock } = freshRequire();
  const result = acquireLock();

  // Should return a session-scoped lock file instead of exiting
  assert.ok(result.lockFile, 'should return a lock file path');
  assert.ok(result.lockFile.includes(`mcp-server-${process.pid}.lock`), 'lock file should be per-session');
  assert.ok(typeof result.cleanupLock === 'function', 'should return cleanup function');

  // Original lock should still exist (not removed)
  assert.ok(fs.existsSync(lockPath), 'original lock should remain');

  result.cleanupLock();
});

// ── Old lock with live PID: coexist without terminating owner ──────

test('acquireLock: old lock held by live PID — preserves owner and coexists', () => {
  const lockPath = path.join(tmpDir, '.mcp-server.lock');

  // Spawn a real child process so we can prove an old live owner survives.
  const child = require('child_process').spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
  child.unref();
  const childPid = child.pid;

  // Write lock with that PID and an old timestamp
  fs.writeFileSync(lockPath, JSON.stringify({ pid: childPid, startedAt: '2020-01-01T00:00:00.000Z' }));

  try {
    const { acquireLock } = freshRequire();
    const { lockFile, cleanupLock } = acquireLock();

    assert.ok(lockFile.includes(`mcp-server-${process.pid}.lock`), 'should use a per-session lock');
    assert.ok(fs.existsSync(lockPath), 'original lock should remain');
    const data = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    assert.strictEqual(data.pid, childPid, 'original lock should still belong to the live owner');

    assert.doesNotThrow(() => process.kill(childPid, 0), 'live owner must not be terminated because its lock is old');

    cleanupLock();
  } finally {
    try { process.kill(childPid, 'SIGKILL'); } catch { /* cleanup */ }
  }
});

// ── cleanupLock is idempotent ────────────────────────────────────────

test('cleanupLock: calling twice does not throw (idempotent)', () => {
  const { acquireLock } = freshRequire();
  const { cleanupLock } = acquireLock();
  const lockPath = path.join(tmpDir, '.mcp-server.lock');

  assert.ok(fs.existsSync(lockPath), 'lock should exist after acquire');

  // First call removes the file
  cleanupLock();
  assert.ok(!fs.existsSync(lockPath), 'lock should be gone after first cleanup');

  // Second call should NOT throw
  assert.doesNotThrow(() => cleanupLock(), 'second cleanupLock call should be safe');
});

// ── cleanupLock: no throw when file already deleted externally ───────

test('cleanupLock: no throw if lock file was already deleted externally', () => {
  const { acquireLock } = freshRequire();
  const { cleanupLock } = acquireLock();
  const lockPath = path.join(tmpDir, '.mcp-server.lock');

  // Simulate external deletion
  fs.unlinkSync(lockPath);
  assert.doesNotThrow(() => cleanupLock(), 'cleanupLock should handle missing file gracefully');
});

// ── Lock file cleanup on process exit event ──────────────────────────

test('acquireLock: registers exit handler that removes lock file', () => {
  const { acquireLock } = freshRequire();
  const { lockFile } = acquireLock();
  const lockPath = path.join(tmpDir, '.mcp-server.lock');

  assert.ok(fs.existsSync(lockPath), 'lock file should exist');

  // Simulate the 'exit' event by finding and calling the registered listener
  const exitListeners = process.listeners('exit');
  // The last registered 'exit' listener should be our cleanupLock
  const ourListener = exitListeners[exitListeners.length - 1];
  ourListener();

  assert.ok(!fs.existsSync(lockPath), 'lock file should be removed on exit event');

  // Clean up the listener to avoid side effects on other tests
  process.removeListener('exit', ourListener);
});

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

function spawnServe(feedbackDir) {
  return spawn(process.execPath, [CLI, 'serve'], {
    env: {
      ...process.env,
      THUMBGATE_FEEDBACK_DIR: feedbackDir,
      THUMBGATE_NO_TELEMETRY: '1',
    },
    stdio: ['pipe', 'ignore', 'pipe'],
  });
}

test('two live stdio sessions coexist and closing one does not terminate its peer', async () => {
  const first = spawnServe(tmpDir);
  const second = spawnServe(tmpDir);
  try {
    const bothStarted = await waitFor(
      () => isProcessAlive(first.pid) && isProcessAlive(second.pid),
      2000,
    );
    assert.equal(bothStarted, true, 'both MCP sessions should be alive');

    first.stdin.end();
    const firstExited = await waitFor(() => !isProcessAlive(first.pid), 5000);
    assert.equal(firstExited, true, 'session should exit after its own stdin closes');
    assert.equal(isProcessAlive(second.pid), true, 'closing one session must not terminate its live peer');
  } finally {
    try { first.stdin.end(); } catch { /* cleanup */ }
    try { second.stdin.end(); } catch { /* cleanup */ }
    await waitFor(() => !isProcessAlive(first.pid), 1000);
    await waitFor(() => !isProcessAlive(second.pid), 1000);
    if (isProcessAlive(first.pid)) try { process.kill(first.pid, 'SIGKILL'); } catch { /* cleanup */ }
    if (isProcessAlive(second.pid)) try { process.kill(second.pid, 'SIGKILL'); } catch { /* cleanup */ }
  }
});

test('project resolution prefers active project over unscoped launcher roots', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-project-'));
  const runtimeDir = path.join(homeDir, '.thumbgate', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });

  const {
    resolveProjectDir,
    writeActiveProjectState,
  } = require('../scripts/feedback-paths');
  const env = { HOME: homeDir, USERPROFILE: homeDir, PWD: path.parse(homeDir).root };
  try {
    writeActiveProjectState(projectDir, { env });

    for (const cwd of [path.parse(homeDir).root, homeDir, runtimeDir]) {
      assert.equal(
        resolveProjectDir({ cwd, env: { ...env, PWD: cwd } }),
        projectDir,
        `${cwd} must not become a project store when a valid active project exists`,
      );
    }
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('explicit project and feedback scopes remain authoritative', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-home-'));
  const activeProject = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-active-'));
  const explicitProject = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-explicit-'));
  const explicitFeedback = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-feedback-'));
  const { resolveFeedbackDir, resolveProjectDir, writeActiveProjectState } = require('../scripts/feedback-paths');
  const env = { HOME: homeDir, USERPROFILE: homeDir, PWD: path.parse(homeDir).root };
  try {
    writeActiveProjectState(activeProject, { env });
    assert.equal(resolveProjectDir({ cwd: '/', env: { ...env, THUMBGATE_PROJECT_DIR: explicitProject } }), explicitProject);
    assert.equal(resolveProjectDir({ cwd: '/', env: { ...env, CLAUDE_PROJECT_DIR: explicitProject } }), explicitProject);
    assert.equal(resolveFeedbackDir({ cwd: '/', env: { ...env, THUMBGATE_FEEDBACK_DIR: explicitFeedback } }), explicitFeedback);
  } finally {
    for (const dir of [homeDir, activeProject, explicitProject, explicitFeedback]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('project feedback store is stable before and after local directory creation', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-store-project-'));
  const { resolveFeedbackDir } = require('../scripts/feedback-paths');
  const env = { HOME: homeDir, USERPROFILE: homeDir, THUMBGATE_PROJECT_DIR: projectDir };
  try {
    const before = resolveFeedbackDir({ cwd: projectDir, env });
    fs.mkdirSync(path.join(projectDir, '.thumbgate'), { recursive: true });
    const after = resolveFeedbackDir({ cwd: projectDir, env });
    assert.equal(before, path.join(projectDir, '.thumbgate'));
    assert.equal(after, before);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('same-basename projects resolve to isolated local feedback stores', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-home-'));
  const parentA = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-parent-a-'));
  const parentB = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-parent-b-'));
  const projectA = path.join(parentA, 'service');
  const projectB = path.join(parentB, 'service');
  fs.mkdirSync(projectA);
  fs.mkdirSync(projectB);
  const { resolveFeedbackDir } = require('../scripts/feedback-paths');
  try {
    const first = resolveFeedbackDir({
      cwd: projectA,
      env: { HOME: homeDir, USERPROFILE: homeDir, THUMBGATE_PROJECT_DIR: projectA },
    });
    const second = resolveFeedbackDir({
      cwd: projectB,
      env: { HOME: homeDir, USERPROFILE: homeDir, THUMBGATE_PROJECT_DIR: projectB },
    });
    assert.equal(first, path.join(projectA, '.thumbgate'));
    assert.equal(second, path.join(projectB, '.thumbgate'));
    assert.notEqual(first, second);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(parentA, { recursive: true, force: true });
    fs.rmSync(parentB, { recursive: true, force: true });
  }
});

test('explicit feedback directory wins even when a project directory is inherited', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-project-'));
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-explicit-feedback-'));
  const { resolveFeedbackDir } = require('../scripts/feedback-paths');
  try {
    assert.equal(resolveFeedbackDir({
      cwd: projectDir,
      env: {
        HOME: os.homedir(),
        THUMBGATE_PROJECT_DIR: projectDir,
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
      },
    }), feedbackDir);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});
