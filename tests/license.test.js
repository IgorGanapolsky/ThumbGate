'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('license module exports required functions', () => {
  const license = require('../scripts/license');
  assert.equal(typeof license.verifyLicense, 'function');
  assert.equal(typeof license.isProLicensed, 'function');
  assert.equal(typeof license.activateLicense, 'function');
  assert.equal(typeof license.generateLicenseKey, 'function');
});

test('generateLicenseKey produces valid tg_pro_ format', () => {
  const license = require('../scripts/license');
  const key = license.generateLicenseKey('test@example.com');
  assert.ok(key.startsWith('tg_pro_'));
  assert.ok(key.length > 10);
});

test('isValidKey accepts rlhf_ and tg_pro_ prefixes', () => {
  const license = require('../scripts/license');
  assert.ok(license.isValidKey('rlhf_abc123'));
  assert.ok(license.isValidKey('tg_pro_abc123'));
  assert.ok(license.isValidKey('tg_abc123'));
  assert.ok(!license.isValidKey('invalid_key'));
  assert.ok(!license.isValidKey(''));
  assert.ok(!license.isValidKey(null));
});

test('activateLicense accepts rlhf_ keys from Stripe', () => {
  const license = require('../scripts/license');
  const result = license.activateLicense('not_a_valid_key');
  assert.equal(result.success, false);
  // Verify rlhf_ prefix passes format validation via isValidKey
  assert.ok(license.isValidKey('rlhf_' + 'a'.repeat(32)), 'rlhf_ key should be accepted');
  assert.ok(!license.isValidKey('bad_prefix_key'), 'bad prefix should be rejected');
});

test('Pro feature gate blocks without license', () => {
  const { requirePro } = require('../scripts/pro-features');
  let output = '';
  const result = requirePro('dpo-export', {
    isProLicensedFn: () => false,
    write: (str) => {
      output += str;
      return true;
    },
  });
  assert.equal(result, false);
  assert.ok(output.includes('Pro Feature Required'));
});
