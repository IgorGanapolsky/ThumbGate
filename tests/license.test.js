'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadWithIsolatedLicenseEnv } = require('./helpers/license-env');

const LICENSE_MODULE_ID = require.resolve('../scripts/license');
const PRO_FEATURES_MODULE_ID = require.resolve('../scripts/pro-features');

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
    assert.equal(verified.key, key);
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
    assert.equal(verified.key, 'tg_pro_envtiercoverage1234567890');
  } finally {
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
