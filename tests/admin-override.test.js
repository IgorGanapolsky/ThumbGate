'use strict';

/**
 * admin-override.test.js
 *
 * Every test here attacks the grant mechanism rather than exercising it.
 * The three properties under test each correspond to a way governed overrides
 * die in the wild: blanket scope, no expiry, and silently overriding the gates
 * that protect the enforcement machinery itself.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function freshEnv(prefix = 'tg-admin-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  for (const k of Object.keys(require.cache)) {
    if (k.includes('admin-override') || k.includes('override-audit') || k.includes('audit-trail')) {
      delete require.cache[k];
    }
  }
  // eslint-disable-next-line global-require
  return { dir, mod: require('../scripts/admin-override') };
}

// ---------------------------------------------------------------------------
// Property 1 — no blanket grants
// ---------------------------------------------------------------------------

test('blanket and wildcard grants are refused', () => {
  const { mod } = freshEnv();
  for (const gateId of ['*', 'self-protect-*', 'gh-*-restricted']) {
    const r = mod.grantOverride({ gateId, grantedBy: 'Igor', reason: 'unblock everything now' });
    assert.equal(r.ok, false, `${gateId} must be refused`);
    assert.match(r.error, /blanket/);
  }
});

test('a grant unlocks exactly the named gate and nothing adjacent', () => {
  const { mod } = freshEnv();
  const r = mod.grantOverride({
    gateId: 'gh-pr-create-restricted',
    grantedBy: 'Igor Ganapolsky',
    reason: 'authorized PR creation for the override audit work',
  });
  assert.equal(r.ok, true);
  assert.equal(mod.isOverrideActive('gh-pr-create-restricted'), true);
  assert.equal(mod.isOverrideActive('gh-pr-merge-restricted'), false);
  assert.equal(mod.isOverrideActive(''), false);
  assert.equal(mod.isOverrideActive(undefined), false);
});

// ---------------------------------------------------------------------------
// Property 2 — always expires
// ---------------------------------------------------------------------------

test('an expired grant does not authorize anything', () => {
  const { mod, dir } = freshEnv();
  mod.grantOverride({
    gateId: 'push-without-thread-check',
    grantedBy: 'Igor',
    reason: 'temporary unblock for a verified branch push',
    ttlMs: 60_000,
  });
  assert.equal(mod.isOverrideActive('push-without-thread-check'), true);

  // Rewrite the grant as already expired — simulates the passage of time.
  const store = JSON.parse(fs.readFileSync(path.join(dir, 'admin-overrides.json'), 'utf8'));
  store['push-without-thread-check'].expiresAt = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(path.join(dir, 'admin-overrides.json'), JSON.stringify(store));

  assert.equal(mod.isOverrideActive('push-without-thread-check'), false, 'expired grant must not authorize');
  assert.equal(mod.listActiveOverrides().length, 0);
  assert.equal(mod.expireOverrides(), 1, 'expired grant should be reaped');
});

test('ttl is capped so a grant cannot become permanent', () => {
  const { mod } = freshEnv();
  const r = mod.grantOverride({
    gateId: 'some-gate',
    grantedBy: 'Igor',
    reason: 'attempting a very long lived grant',
    ttlMs: 365 * 24 * 60 * 60 * 1000, // one year
  });
  assert.equal(r.ok, true);
  assert.equal(r.grant.ttlMs, mod.MAX_TTL_MS, 'ttl must be clamped to the 24h ceiling');
});

test('a non-positive or garbage ttl falls back to the default, never to infinity', () => {
  const { mod } = freshEnv();
  for (const ttlMs of [0, -1, NaN, 'forever', null]) {
    const r = mod.grantOverride({
      gateId: `gate-${String(ttlMs)}`,
      grantedBy: 'Igor',
      reason: 'checking ttl fallback behaviour',
      ttlMs,
    });
    assert.equal(r.ok, true);
    assert.equal(r.grant.ttlMs, mod.DEFAULT_TTL_MS);
  }
});

// ---------------------------------------------------------------------------
// Property 3 — self-protect gates require deliberate acknowledgement
// ---------------------------------------------------------------------------

test('self-protect gates are refused without explicit acknowledgement', () => {
  const { mod } = freshEnv();
  for (const gateId of [
    'self-protect-config',
    'self-protect-hooks-disable',
    'never-bypass-branch-protection',
    'secret-exfil-guard',
  ]) {
    assert.equal(mod.isSelfProtectGate(gateId), true, `${gateId} must be classified self-protect`);
    const r = mod.grantOverride({ gateId, grantedBy: 'Igor', reason: 'need to edit gate configuration' });
    assert.equal(r.ok, false, `${gateId} must require acknowledgement`);
    assert.match(r.error, /acknowledgeSelfProtect/);
  }
});

test('self-protect override succeeds when acknowledged, and is flagged in the grant', () => {
  const { mod } = freshEnv();
  const r = mod.grantOverride({
    gateId: 'self-protect-config',
    grantedBy: 'Igor Ganapolsky',
    reason: 'owner is deliberately editing gate rules to fix matcher defects',
    acknowledgeSelfProtect: true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.grant.selfProtect, true, 'the receipt must mark this as a high-risk override');
});

// ---------------------------------------------------------------------------
// Attribution — a grant no one signed is not a grant
// ---------------------------------------------------------------------------

test('grants require a named person and a real reason', () => {
  const { mod } = freshEnv();
  assert.match(mod.grantOverride({ gateId: 'g', reason: 'a perfectly fine reason' }).error, /grantedBy/);
  assert.match(mod.grantOverride({ gateId: 'g', grantedBy: '  ' , reason: 'a perfectly fine reason' }).error, /grantedBy/);
  // A one-word reason is what a reviewer finds useless six weeks later.
  assert.match(mod.grantOverride({ gateId: 'g', grantedBy: 'Igor', reason: 'because' }).error, /reason/);
  assert.match(mod.grantOverride({ gateId: '', grantedBy: 'Igor', reason: 'a perfectly fine reason' }).error, /gateId/);
});

// ---------------------------------------------------------------------------
// Durability — a broken store must fail closed (no grants), never crash
// ---------------------------------------------------------------------------

test('a corrupt grant store authorizes nothing and does not throw', () => {
  const { mod, dir } = freshEnv();
  fs.writeFileSync(path.join(dir, 'admin-overrides.json'), '{ not json at all');
  assert.equal(mod.isOverrideActive('anything'), false);
  assert.deepEqual(mod.listActiveOverrides(), []);
});

test('a missing grant store authorizes nothing', () => {
  const { mod } = freshEnv();
  assert.equal(mod.isOverrideActive('anything'), false);
  assert.deepEqual(mod.listActiveOverrides(), []);
});

// ---------------------------------------------------------------------------
// Every grant and revocation leaves a receipt
// ---------------------------------------------------------------------------

test('granting and revoking both emit typed override receipts', () => {
  const { mod, dir } = freshEnv();
  mod.grantOverride({
    gateId: 'deny-network-egress',
    grantedBy: 'Igor Ganapolsky',
    reason: 'allow health checks against our own production host',
  });
  mod.revokeOverride('deny-network-egress', 'Igor Ganapolsky');

  // eslint-disable-next-line global-require
  const { readOverrides } = require('../scripts/override-audit');
  const found = readOverrides({ logPath: path.join(dir, 'audit-trail.jsonl') });
  assert.equal(found.length, 2, 'grant AND revoke must each be recorded');
  assert.ok(found.every((r) => r.override.gateId === 'deny-network-egress'));
  assert.ok(found.every((r) => r.override.actor === 'Igor Ganapolsky'));
  assert.ok(found.some((r) => /revoked/.test(r.override.reason || '')));
});

test('revoking a grant that does not exist is refused, not silently accepted', () => {
  const { mod } = freshEnv();
  const r = mod.revokeOverride('never-granted');
  assert.equal(r.ok, false);
  assert.match(r.error, /no such grant/);
});
