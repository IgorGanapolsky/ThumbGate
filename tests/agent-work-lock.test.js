'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Point the module's home dir at a throwaway temp dir so the suite never
// touches the real ~/.thumbgate. THUMBGATE_HOME is honored by resolveHomeDir().
let tmpHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'work-lock-test-'));
  process.env.THUMBGATE_HOME = tmpHome;
});

afterEach(() => {
  delete process.env.THUMBGATE_HOME;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function freshRequire() {
  delete require.cache[require.resolve('../scripts/agent-work-lock')];
  return require('../scripts/agent-work-lock');
}

test('first claim succeeds and persists under temp home', () => {
  const { claimWork, getClaimsDir } = freshRequire();
  const result = claimWork('fix:statusline-aggregate', { agentId: 'claude-1' });

  assert.equal(result.acquired, true);
  assert.equal(result.heldBy.agentId, 'claude-1');
  assert.equal(result.heldBy.pid, process.pid);
  assert.ok(getClaimsDir().startsWith(tmpHome), 'claims dir must live under temp home');
  assert.ok(fs.existsSync(result.file), 'claim file should exist on disk');
});

test('second claim of same key by a different agent fails and returns heldBy', () => {
  const { claimWork } = freshRequire();
  const first = claimWork('build:feature-x', { agentId: 'claude-1' });
  assert.equal(first.acquired, true);

  const second = claimWork('build:feature-x', { agentId: 'codex-2' });
  assert.equal(second.acquired, false);
  assert.equal(second.heldBy.agentId, 'claude-1');
  assert.equal(second.heldBy.pid, process.pid);
});

test('same agent re-claiming the same key still does not double-acquire', () => {
  const { claimWork } = freshRequire();
  assert.equal(claimWork('task:a', { agentId: 'claude-1' }).acquired, true);
  // Even the same agent must see it is already held (idempotent guard).
  const again = claimWork('task:a', { agentId: 'claude-1' });
  assert.equal(again.acquired, false);
  assert.equal(again.heldBy.agentId, 'claude-1');
});

test('release frees the lock so another agent can claim', () => {
  const { claimWork, releaseWork } = freshRequire();
  claimWork('task:b', { agentId: 'claude-1' });

  // Wrong agent cannot release.
  const denied = releaseWork('task:b', 'codex-2');
  assert.equal(denied.released, false);
  assert.equal(denied.reason, 'held_by_other');

  // Owner releases successfully.
  const released = releaseWork('task:b', 'claude-1');
  assert.equal(released.released, true);

  // Now a different agent can acquire.
  const reclaimed = claimWork('task:b', { agentId: 'codex-2' });
  assert.equal(reclaimed.acquired, true);
  assert.equal(reclaimed.heldBy.agentId, 'codex-2');
});

test('force release works regardless of holder', () => {
  const { claimWork, releaseWork } = freshRequire();
  claimWork('task:force', { agentId: 'claude-1' });
  const forced = releaseWork('task:force', 'someone-else', { force: true });
  assert.equal(forced.released, true);
});

test('release of an unheld key reports not_held', () => {
  const { releaseWork } = freshRequire();
  const r = releaseWork('never:claimed', 'claude-1');
  assert.equal(r.released, false);
  assert.equal(r.reason, 'not_held');
});

test('an expired claim (ttl elapsed) is reclaimable by another agent', () => {
  const { claimWork } = freshRequire();
  // ttl of 1ms with a live pid -> expires immediately.
  const first = claimWork('task:expired', { agentId: 'claude-1', ttlMs: 1 });
  assert.equal(first.acquired, true);

  // Busy-wait a hair past the ttl without using a blocked sleep.
  const start = Date.now();
  while (Date.now() - start < 5) { /* spin */ }

  const second = claimWork('task:expired', { agentId: 'codex-2' });
  assert.equal(second.acquired, true, 'expired claim must be reclaimable');
  assert.equal(second.heldBy.agentId, 'codex-2');
});

test('a dead-pid claim is reclaimable even within ttl', () => {
  const { claimWork, getClaimsDir, sanitizeKey } = freshRequire();
  // Plant a claim file owned by a pid that cannot be alive.
  const dir = getClaimsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sanitizeKey('task:deadpid')}.json`);
  fs.writeFileSync(file, JSON.stringify({
    key: 'task:deadpid',
    agentId: 'ghost',
    pid: 2147483647, // implausible pid -> ESRCH
    claimedAt: new Date().toISOString(),
    ttlMs: 60 * 60 * 1000,
  }));

  const result = claimWork('task:deadpid', { agentId: 'claude-1' });
  assert.equal(result.acquired, true, 'dead-pid claim must be reclaimable');
  assert.equal(result.heldBy.agentId, 'claude-1');
});

test('two near-simultaneous claims -> exactly one acquires', () => {
  const { claimWork } = freshRequire();
  const a = claimWork('task:race', { agentId: 'agent-A', pid: process.pid });
  const b = claimWork('task:race', { agentId: 'agent-B', pid: process.pid });
  const winners = [a, b].filter((r) => r.acquired);
  assert.equal(winners.length, 1, 'exactly one claim must win the race');
  assert.equal(winners[0].heldBy.agentId, 'agent-A');
});

test('listClaims reports live and reclaimable claims', () => {
  const { claimWork, listClaims } = freshRequire();
  claimWork('task:live', { agentId: 'claude-1' });
  claimWork('task:stale', { agentId: 'claude-1', ttlMs: 1 });
  const start = Date.now();
  while (Date.now() - start < 5) { /* spin past ttl */ }

  const all = listClaims();
  const byKey = Object.fromEntries(all.map((c) => [c.key, c]));
  assert.equal(byKey['task:live'].live, true);
  assert.equal(byKey['task:live'].reclaimable, false);
  assert.equal(byKey['task:stale'].live, false);
  assert.equal(byKey['task:stale'].reclaimable, true);

  const liveOnly = listClaims({ includeStale: false });
  assert.ok(liveOnly.every((c) => c.live), 'includeStale:false returns only live claims');
  assert.ok(liveOnly.some((c) => c.key === 'task:live'));
});

test('listClaims on an empty store returns []', () => {
  const { listClaims } = freshRequire();
  assert.deepEqual(listClaims(), []);
});

test('distinct keys that sanitize similarly do not collide', () => {
  const { claimWork } = freshRequire();
  const a = claimWork('a/b', { agentId: 'x' });
  const b = claimWork('a_b', { agentId: 'y' });
  assert.equal(a.acquired, true);
  assert.equal(b.acquired, true, 'a/b and a_b must map to different claim files');
  assert.notEqual(a.file, b.file);
});
