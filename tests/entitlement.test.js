'use strict';

/**
 * entitlement.test.js — proves the signed-entitlement boundary actually protects
 * paid features: valid tokens verify, and fake prefix keys / tampered / expired /
 * wrong-key tokens all FAIL. (Reviewer requirement: fake `tg_pro_` and tampered
 * tokens must not pass.)
 */

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const {
  verifyLicense,
  issueLicense,
  requireEntitlement,
  EntitlementError,
  TIER_FEATURES,
} = require('../scripts/entitlement.js');
const { trainRiskModel } = require('../scripts/risk-scorer.js');
const { bayesOptimalDecision } = require('../scripts/bayes-optimal-gate.js');
const thompson = require('../scripts/thompson-sampling.js');
const { buildRewardReport } = require('../scripts/agent-reward-model.js');
const { trainInterventionPolicy } = require('../scripts/intervention-policy.js');

// Ephemeral keypair so tests never depend on the shipped production key.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB_PEM = publicKey.export({ type: 'spki', format: 'pem' });
const PRIV_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const KID = 'tgk_test';
const TRUSTED = { [KID]: PUB_PEM };

function makeToken(overrides = {}) {
  return issueLicense(PRIV_PEM, {
    kid: KID,
    tier: 'pro',
    customerId: 'cus_123',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  });
}

function entitlementOpts(token, env = { THUMBGATE_ENFORCE_ENTITLEMENTS: '1' }) {
  return {
    token,
    trustedKeys: TRUSTED,
    env,
    silent: true,
  };
}

test('a validly-signed Pro token verifies and carries tier + features', () => {
  const r = verifyLicense(makeToken(), { trustedKeys: TRUSTED });
  assert.equal(r.valid, true);
  assert.equal(r.tier, 'pro');
  assert.equal(r.customerId, 'cus_123');
  assert.ok(r.features.includes('data-export'));
  assert.ok(r.features.includes('learned-models'));
});

test('legacy tg_pro_ prefix key is REJECTED (the old bypass no longer works)', () => {
  for (const fake of ['tg_pro_abc123', 'tg_anything', 'tg_pro_'.padEnd(40, 'x')]) {
    const r = verifyLicense(fake, { trustedKeys: TRUSTED });
    assert.equal(r.valid, false, `expected ${fake} to be rejected`);
    assert.equal(r.reason, 'legacy_prefix_key_not_a_signed_license');
  }
});

test('a tampered payload FAILS signature verification', () => {
  const token = makeToken({ tier: 'free' });
  const [h, p, s] = token.split('.');
  // Forge the payload to claim enterprise while keeping the original signature.
  const forged = Buffer.from(JSON.stringify({
    tier: 'enterprise', features: TIER_FEATURES.enterprise, customerId: 'cus_123', keyId: KID,
  })).toString('base64url');
  const tampered = `${h}.${forged}.${s}`;
  const r = verifyLicense(tampered, { trustedKeys: TRUSTED });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'bad_signature');
});

test('a token signed by an UNTRUSTED key FAILS (unknown kid / wrong key)', () => {
  const other = crypto.generateKeyPairSync('ed25519');
  const otherPriv = other.privateKey.export({ type: 'pkcs8', format: 'pem' });
  // Signed by a different key but claiming our kid.
  const token = issueLicense(otherPriv, { kid: KID, tier: 'enterprise', exp: Math.floor(Date.now() / 1000) + 3600 });
  const r = verifyLicense(token, { trustedKeys: TRUSTED });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'bad_signature');

  // Unknown kid entirely.
  const token2 = issueLicense(PRIV_PEM, { kid: 'tgk_unknown', tier: 'pro', exp: Math.floor(Date.now() / 1000) + 3600 });
  const r2 = verifyLicense(token2, { trustedKeys: TRUSTED });
  assert.equal(r2.valid, false);
  assert.equal(r2.reason, 'unknown_key_id');
});

