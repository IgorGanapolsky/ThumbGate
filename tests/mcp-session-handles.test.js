'use strict';

/**
 * MCP session-handle controls (InfoWorld / MCP stateless correlation).
 * High-ROI suite: principal binding, entropy+TTL, idempotency, multi-turn depth 30.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const handles = require('../scripts/mcp-session-handles');

function fresh(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-mcp-handles-'));
  handles._resetForTests({
    secret: opts.secret || 'test-secret-at-least-16b',
    storePath: path.join(dir, 'store.json'),
    now: opts.now,
  });
  return dir;
}

test('mint requires principalId', () => {
  fresh();
  assert.throws(() => handles.mintHandle({ tenantId: 't1' }), /principalId is required/);
});

test('mint produces high-entropy signed token with short TTL', () => {
  fresh();
  const minted = handles.mintHandle({
    principalId: 'agent-a',
    tenantId: 'acme',
    scope: 'production',
    kind: 'basket',
  });
  assert.match(minted.token, /^mcp_h_[a-f0-9]+\.[a-f0-9]{16}$/);
  // 18 bytes entropy → 36 hex chars
  const idPart = minted.handleId.replace('mcp_h_', '');
  assert.equal(idPart.length, 36);
  assert.equal(minted.ttlMs, handles.DEFAULT_TTL_MS);
  assert.ok(minted.expiresAtMs - minted.createdAtMs === handles.DEFAULT_TTL_MS);
  // Entropy uniqueness across mints
  const second = handles.mintHandle({ principalId: 'agent-a', tenantId: 'acme' });
  assert.notEqual(minted.token, second.token);
});

test('authorize succeeds for matching principal and tenant', () => {
  fresh();
  const minted = handles.mintHandle({
    principalId: 'agent-a',
    tenantId: 'acme',
    scope: 'production',
  });
  const auth = handles.authorizeHandle({
    handle: minted.token,
    principalId: 'agent-a',
    tenantId: 'acme',
    toolName: 'checkout.add_item',
  });
  assert.equal(auth.allowed, true);
  assert.equal(auth.code, 'SESSION_HANDLE_VERIFIED');
  assert.equal(auth.authorizeCount, 1);
});

test('authorize fails closed when model drops required handle', () => {
  fresh();
  const auth = handles.authorizeHandle({
    args: { itemId: 'sku-1' },
    principalId: 'agent-a',
    tenantId: 'acme',
    toolName: 'checkout.add_item',
    required: true,
  });
  assert.equal(auth.allowed, false);
  assert.equal(auth.code, 'MISSING_SESSION_HANDLE');
});

test('authorize blocks principal mismatch (workflow hijack)', () => {
  fresh();
  const minted = handles.mintHandle({ principalId: 'agent-a', tenantId: 'acme' });
  const auth = handles.authorizeHandle({
    handle: minted.token,
    principalId: 'agent-b',
    tenantId: 'acme',
    toolName: 'billing.charge',
  });
  assert.equal(auth.allowed, false);
  assert.equal(auth.code, 'PRINCIPAL_MISMATCH');
});

test('authorize blocks cross-tenant handle use', () => {
  fresh();
  const minted = handles.mintHandle({ principalId: 'agent-a', tenantId: 'acme' });
  const auth = handles.authorizeHandle({
    args: { sessionId: minted.token },
    principalId: 'agent-a',
    tenantId: 'other-corp',
    toolName: 'docs.read',
  });
  assert.equal(auth.allowed, false);
  assert.equal(auth.code, 'CROSS_TENANT_SESSION_FORGERY');
});

test('authorize rejects forged signature and unknown handles', () => {
  fresh();
  const forged = handles.authorizeHandle({
    handle: `mcp_h_${'ab'.repeat(18)}.${'cd'.repeat(8)}`,
    principalId: 'agent-a',
    tenantId: 'acme',
  });
  assert.equal(forged.allowed, false);
  assert.ok(
    forged.code === 'INVALID_SESSION_HANDLE_SIGNATURE'
    || forged.code === 'UNKNOWN_SESSION_HANDLE'
  );

  const badFmt = handles.authorizeHandle({
    handle: 'not-a-handle',
    principalId: 'agent-a',
  });
  assert.equal(badFmt.allowed, false);
  assert.equal(badFmt.code, 'INVALID_SESSION_HANDLE_FORMAT');
});

test('TTL expiry denies even with valid signature', () => {
  let clock = 1_000_000;
  fresh({ now: () => clock });
  const minted = handles.mintHandle({
    principalId: 'agent-a',
    tenantId: 'acme',
    ttlMs: 10_000,
  });
  assert.equal(
    handles.authorizeHandle({ handle: minted.token, principalId: 'agent-a', tenantId: 'acme' }).allowed,
    true
  );
  clock += 10_001;
  const expired = handles.authorizeHandle({
    handle: minted.token,
    principalId: 'agent-a',
    tenantId: 'acme',
  });
  assert.equal(expired.allowed, false);
  assert.equal(expired.code, 'EXPIRED_SESSION_HANDLE');
});

test('ttlMs is clamped to [MIN, MAX]', () => {
  fresh();
  const short = handles.mintHandle({ principalId: 'a', ttlMs: 1 });
  assert.equal(short.ttlMs, handles.MIN_TTL_MS);
  const long = handles.mintHandle({ principalId: 'a', ttlMs: 999999999 });
  assert.equal(long.ttlMs, handles.MAX_TTL_MS);
});

test('mint idempotency returns same handle (no twin objects)', () => {
  fresh();
  const a = handles.mintHandle({
    principalId: 'agent-a',
    tenantId: 'acme',
    idempotencyKey: 'create-basket-req-1',
    kind: 'basket',
  });
  const b = handles.mintHandle({
    principalId: 'agent-a',
    tenantId: 'acme',
    idempotencyKey: 'create-basket-req-1',
    kind: 'basket',
  });
  assert.equal(a.token, b.token);
  assert.equal(b.replayed, true);
  assert.equal(handles._stats().handleCount, 1);
});

test('operation idempotency prevents duplicate side effects on retry', () => {
  fresh();
  const minted = handles.mintHandle({ principalId: 'agent-a', tenantId: 'acme', kind: 'basket' });
  const first = handles.bindIdempotency({
    handle: minted.token,
    principalId: 'agent-a',
    tenantId: 'acme',
    key: 'charge-order-42',
    operation: 'billing.charge',
    result: { chargeId: 'ch_1', amount: 4000 },
  });
  assert.equal(first.status, 'stored');
  assert.equal(first.result.chargeId, 'ch_1');

  const retry = handles.bindIdempotency({
    handle: minted.token,
    principalId: 'agent-a',
    tenantId: 'acme',
    key: 'charge-order-42',
    operation: 'billing.charge',
    result: { chargeId: 'ch_SHOULD_NOT_CREATE', amount: 4000 },
  });
  assert.equal(retry.status, 'replay');
  assert.equal(retry.result.chargeId, 'ch_1');

  const resolved = handles.resolveIdempotency({
    principalId: 'agent-a',
    tenantId: 'acme',
    key: 'charge-order-42',
    operation: 'billing.charge',
  });
  assert.equal(resolved.status, 'hit');
  assert.equal(resolved.result.chargeId, 'ch_1');
});

test('idempotency bind denies on principal mismatch (no silent create)', () => {
  fresh();
  const minted = handles.mintHandle({ principalId: 'agent-a', tenantId: 'acme' });
  const denied = handles.bindIdempotency({
    handle: minted.token,
    principalId: 'attacker',
    tenantId: 'acme',
    key: 'k1',
    operation: 'billing.charge',
    result: { chargeId: 'evil' },
  });
  assert.equal(denied.status, 'denied');
  assert.equal(denied.authorization.code, 'PRINCIPAL_MISMATCH');
});

test('verifySessionHandle extracts common model arg keys', () => {
  fresh();
  const minted = handles.mintSessionHandle('acme', 'production', { principalId: 'agent-a' });
  for (const key of ['sessionId', 'basketId', 'browserId', 'taskScopeId', 'sessionHandle']) {
    const result = handles.verifySessionHandle(
      'tool',
      { [key]: minted.token },
      { required: true, tenantId: 'acme', principalId: 'agent-a' }
    );
    assert.equal(result.allowed, true, `key ${key} should authorize`);
  }
});

test('verifySessionHandle blocks drop and cross-tenant (stub API parity)', () => {
  fresh();
  const drop = handles.verifySessionHandle('exec', {}, { required: true, tenantId: 'acme', principalId: 'agent-a' });
  assert.equal(drop.allowed, false);
  assert.equal(drop.code, 'MISSING_SESSION_HANDLE');

  const minted = handles.mintSessionHandle('attacker', 'production', { principalId: 'agent-a' });
  const cross = handles.verifySessionHandle(
    'exec',
    { sessionId: minted.handleId },
    { required: true, tenantId: 'acme', principalId: 'agent-a' }
  );
  assert.equal(cross.allowed, false);
  assert.equal(cross.code, 'CROSS_TENANT_SESSION_FORGERY');
});

test('revoke prevents further authorization', () => {
  fresh();
  const minted = handles.mintHandle({ principalId: 'agent-a', tenantId: 'acme' });
  assert.equal(handles.revokeHandle(minted.token, 'agent-a').revoked, true);
  const auth = handles.authorizeHandle({
    handle: minted.token,
    principalId: 'agent-a',
    tenantId: 'acme',
  });
  assert.equal(auth.allowed, false);
  assert.ok(auth.code === 'UNKNOWN_SESSION_HANDLE' || auth.code === 'REVOKED_SESSION_HANDLE');
});

test('multi-turn fidelity: faithful model keeps handle for 30 turns', () => {
  fresh();
  const sim = handles.simulateMultiTurnFidelity({
    turns: 30,
    principalId: 'agent-primary',
    tenantId: 'acme',
  });
  assert.equal(sim.turns, 30);
  assert.equal(sim.successCount, 30);
  assert.equal(sim.failureCount, 0);
  assert.equal(sim.results[29].turn, 30);
  assert.equal(sim.results[29].allowed, true);
  assert.equal(sim.results[29].authorizeCount, 30);
});

test('multi-turn fidelity: drop at turn 15 is denied (not silent success)', () => {
  fresh();
  const sim = handles.simulateMultiTurnFidelity({
    turns: 30,
    principalId: 'agent-primary',
    tenantId: 'acme',
    mutateAtTurns: { 15: 'drop' },
  });
  assert.equal(sim.results[14].mutation, 'drop');
  assert.equal(sim.results[14].allowed, false);
  assert.equal(sim.results[14].code, 'MISSING_SESSION_HANDLE');
  // Surrounding turns still ok
  assert.equal(sim.results[13].allowed, true);
  assert.equal(sim.results[15].allowed, true);
  assert.equal(sim.failureCount, 1);
});

test('multi-turn fidelity: swap to another principal handle is denied', () => {
  fresh();
  const sim = handles.simulateMultiTurnFidelity({
    turns: 20,
    principalId: 'agent-primary',
    tenantId: 'acme',
    mutateAtTurns: { 10: 'swap' },
    swapPrincipalId: 'agent-intruder',
  });
  assert.equal(sim.results[9].allowed, false);
  assert.equal(sim.results[9].code, 'PRINCIPAL_MISMATCH');
});

test('multi-turn fidelity: mutate (HMAC break) and forge are denied', () => {
  fresh();
  const sim = handles.simulateMultiTurnFidelity({
    turns: 12,
    principalId: 'agent-primary',
    tenantId: 'acme',
    mutateAtTurns: { 5: 'mutate', 8: 'forge' },
  });
  assert.equal(sim.results[4].allowed, false);
  assert.ok(
    sim.results[4].code === 'INVALID_SESSION_HANDLE_SIGNATURE'
    || sim.results[4].code === 'UNKNOWN_SESSION_HANDLE'
  );
  assert.equal(sim.results[7].allowed, false);
});

test('multi-turn fidelity: cross-tenant claim at depth 22 is denied', () => {
  fresh();
  const sim = handles.simulateMultiTurnFidelity({
    turns: 30,
    principalId: 'agent-primary',
    tenantId: 'acme',
    mutateAtTurns: { 22: 'cross_tenant' },
    crossTenantId: 'evil-tenant',
  });
  assert.equal(sim.results[21].allowed, false);
  assert.equal(sim.results[21].code, 'CROSS_TENANT_SESSION_FORGERY');
  assert.equal(sim.successCount, 29);
});

test('extractHandleFromArgs prefers explicit sessionHandle keys', () => {
  fresh();
  const hit = handles.extractHandleFromArgs({
    sessionHandle: 'preferred',
    sessionId: 'secondary',
  });
  assert.equal(hit.key, 'sessionHandle');
  assert.equal(hit.value, 'preferred');
  assert.equal(handles.extractHandleFromArgs({}), null);
  assert.equal(handles.extractHandleFromArgs(null), null);
});

test('handles from different secrets do not authorize', () => {
  fresh({ secret: 'secret-aaaaaaaaaaaa' });
  const minted = handles.mintHandle({ principalId: 'agent-a', tenantId: 'acme' });
  handles._resetForTests({
    secret: 'secret-bbbbbbbbbbbb',
    storePath: path.join(os.tmpdir(), `tg-mcp-alt-${crypto.randomBytes(4).toString('hex')}.json`),
  });
  // Re-register is empty under new secret — token HMAC fails or unknown
  const auth = handles.authorizeHandle({
    handle: minted.token,
    principalId: 'agent-a',
    tenantId: 'acme',
  });
  assert.equal(auth.allowed, false);
});

test('listHandlesForPrincipal filters by principal and tenant', () => {
  fresh();
  handles.mintHandle({ principalId: 'a', tenantId: 't1' });
  handles.mintHandle({ principalId: 'a', tenantId: 't2' });
  handles.mintHandle({ principalId: 'b', tenantId: 't1' });
  assert.equal(handles.listHandlesForPrincipal('a').length, 2);
  assert.equal(handles.listHandlesForPrincipal('a', 't1').length, 1);
  assert.equal(handles.listHandlesForPrincipal('b', 't1').length, 1);
});
