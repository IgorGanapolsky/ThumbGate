'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadWithIsolatedLicenseEnv } = require('./helpers/license-env');
const { issueLicense } = require('../scripts/entitlement');

const LICENSE_MODULE_ID = require.resolve('../scripts/license');
const PRO_FEATURES_MODULE_ID = require.resolve('../scripts/pro-features');

// Ephemeral signing keypair so trial tests never depend on the production key.
const { publicKey: _trialPub, privateKey: _trialPriv } = crypto.generateKeyPairSync('ed25519');
const TRIAL_PUB = _trialPub.export({ type: 'spki', format: 'pem' });
const TRIAL_PRIV = _trialPriv.export({ type: 'pkcs8', format: 'pem' });
const TRIAL_KID = 'tgk_trial_test';
const TRIAL_TRUSTED = { [TRIAL_KID]: TRIAL_PUB };

function mintTrial(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return issueLicense(TRIAL_PRIV, { kid: TRIAL_KID, tier: 'pro', exp: now + 30 * 86400, ...overrides });
}

function withLicenseEnv(token, fn) {
  const saved = process.env.THUMBGATE_LICENSE;
  if (token === null) delete process.env.THUMBGATE_LICENSE;
  else process.env.THUMBGATE_LICENSE = token;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.THUMBGATE_LICENSE;
    else process.env.THUMBGATE_LICENSE = saved;
  }
}

test('license module exports required functions', () => {
  const { moduleExports: license, restore } = loadWithIsolatedLicenseEnv(LICENSE_MODULE_ID);
  try {
    assert.equal(typeof license.verifyLicense, 'function');
    assert.equal(typeof license.isProLicensed, 'function');
    assert.equal(typeof license.activateLicense, 'function');
    assert.equal(typeof license.getLicensePath, 'function');
    assert.equal(typeof license.generateLicenseKey, 'undefined', 'generateLicenseKey must not be exported (prevents license forging)');
  } finally {
    restore();
  }
});

test('isValidKey accepts ThumbGate keys and legacy-compatible formats', () => {
  const { moduleExports: license, restore } = loadWithIsolatedLicenseEnv(LICENSE_MODULE_ID);
  try {
    assert.ok(license.isValidKey('tg_pro_abc123'));
    assert.ok(license.isValidKey('tg_abc123'));
    assert.ok(license.isValidKey(`legacy_${'a'.repeat(24)}`));
    assert.ok(!license.isValidKey('invalid_key'));
    assert.ok(!license.isValidKey(''));
    assert.ok(!license.isValidKey(null));
  } finally {
    restore();
  }
});

test('activateLicense rejects invalid prefixes but accepts legacy Stripe keys', () => {
  const { moduleExports: license, restore } = loadWithIsolatedLicenseEnv(LICENSE_MODULE_ID);
  try {
    const result = license.activateLicense('not_a_valid_key');
    assert.equal(result.success, false);
    assert.ok(license.isValidKey(`tg_${'a'.repeat(32)}`), 'tg_ key should be accepted');
    assert.ok(license.isValidKey(`legacy_${'a'.repeat(32)}`), 'legacy-format key should be accepted');
    assert.ok(!license.isValidKey('bad_prefix_key'), 'bad prefix should be rejected');
  } finally {
    restore();
  }
});

test('activateLicense persists a Pro key that verifyLicense reads from the local license path', () => {
  const { moduleExports: license, homeDir, restore } = loadWithIsolatedLicenseEnv(LICENSE_MODULE_ID);
  try {
    const key = 'tg_pro_localtiercoverage1234567890';
    const activation = license.activateLicense(key, { homeDir });

    assert.equal(activation.success, true);
    assert.equal(activation.path, license.getLicensePath(homeDir));

    const verified = license.verifyLicense({ homeDir });
    assert.equal(verified.valid, true);
    assert.equal(verified.source, 'file');
    assert.ok(!('key' in verified), 'raw key must not be exposed in the verification result');
    assert.equal(verified.path, activation.path);
  } finally {
    restore();
  }
});

test('verifyLicense prefers a valid Pro env key over the local license file', () => {
  const { moduleExports: license, homeDir, restore } = loadWithIsolatedLicenseEnv(LICENSE_MODULE_ID);
  try {
    license.activateLicense('tg_pro_filetiercoverage1234567890', { homeDir });
    process.env.THUMBGATE_PRO_KEY = 'tg_pro_envtiercoverage1234567890';

    const verified = license.verifyLicense({ homeDir });
    assert.equal(verified.valid, true);
    assert.equal(verified.source, 'env');
    assert.equal(verified.envVar, 'THUMBGATE_PRO_KEY');
    assert.ok(!('key' in verified), 'raw key must not be exposed in the verification result');
  } finally {
    restore();
  }
});