test('an expired token FAILS', () => {
  const token = makeToken({ exp: Math.floor(Date.now() / 1000) - 10 });
  const r = verifyLicense(token, { trustedKeys: TRUSTED });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'expired');
});

test('malformed / empty / garbage tokens FAIL gracefully (no throw)', () => {
  for (const bad of ['', 'not-a-token', 'a.b', 'a.b.c.d', 'x.y.z']) {
    const r = verifyLicense(bad, { trustedKeys: TRUSTED });
    assert.equal(r.valid, false, `expected ${JSON.stringify(bad)} invalid`);
  }
});

test('requireEntitlement: advisory by default (no throw), enforced when flagged', () => {
  const token = makeToken();
  const proOpts = { token, trustedKeys: TRUSTED, env: {} };

  // Entitled feature → entitled true in both modes.
  assert.equal(requireEntitlement('data-export', proOpts).entitled, true);

  // Missing feature, advisory (no enforce flag) → returns entitled:false, does NOT throw.
  const advisory = requireEntitlement('sso', proOpts);
  assert.equal(advisory.entitled, false);
  assert.equal(advisory.reason, 'feature_not_in_tier');

  // Missing feature, ENFORCED → throws EntitlementError.
  assert.throws(
    () => requireEntitlement('sso', { token, trustedKeys: TRUSTED, env: { THUMBGATE_ENFORCE_ENTITLEMENTS: '1' } }),
    EntitlementError
  );

  // No license at all, enforced, paid feature → throws.
  assert.throws(
    () => requireEntitlement('data-export', { token: null, trustedKeys: TRUSTED, env: { THUMBGATE_ENFORCE_ENTITLEMENTS: '1' } }),
    EntitlementError
  );

  // No license, enforced, but a fake prefix key → still throws (not entitled).
  assert.throws(
    () => requireEntitlement('data-export', { token: 'tg_pro_fake', trustedKeys: TRUSTED, env: { THUMBGATE_ENFORCE_ENTITLEMENTS: '1' } }),
    EntitlementError
  );
});

test('issueLicense → verifyLicense round-trips for each tier', () => {
  for (const tier of ['pro', 'team', 'enterprise']) {
    const token = issueLicense(PRIV_PEM, { kid: KID, tier, exp: Math.floor(Date.now() / 1000) + 60 });
    const r = verifyLicense(token, { trustedKeys: TRUSTED });
    assert.equal(r.valid, true);
    assert.equal(r.tier, tier);
    assert.deepEqual(r.features, TIER_FEATURES[tier]);
  }
});

test('enforced entitlements block learned-model crown jewels without a signed token', () => {
  const denied = entitlementOpts(null);
  assert.throws(() => trainRiskModel([], { entitlement: denied }), EntitlementError);
  assert.throws(() => bayesOptimalDecision({ pHarmful: 0.4, pSafe: 0.6 }, [], undefined, { entitlement: denied }), EntitlementError);
  assert.throws(() => thompson.updateModel(thompson.createInitialModel(), {
    signal: 'positive',
    timestamp: new Date().toISOString(),
    categories: ['testing'],
    entitlement: denied,
  }), EntitlementError);
  assert.throws(() => buildRewardReport([], { entitlement: denied }), EntitlementError);
  assert.throws(() => trainInterventionPolicy([], { entitlement: denied }), EntitlementError);
});

test('signed learned-model entitlement unlocks crown-jewel entrypoints in enforced mode', () => {
  const token = makeToken({ tier: 'pro' });
  const allowed = entitlementOpts(token);
  assert.doesNotThrow(() => trainRiskModel([], { entitlement: allowed }));
  assert.doesNotThrow(() => bayesOptimalDecision({ pHarmful: 0.4, pSafe: 0.6 }, [], undefined, { entitlement: allowed }));
  assert.doesNotThrow(() => thompson.samplePosteriors(thompson.createInitialModel(), 1, { entitlement: allowed }));
  assert.doesNotThrow(() => buildRewardReport([], { entitlement: allowed }));
  assert.doesNotThrow(() => trainInterventionPolicy([], { entitlement: allowed }));
});
