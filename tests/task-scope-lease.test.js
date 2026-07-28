'use strict';

// Task-scope leases: capability-scoped authority that expires.
//
// ThumbGate already had the two halves separately — `taskScope.allowedPaths` scopes authority
// to a set of paths, and `approveProtectedAction` carries a TTL — but never combined. A task
// scope was permanent: once declared it granted its paths forever, which is precisely what a
// standing approval does and precisely what it should not.
//
// THE PROPERTY THAT MATTERS, and the reason this file exists: a task scope is a RESTRICTION,
// so the lazy implementation of expiry (drop it when it lapses) would make the agent MORE
// powerful the moment its lease ran out. Expiry has to revoke authority, not remove a boundary.
// Several tests below exist only to pin that direction.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gatesEngine = require('../scripts/gates-engine.js');
const { setTaskScope, getScopeState, isTaskScopeExpired } = gatesEngine;

const ORIGINAL = {
  GOVERNANCE_STATE_PATH: gatesEngine.GOVERNANCE_STATE_PATH,
  STATE_PATH: gatesEngine.STATE_PATH,
  CONSTRAINTS_PATH: gatesEngine.CONSTRAINTS_PATH,
};

let sandbox;

test.beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-lease-'));
  gatesEngine.GOVERNANCE_STATE_PATH = path.join(sandbox, 'governance-state.json');
  gatesEngine.STATE_PATH = path.join(sandbox, 'gate-state.json');
  gatesEngine.CONSTRAINTS_PATH = path.join(sandbox, 'session-constraints.json');
});

