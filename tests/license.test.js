'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('license module exports required functions', () => {
  const license = require('../scripts/license');
  assert.equal(typeof license.verifyLicense, 'function');
  assert.equal(typeof license.isProLicensed, 'function');
  assert.equal(typeof license.activateLicense, 'function');
  assert.equal(typeof license.generateLicenseKey, 'function');
  assert.equal(typeof license.isValidKey, 'function');
  assert.equal(typeof license.fetchLicenseEntitlement, 'function');
  assert.equal(typeof license.validateAndActivateLicense, 'function');
});

test('generateLicenseKey produces valid tg_pro_ format', () => {
  const license = require('../scripts/license');
  const key = license.generateLicenseKey('test@example.com');
  assert.ok(key.startsWith('tg_pro_'));
  assert.ok(key.length > 10);
});

test('activateLicense persists a ThumbGate-issued rlhf_ key', () => {
  const license = require('../scripts/license');
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-activate-test-'));
  const result = license.activateLicense('rlhf_test_key_123', {
    homeDir,
    version: '0.9.9-test',
    entitlement: {
      valid: true,
      tier: 'pro',
      planId: 'pro',
      billingCycle: 'monthly',
    },
  });

  assert.equal(result.success, true);
  const saved = license.readLicense({ homeDir });
  assert.equal(saved.key, 'rlhf_test_key_123');
  assert.equal(saved.version, '0.9.9-test');
  assert.equal(saved.entitlement.tier, 'pro');
  fs.rmSync(homeDir, { recursive: true, force: true });
});

test('fetchLicenseEntitlement resolves the hosted runtime unlock shape', async () => {
  const license = require('../scripts/license');
  const entitlement = await license.fetchLicenseEntitlement('rlhf_valid_key', {
    fetchImpl: async (url, options) => {
      assert.match(url, /\/v1\/billing\/entitlement$/);
      assert.equal(options.headers.Authorization, 'Bearer rlhf_valid_key');
      return {
        ok: true,
        async json() {
          return {
            valid: true,
            tier: 'pro',
            planId: 'pro',
            billingCycle: 'monthly',
            seatCount: 1,
            features: {
              dashboard: true,
            },
          };
        },
      };
    },
  });

  assert.equal(entitlement.valid, true);
  assert.equal(entitlement.tier, 'pro');
  assert.equal(entitlement.planId, 'pro');
});

test('fetchLicenseEntitlement returns free tier when billing URL is invalid', async () => {
  const license = require('../scripts/license');
  let fetchCalled = false;
  const entitlement = await license.fetchLicenseEntitlement('rlhf_valid_key', {
    apiBaseUrl: 'not-a-valid-url',
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('fetch should not run for invalid billing URLs');
    },
  });

  assert.equal(fetchCalled, false);
  assert.equal(entitlement.valid, false);
  assert.equal(entitlement.tier, 'free');
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
  assert.ok(license.isValidKey(`rlhf_${'a'.repeat(32)}`), 'rlhf_ key should be accepted');
  assert.ok(!license.isValidKey('bad_prefix_key'), 'bad prefix should be rejected');
});

test('Pro feature gate blocks without license', () => {
  const origKey = process.env.RLHF_API_KEY;
  const origPro = process.env.THUMBGATE_PRO_KEY;
  const origMode = process.env.RLHF_PRO_MODE;
  const origNoLimit = process.env.RLHF_NO_RATE_LIMIT;
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  const tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-license-test-'));

  delete process.env.RLHF_API_KEY;
  delete process.env.THUMBGATE_PRO_KEY;
  delete process.env.RLHF_PRO_MODE;
  delete process.env.RLHF_NO_RATE_LIMIT;
  process.env.HOME = tempHomeDir;
  process.env.USERPROFILE = tempHomeDir;

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

  if (origKey) process.env.RLHF_API_KEY = origKey;
  else delete process.env.RLHF_API_KEY;
  if (origPro) process.env.THUMBGATE_PRO_KEY = origPro;
  else delete process.env.THUMBGATE_PRO_KEY;
  if (origMode) process.env.RLHF_PRO_MODE = origMode;
  else delete process.env.RLHF_PRO_MODE;
  if (origNoLimit) process.env.RLHF_NO_RATE_LIMIT = origNoLimit;
  else delete process.env.RLHF_NO_RATE_LIMIT;
  if (origHome) process.env.HOME = origHome;
  else delete process.env.HOME;
  if (origUserProfile) process.env.USERPROFILE = origUserProfile;
  else delete process.env.USERPROFILE;
  fs.rmSync(tempHomeDir, { recursive: true, force: true });
});
