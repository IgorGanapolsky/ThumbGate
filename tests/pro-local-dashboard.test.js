'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  getLicensePath,
  readLicense,
  resolveProKey,
  saveLicense,
  startLocalProDashboard,
  validateProKey,
} = require('../scripts/pro-local-dashboard');

test('pro local dashboard helper saves and reloads license keys', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-pro-home-'));
  const licensePath = saveLicense('tg_local_saved_key', { homeDir, version: '0.8.4-test' });
  assert.equal(licensePath, getLicensePath(homeDir));

  const license = readLicense({ homeDir });
  assert.equal(license.key, 'tg_local_saved_key');
  assert.equal(license.version, '0.8.4-test');
  assert.match(String(license.savedAt), /^\d{4}-\d{2}-\d{2}T/);

  fs.rmSync(homeDir, { recursive: true, force: true });
});

test('pro local dashboard helper prefers RLHF_API_KEY over saved license', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-pro-env-'));
  saveLicense('tg_saved_license', { homeDir });

  const resolved = resolveProKey({
    homeDir,
    env: {
      RLHF_API_KEY: 'tg_env_override',
    },
  });

  assert.deepEqual(resolved, {
    key: 'tg_env_override',
    source: 'env',
  });

  fs.rmSync(homeDir, { recursive: true, force: true });
});

test('pro local dashboard helper validates keys against billing usage endpoint', async () => {
  const valid = await validateProKey('tg_valid_key', {
    fetchImpl: async (url, options) => {
      assert.match(url, /\/v1\/billing\/usage$/);
      assert.equal(options.headers.Authorization, 'Bearer tg_valid_key');
      return {
        ok: true,
        async json() {
          return { key: 'tg_valid_key' };
        },
      };
    },
  });

  const invalid = await validateProKey('tg_invalid_key', {
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
    key: 'tg_launch_key',
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
  assert.equal(env.RLHF_API_KEY, 'tg_launch_key');
  assert.equal(env.PORT, '0');
  assert.equal(result.port, 4123);
  assert.equal(result.url, 'http://localhost:4123/dashboard');
});
