// tests/server-stdio-lock.test.js
'use strict';

const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-'));
  // Point getFeedbackPaths at our temp dir
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.RLHF_FEEDBACK_DIR;
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

// ── Active lock (live PID): process.exit(1) ──────────────────────────

test('acquireLock: lock held by active PID — calls process.exit(1)', () => {
  const lockPath = path.join(tmpDir, '.mcp-server.lock');
  // Use current PID — guaranteed to be running
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

  // Mock process.exit to capture the call instead of actually exiting
  const exitMock = mock.fn();
  const origExit = process.exit;
  process.exit = exitMock;

  try {
    const { acquireLock } = freshRequire();
    acquireLock();
    assert.strictEqual(exitMock.mock.calls.length, 1, 'process.exit should be called once');
    assert.strictEqual(exitMock.mock.calls[0].arguments[0], 1, 'exit code should be 1');
  } finally {
    process.exit = origExit;
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
