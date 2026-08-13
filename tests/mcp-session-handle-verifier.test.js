'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  mintSessionHandle,
  verifySessionHandle,
  SessionSecretMissingError,
  SECRET_ENV_KEY
} = require('../scripts/mcp-session-handle-verifier.js');

const ENV = { [SECRET_ENV_KEY]: 'test-signing-material-not-a-real-credential' };
const OTHER_ENV = { [SECRET_ENV_KEY]: 'a-different-signing-material' };

test('refuses to mint without configured signing material', () => {
  assert.throws(() => mintSessionHandle({ tenantId: 'acme' }, {}), SessionSecretMissingError);
});

test('refuses to verify without configured signing material', () => {
  const h = mintSessionHandle({ tenantId: 'acme' }, ENV);
  assert.throws(
    () => verifySessionHandle('tool', { sessionId: h.handleId }, null, {}),
    SessionSecretMissingError
  );
});

test('a freshly minted handle verifies', () => {
  const h = mintSessionHandle({ tenantId: 'acme', scope: 'orders' }, ENV);
  const r = verifySessionHandle('get_order', { sessionId: h.handleId }, { tenantId: 'acme' }, ENV);
  assert.equal(r.allowed, true);
  assert.equal(r.code, 'SESSION_HANDLE_VERIFIED');
});

test('forged handle with attacker-chosen tenant is caught by the signature check', () => {
  // The prior implementation parsed tenantId out of the string and never
  // recomputed the HMAC, so this exact shape was accepted.
  const forged = `${Buffer.from(
    JSON.stringify({ h: 'mcp_sess_victim_aaaa', t: 'victim', s: 'global', r: null, x: Date.now() + 60000 })
  ).toString('base64url')}.deadbeefdeadbeef`;

  const r = verifySessionHandle('transfer', { sessionId: forged }, { tenantId: 'victim' }, ENV);
  assert.equal(r.allowed, false);
  assert.equal(r.code, 'SESSION_HANDLE_SIGNATURE_INVALID');
});

test('handle signed with different material does not verify', () => {
  const h = mintSessionHandle({ tenantId: 'acme' }, OTHER_ENV);
  const r = verifySessionHandle('get_order', { sessionId: h.handleId }, { tenantId: 'acme' }, ENV);
  assert.equal(r.allowed, false);
  assert.equal(r.code, 'SESSION_HANDLE_SIGNATURE_INVALID');
});

test('tampering with any claim invalidates the signature', () => {
  const h = mintSessionHandle({ tenantId: 'acme', resourceId: 'rec_1' }, ENV);
  const [payload, sig] = h.handleId.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  claims.r = 'rec_999'; // repoint at another record, keep the original signature
  const tampered = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`;

  const r = verifySessionHandle('mutate', { sessionId: tampered, resourceId: 'rec_999' }, { tenantId: 'acme' }, ENV);
  assert.equal(r.allowed, false);
  assert.equal(r.code, 'SESSION_HANDLE_SIGNATURE_INVALID');
});

test('expired handle is rejected', () => {
  const t0 = 1_000_000;
  const h = mintSessionHandle({ tenantId: 'acme', ttlMs: 1000, now: t0 }, ENV);
  const r = verifySessionHandle('get_order', { sessionId: h.handleId }, { tenantId: 'acme', now: t0 + 5000 }, ENV);
  assert.equal(r.allowed, false);
  assert.equal(r.code, 'SESSION_HANDLE_EXPIRED');
});

test('cross-tenant use of a genuine handle is rejected', () => {
  const h = mintSessionHandle({ tenantId: 'acme' }, ENV);
  const r = verifySessionHandle('get_order', { sessionId: h.handleId }, { tenantId: 'globex' }, ENV);
  assert.equal(r.allowed, false);
  assert.equal(r.code, 'CROSS_TENANT_SESSION_FORGERY');
});

test('missing handle is denied only when the context requires one', () => {
  assert.equal(verifySessionHandle('ping', {}, null, ENV).allowed, true);
  const r = verifySessionHandle('mutate', {}, { required: true }, ENV);
  assert.equal(r.allowed, false);
  assert.equal(r.code, 'MISSING_SESSION_HANDLE');
});

// --- The case the article is actually about -------------------------------
// A real, unexpired, correctly-tenanted, correctly-signed handle aimed at the
// wrong resource because the model lost the thread. Every other check passes.

test('valid handle used against the wrong resource is denied (lost-the-thread)', () => {
  const h = mintSessionHandle({ tenantId: 'acme', scope: 'records', resourceId: 'rec_alice' }, ENV);

  const ok = verifySessionHandle('mutate', { sessionId: h.handleId, resourceId: 'rec_alice' }, { tenantId: 'acme' }, ENV);
  assert.equal(ok.allowed, true, 'correct resource must still pass');

  const drift = verifySessionHandle('mutate', { sessionId: h.handleId, resourceId: 'rec_bob' }, { tenantId: 'acme' }, ENV);
  assert.equal(drift.allowed, false);
  assert.equal(drift.code, 'SESSION_HANDLE_RESOURCE_MISMATCH');
  assert.equal(drift.boundResource, 'rec_alice');
  assert.equal(drift.requestedResource, 'rec_bob');
});

test('handle minted without a resource binding stays backward compatible', () => {
  const h = mintSessionHandle({ tenantId: 'acme' }, ENV);
  const r = verifySessionHandle('mutate', { sessionId: h.handleId, resourceId: 'rec_bob' }, { tenantId: 'acme' }, ENV);
  assert.equal(r.allowed, true);
});

// The article recommends testing at turn depth thirty rather than turn one,
// citing a 39% multi-turn degradation. Simulate an agent holding two handles
// that reaches for the wrong one at turn 30.
test('turn-depth 30: handle swap is caught on the turn it happens', () => {
  const alice = mintSessionHandle({ tenantId: 'acme', resourceId: 'rec_alice' }, ENV);
  const bob = mintSessionHandle({ tenantId: 'acme', resourceId: 'rec_bob' }, ENV);

  let denials = 0;
  for (let turn = 1; turn <= 30; turn += 1) {
    const handle = turn === 30 ? bob.handleId : alice.handleId;
    const r = verifySessionHandle('mutate', { sessionId: handle, resourceId: 'rec_alice' }, { tenantId: 'acme' }, ENV);
    if (!r.allowed) {
      denials += 1;
      assert.equal(turn, 30, 'no denial should occur before the swap');
      assert.equal(r.code, 'SESSION_HANDLE_RESOURCE_MISMATCH');
    }
  }
  assert.equal(denials, 1, 'exactly one denial, on the turn the thread was lost');
});

test('canonical payload is unambiguous across delimiter-shifted fields', () => {
  // Without length-prefixing, tenant "a|b" + scope "c" and tenant "a" + scope "b|c"
  // would sign identically, letting one handle stand in for another.
  const h = mintSessionHandle({ tenantId: 'acme', scope: 'a', resourceId: 'b' }, ENV);
  const [payload, sig] = h.handleId.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  claims.s = 'a|b';
  claims.r = '';
  const shifted = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`;

  const r = verifySessionHandle('t', { sessionId: shifted }, { tenantId: 'acme' }, ENV);
  assert.equal(r.allowed, false);
  assert.equal(r.code, 'SESSION_HANDLE_SIGNATURE_INVALID');
});

test('rejects tenant or scope containing the delimiter at mint time', () => {
  assert.throws(() => mintSessionHandle({ tenantId: 'a|b' }, ENV), /must not contain/);
  assert.throws(() => mintSessionHandle({ tenantId: 'a', scope: 'x|y' }, ENV), /must not contain/);
});
