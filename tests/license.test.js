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

test('Pro feature gate blocks without license', () => {
  const origKey = process.env.RLHF_API_KEY;
  const origPro = process.env.THUMBGATE_PRO_KEY;
  delete process.env.RLHF_API_KEY;
  delete process.env.THUMBGATE_PRO_KEY;
  const { requirePro } = require('../scripts/pro-features');
  const origWrite = process.stderr.write;
  let output = '';
  process.stderr.write = (str) => { output += str; };
  const result = requirePro('dpo-export');
  process.stderr.write = origWrite;
  assert.equal(result, false);
  assert.ok(output.includes('Pro Feature Required'));
  if (origKey) process.env.RLHF_API_KEY = origKey;
  if (origPro) process.env.THUMBGATE_PRO_KEY = origPro;
});