test.afterEach(() => {
  Object.assign(gatesEngine, ORIGINAL);
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test('a scope declared without ttlMs is permanent — the historical contract is unchanged', () => {
  const scope = setTaskScope({ allowedPaths: ['src/**'], summary: 'refactor' });
  assert.strictEqual(scope.expiresAt, null, 'a scope with no lease must not acquire an expiry');
  assert.strictEqual(scope.leaseMs, null);
  // Even far in the future it is still live.
  assert.strictEqual(isTaskScopeExpired(scope, Date.now() + 365 * 24 * 3600 * 1000), false);
});

test('a scope declared with ttlMs becomes a lease with a concrete deadline', () => {
  const before = Date.now();
  const scope = setTaskScope({ allowedPaths: ['src/**'], ttlMs: 90 * 1000 });
  assert.ok(Number.isFinite(scope.expiresAt), 'lease has no expiresAt');
  assert.ok(scope.expiresAt > before, 'lease expires in the past');
  assert.ok(scope.leaseMs >= 60 * 1000, 'lease length was not recorded');
});

test('scopes older than their lease are expired; younger ones are not', () => {
  const scope = { allowedPaths: ['src/**'], expiresAt: 10_000 };
  assert.strictEqual(isTaskScopeExpired(scope, 9_999), false);
  assert.strictEqual(isTaskScopeExpired(scope, 10_000), true, 'boundary must expire, not linger');
  assert.strictEqual(isTaskScopeExpired(scope, 10_001), true);
});

test('a live lease still permits work inside its paths and blocks work outside', () => {
  const scope = setTaskScope({ allowedPaths: ['src/**'], ttlMs: 15 * 60 * 1000 });
  const now = Date.now();

  assert.strictEqual(
    gatesEngine.buildTaskScopeViolation(scope, ['src/app.js'], now),
    null,
    'a live lease must not block work inside its own paths',
  );
  const outside = gatesEngine.buildTaskScopeViolation(scope, ['infra/deploy.tf'], now);
  assert.ok(outside, 'work outside the lease should still be a violation');
  assert.strictEqual(outside.reasonCode, 'outside_declared_scope');
});

test('THE FAIL-CLOSED PROPERTY: an expired lease authorises nothing, including its own paths', () => {
  const scope = setTaskScope({ allowedPaths: ['src/**'], ttlMs: 90 * 1000 });
  const afterExpiry = scope.expiresAt + 1;

  const violation = gatesEngine.buildTaskScopeViolation(scope, ['src/app.js'], afterExpiry);
  assert.ok(violation, 'an expired lease still granted authority — expiry failed OPEN');
  assert.strictEqual(violation.reasonCode, 'expired_task_scope');
  assert.deepEqual(violation.outsideFiles, ['src/app.js'],
    'every affected file must be outside an expired lease');
});

test('expiry must never widen what the agent may touch', () => {
  // The regression this is really guarding: if expiry were implemented by deleting the scope,
  // a file that was blocked while the lease was live would become allowed once it lapsed.
  const scope = setTaskScope({ allowedPaths: ['src/**'], ttlMs: 90 * 1000 });
  const live = scope.expiresAt - 1;
  const dead = scope.expiresAt + 1;

  for (const file of ['src/app.js', 'infra/deploy.tf']) {
    const whileLive = gatesEngine.buildTaskScopeViolation(scope, [file], live);
    const whileDead = gatesEngine.buildTaskScopeViolation(scope, [file], dead);
    if (whileLive !== null) {
      assert.ok(whileDead !== null, `${file} was blocked under a live lease but allowed once it expired`);
    }
    // And the stronger claim: nothing at all is permitted after expiry.
    assert.ok(whileDead !== null, `${file} was permitted by an expired lease`);
  }
});

test('an expired lease is visible, not silently vanished', () => {
  const scope = setTaskScope({ allowedPaths: ['src/**'], ttlMs: 60 * 1000 });
  // Rewind the stored deadline so the persisted scope is already lapsed.
  const statePath = gatesEngine.GOVERNANCE_STATE_PATH;
  const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  raw.taskScope.expiresAt = Date.now() - 1000;
  fs.writeFileSync(statePath, JSON.stringify(raw));

  const state = getScopeState();
  assert.ok(state.taskScope, 'the lapsed scope was deleted — "lease expired" is now '
    + 'indistinguishable from "no scope was ever declared"');
  assert.strictEqual(state.taskScope.expired, true, 'lapsed lease is not marked expired');
  assert.deepEqual(state.taskScope.allowedPaths, ['src/**'],
    'the operator can no longer see what the lease used to grant');
  assert.strictEqual(scope.allowedPaths[0], 'src/**');
});

test('a live lease is reported as not expired', () => {
  setTaskScope({ allowedPaths: ['src/**'], ttlMs: 15 * 60 * 1000 });
  assert.strictEqual(getScopeState().taskScope.expired, false);
});

test('the expiry message tells the operator how to get authority back', () => {
  const scope = setTaskScope({ allowedPaths: ['src/**'], ttlMs: 90 * 1000 });
  const violation = gatesEngine.buildTaskScopeViolation(scope, ['src/app.js'], scope.expiresAt + 1);
  const message = gatesEngine.describeGovernanceViolation
    ? gatesEngine.describeGovernanceViolation(violation)
    : null;
  if (message) {
    assert.match(message, /lease expired/i);
    assert.match(message, /set_task_scope/, 'the message must name the renewal path');
  }
});

test('clearing a scope still works and leaves nothing behind', () => {
  setTaskScope({ allowedPaths: ['src/**'], ttlMs: 90 * 1000 });
  assert.ok(getScopeState().taskScope);
  setTaskScope({ clear: true });
  assert.strictEqual(getScopeState().taskScope, null);
});

test('a permanent scope written by an older version still loads and still grants', () => {
  // Back-compat with state files on disk that predate leases: no expiresAt at all.
  const legacy = {
    taskScope: { allowedPaths: ['src/**'], summary: 'legacy', createdAt: '2026-01-01T00:00:00.000Z' },
    protectedApprovals: [],
    branchGovernance: null,
    workflowContract: null,
  };
  fs.writeFileSync(gatesEngine.GOVERNANCE_STATE_PATH, JSON.stringify(legacy));

  const state = getScopeState();
  assert.strictEqual(state.taskScope.expired, false, 'a legacy permanent scope must not read as expired');
  assert.strictEqual(
    gatesEngine.buildTaskScopeViolation(state.taskScope, ['src/app.js'], Date.now()),
    null,
    'a legacy permanent scope stopped granting its own paths',
  );
});
