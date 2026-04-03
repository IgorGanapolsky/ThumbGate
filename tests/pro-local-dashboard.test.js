'use strict';
// Set test bypass secrets before module load
process.env.THUMBGATE_DEV_SECRET = 'test-bypass-secret-1234';
process.env.THUMBGATE_DEV_KEY = 'tg_test_synthetic_key';


const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CREATOR_BYPASS_ENV,
  CREATOR_BYPASS_VALUE,
  CREATOR_SYNTHETIC_KEY,
  getLicensePath,
  isCreatorDev,
  readLicense,
  resolveProKey,
  saveLicense,
  startLocalProDashboard,
  validateProKey,
} = require('../scripts/pro-local-dashboard');

test('pro local dashboard helper saves and reloads license keys', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-pro-home-'));
  const licensePath = saveLicense('rlhf_local_saved_key', { homeDir, version: '0.9.9-test' });
  assert.equal(licensePath, getLicensePath(homeDir));

  const license = readLicense({ homeDir });
  assert.equal(license.key, 'rlhf_local_saved_key');
  assert.equal(license.version, '0.9.9-test');
  assert.match(String(license.savedAt), /^\d{4}-\d{2}-\d{2}T/);

  fs.rmSync(homeDir, { recursive: true, force: true });
});

test('pro local dashboard helper prefers RLHF_API_KEY over saved license', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-pro-env-'));
  saveLicense('rlhf_saved_license', { homeDir });

  const resolved = resolveProKey({
    homeDir,
    env: {
      RLHF_API_KEY: 'rlhf_env_override',
    },
  });

  assert.deepEqual(resolved, {
    key: 'rlhf_env_override',
    source: 'env',
  });

  fs.rmSync(homeDir, { recursive: true, force: true });
});

test('pro local dashboard helper ignores unsupported RLHF_API_KEY values', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-pro-invalid-env-'));
  saveLicense('rlhf_saved_license', { homeDir });

  const resolved = resolveProKey({
    homeDir,
    env: {
      RLHF_API_KEY: 'remote-admin-key',
    },
  });

  assert.deepEqual(resolved, {
    key: 'rlhf_saved_license',
    source: 'license',
    licensePath: getLicensePath(homeDir),
  });

  fs.rmSync(homeDir, { recursive: true, force: true });
});

test('pro local dashboard helper validates keys against billing usage endpoint', async () => {
  const valid = await validateProKey('rlhf_valid_key', {
    fetchImpl: async (url, options) => {
      assert.match(url, /\/v1\/billing\/entitlement$/);
      assert.equal(options.headers.Authorization, 'Bearer rlhf_valid_key');
      return {
        ok: true,
        async json() {
          return { valid: true, tier: 'pro', planId: 'pro' };
        },
      };
    },
  });

  const invalid = await validateProKey('rlhf_invalid_key', {
    fetchImpl: async () => ({
      ok: false,
      async json() {
        return {};
      },
    }),
  });

  assert.equal(valid, true);
  assert.equal(invalid, false);
});

test('pro local dashboard helper starts localhost dashboard and seeds pro env', async () => {
  const env = {};
  const started = [];
  const result = await startLocalProDashboard({
    key: 'rlhf_launch_key',
    env,
    port: 0,
    startServerImpl: async ({ port }) => {
      started.push(port);
      return {
        server: { close() {} },
        port: 4123,
      };
    },
  });

  assert.deepEqual(started, [0]);
  assert.equal(env.RLHF_PRO_MODE, '1');
  assert.equal(env.RLHF_API_KEY, 'rlhf_launch_key');
  assert.equal(env.PORT, '0');
  assert.equal(result.port, 4123);
  assert.equal(result.url, 'http://localhost:4123/dashboard');
});

// ── Creator dev bypass tests ────────────────────────────────────

test('isCreatorDev returns true when env var matches bypass value', () => {
  assert.equal(isCreatorDev({ env: { [CREATOR_BYPASS_ENV]: CREATOR_BYPASS_VALUE }, homeDir: '/nonexistent' }), true);
});

test('isCreatorDev returns false for wrong env var value', () => {
  assert.equal(isCreatorDev({ env: { [CREATOR_BYPASS_ENV]: 'true' }, homeDir: '/nonexistent' }), false);
  assert.equal(isCreatorDev({ env: { [CREATOR_BYPASS_ENV]: '1' }, homeDir: '/nonexistent' }), false);
  assert.equal(isCreatorDev({ env: {}, homeDir: '/nonexistent' }), false);
});

test('isCreatorDev returns true when config file has correct bypass value', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-creator-'));
  const configDir = path.join(tmpHome, '.config', 'thumbgate');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'dev.json'), JSON.stringify({ bypass: CREATOR_BYPASS_VALUE }));

  assert.equal(isCreatorDev({ env: {}, homeDir: tmpHome }), true);
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('isCreatorDev returns false when config file has wrong value', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-creator-bad-'));
  const configDir = path.join(tmpHome, '.config', 'thumbgate');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'dev.json'), JSON.stringify({ bypass: 'wrong-value' }));

  assert.equal(isCreatorDev({ env: {}, homeDir: tmpHome }), false);
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('resolveProKey returns creator-dev source with enterprise plan when bypass is active', () => {
  const resolved = resolveProKey({ env: { [CREATOR_BYPASS_ENV]: CREATOR_BYPASS_VALUE }, homeDir: '/nonexistent' });
  assert.equal(resolved.key, CREATOR_SYNTHETIC_KEY);
  assert.equal(resolved.source, 'creator-dev');
  assert.equal(resolved.plan, 'enterprise');
});

test('creator bypass takes priority over env RLHF_API_KEY and saved license', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-creator-prio-'));
  saveLicense('rlhf_saved_key', { homeDir: tmpHome });

  const resolved = resolveProKey({
    env: { [CREATOR_BYPASS_ENV]: CREATOR_BYPASS_VALUE, RLHF_API_KEY: 'rlhf_env_key' },
    homeDir: tmpHome,
  });

  assert.equal(resolved.source, 'creator-dev', 'creator bypass must take priority');
  assert.equal(resolved.key, CREATOR_SYNTHETIC_KEY);
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('startLocalProDashboard works without key when creator bypass is active', async () => {
  const env = { [CREATOR_BYPASS_ENV]: CREATOR_BYPASS_VALUE };
  const result = await startLocalProDashboard({
    key: '',
    env,
    port: 0,
    homeDir: '/nonexistent',
    startServerImpl: async ({ port }) => ({ server: { close() {} }, port: 5555 }),
  });
  assert.equal(result.port, 5555);
  assert.equal(env.RLHF_PRO_MODE, '1');
});
