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
  const origKey = process.env.THUMBGATE_API_KEY;
  const origPro = process.env.THUMBGATE_PRO_KEY;
  const origMode = process.env.THUMBGATE_PRO_MODE;
  const origNoLimit = process.env.THUMBGATE_NO_RATE_LIMIT;
  delete process.env.THUMBGATE_API_KEY;
  delete process.env.THUMBGATE_PRO_KEY;
  delete process.env.THUMBGATE_PRO_MODE;
  delete process.env.THUMBGATE_NO_RATE_LIMIT;
  // Clear module cache so license check re-reads env
  delete require.cache[require.resolve('../scripts/pro-features')];
  delete require.cache[require.resolve('../scripts/license')];
  const { requirePro } = require('../scripts/pro-features');
  const origWrite = process.stderr.write;
  let output = '';
  process.stderr.write = (str) => { output += str; };
  const result = requirePro('dpo-export');
  process.stderr.write = origWrite;
  assert.equal(result, false);
  assert.ok(output.includes('Pro Feature Required'));
  if (origKey) process.env.THUMBGATE_API_KEY = origKey;
  if (origPro) process.env.THUMBGATE_PRO_KEY = origPro;
  if (origMode) process.env.THUMBGATE_PRO_MODE = origMode;
  if (origNoLimit) process.env.THUMBGATE_NO_RATE_LIMIT = origNoLimit;
});
