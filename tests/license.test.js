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
    assert.equal(typeof license.generateLicenseKey, 'function');
    assert.equal(typeof license.getLicensePath, 'function');
  } finally {
    restore();
  }
});

test('generateLicenseKey produces valid tg_pro_ format', () => {
  const { moduleExports: license, restore } = loadWithIsolatedLicenseEnv(LICENSE_MODULE_ID);
  try {
    const key = license.generateLicenseKey('test@example.com');
    assert.ok(key.startsWith('tg_pro_'));
    assert.ok(key.length > 10);
  } finally {
    restore();
  }
});

test('isValidKey accepts legacy and ThumbGate prefixes', () => {
  const { moduleExports: license, restore } = loadWithIsolatedLicenseEnv(LICENSE_MODULE_ID);
  try {
    assert.ok(license.isValidKey('rlhf_abc123'));
    assert.ok(license.isValidKey('tg_pro_abc123'));
    assert.ok(license.isValidKey('tg_abc123'));
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
    assert.ok(license.isValidKey(`rlhf_${'a'.repeat(32)}`), 'rlhf_ key should be accepted');
    assert.ok(license.isValidKey(`tg_${'a'.repeat(32)}`), 'tg_ key should be accepted');
    assert.ok(!license.isValidKey('bad_prefix_key'), 'bad prefix should be rejected');
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
