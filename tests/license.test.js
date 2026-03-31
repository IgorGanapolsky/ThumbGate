'use strict';
const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

test('license module exports required functions', () => {
  const license = require('../scripts/license');
  assert.equal(typeof license.verifyLicense, 'function');
  assert.equal(typeof license.isProLicensed, 'function');
  assert.equal(typeof license.activateLicense, 'function');
  assert.equal(typeof license.generateLicenseKey, 'function');
});

test('verifyLicense returns invalid when no license exists', () => {
  const origKey = process.env.RLHF_API_KEY;
  const origPro = process.env.THUMBGATE_PRO_KEY;
  delete process.env.RLHF_API_KEY;
  delete process.env.THUMBGATE_PRO_KEY;

  const license = require('../scripts/license');
  const result = license.verifyLicense();
  assert.equal(result.valid, false);

  if (origKey) process.env.RLHF_API_KEY = origKey;
  if (origPro) process.env.THUMBGATE_PRO_KEY = origPro;
});

test('generateLicenseKey produces valid key format', () => {
  const license = require('../scripts/license');
  const key = license.generateLicenseKey('test@example.com');
  assert.ok(key.startsWith('tg_pro_'), `Key should start with tg_pro_, got: ${key}`);
  assert.ok(key.length > 10, 'Key should be longer than 10 chars');
});

test('Pro feature gate blocks without license', () => {
  const origKey = process.env.RLHF_API_KEY;
  const origPro = process.env.THUMBGATE_PRO_KEY;
  delete process.env.RLHF_API_KEY;
  delete process.env.THUMBGATE_PRO_KEY;

  const { requirePro } = require('../scripts/pro-features');
  // Capture stderr
  const origWrite = process.stderr.write;
  let output = '';
  process.stderr.write = (str) => { output += str; };

  const result = requirePro('dpo-export');

  process.stderr.write = origWrite;
  assert.equal(result, false);
  assert.ok(output.includes('Pro Feature Required'));
  assert.ok(output.includes('$49'));

  if (origKey) process.env.RLHF_API_KEY = origKey;
  if (origPro) process.env.THUMBGATE_PRO_KEY = origPro;
});