test('foreign vendor *_API_KEY / *_PRO_KEY env vars are never license candidates', () => {
  const { moduleExports: license, restore } = loadWithIsolatedLicenseEnv(LICENSE_MODULE_ID);
  const foreignVars = ['ACME_VENDOR_API_KEY', 'SOME_SERVICE_PRO_KEY'];
  try {
    for (const name of foreignVars) {
      // Value deliberately matches the legacy-compatible key shape: the old
      // scan would have returned this foreign secret as a valid license.
      process.env[name] = `acme_${'a1b2c3d4'.repeat(4)}`;
    }
    const verified = license.verifyLicense();
    assert.equal(verified.valid, false, 'another vendor secret must not activate a license');
    assert.ok(!('key' in verified));
  } finally {
    for (const name of foreignVars) delete process.env[name];
    restore();
  }
});

test('Pro feature gate blocks without license', () => {
  const { moduleExports: proFeatures, restore } = loadWithIsolatedLicenseEnv(
    PRO_FEATURES_MODULE_ID,
    [LICENSE_MODULE_ID],
  );
  const origWrite = process.stderr.write;
  let output = '';

  process.stderr.write = (str) => { output += str; return true; };
  try {
    const result = proFeatures.requirePro('dpo-export');
    assert.equal(result, false);
    assert.ok(output.includes('Pro Feature Required'));
  } finally {
    process.stderr.write = origWrite;
    restore();
  }
});

test('a signed, unexpired Pro entitlement token (env) unlocks Pro with source=entitlement', () => {
  const { moduleExports: license, homeDir, restore } = loadWithIsolatedLicenseEnv(LICENSE_MODULE_ID);
  try {
    withLicenseEnv(mintTrial(), () => {
      const v = license.verifyLicense({ homeDir, trustedKeys: TRIAL_TRUSTED });
      assert.equal(v.valid, true);
      assert.equal(v.source, 'entitlement');
      assert.equal(v.tier, 'pro');
      assert.ok(typeof v.exp === 'number' && v.exp > Math.floor(Date.now() / 1000));
      assert.ok(!('key' in v), 'raw token must not be exposed in the result');
      assert.equal(license.isProLicensed({ homeDir, trustedKeys: TRIAL_TRUSTED }), true);
    });
  } finally {
    restore();
  }
});

test('an EXPIRED signed Pro trial reverts to free (isProLicensed false)', () => {
  const { moduleExports: license, homeDir, restore } = loadWithIsolatedLicenseEnv(LICENSE_MODULE_ID);
  try {
    withLicenseEnv(mintTrial({ exp: Math.floor(Date.now() / 1000) - 10 }), () => {
      assert.equal(license.verifyLicense({ homeDir, trustedKeys: TRIAL_TRUSTED }).valid, false);
      assert.equal(license.isProLicensed({ homeDir, trustedKeys: TRIAL_TRUSTED }), false);
    });
  } finally {
    restore();
  }
});

test('a signed FREE-tier token does not grant Pro', () => {
  const { moduleExports: license, homeDir, restore } = loadWithIsolatedLicenseEnv(LICENSE_MODULE_ID);
  try {
    withLicenseEnv(mintTrial({ tier: 'free' }), () => {
      assert.equal(license.isProLicensed({ homeDir, trustedKeys: TRIAL_TRUSTED }), false);
    });
  } finally {
    restore();
  }
});

test('a signed Pro token stored in the license file also unlocks Pro', () => {
  const { moduleExports: license, homeDir, restore } = loadWithIsolatedLicenseEnv(LICENSE_MODULE_ID);
  try {
    withLicenseEnv(null, () => {
      const lp = license.getLicensePath(homeDir);
      fs.mkdirSync(path.dirname(lp), { recursive: true });
      fs.writeFileSync(lp, JSON.stringify({ key: mintTrial() }));
      const v = license.verifyLicense({ homeDir, trustedKeys: TRIAL_TRUSTED });
      assert.equal(v.valid, true);
      assert.equal(v.source, 'entitlement');
    });
  } finally {
    restore();
  }
});

test('a tampered signed token does not unlock Pro', () => {
  const { moduleExports: license, homeDir, restore } = loadWithIsolatedLicenseEnv(LICENSE_MODULE_ID);
  try {
    const tok = mintTrial();
    const [h, , s] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({
      tier: 'enterprise', features: ['sso'], keyId: TRIAL_KID,
    })).toString('base64url');
    withLicenseEnv(`${h}.${forged}.${s}`, () => {
      assert.equal(license.isProLicensed({ homeDir, trustedKeys: TRIAL_TRUSTED }), false);
    });
  } finally {
    restore();
  }
});
