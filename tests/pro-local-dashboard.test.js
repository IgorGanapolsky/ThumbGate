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
  canSendProActivationAlert,
  fingerprintProKey,
  getLicensePath,
  isCreatorDev,
  notifyHostedProActivation,
  readLicense,
  renderProActivationAlertBodies,
  resolveProActivationAlertRecipient,
  resolveProKey,
  saveLicense,
  sendProActivationAlert,
  startLocalProDashboard,
  validateProKey,
} = require('../scripts/pro-local-dashboard');

test('pro local dashboard helper saves and reloads license keys', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-paid-home-'));
  const licensePath = saveLicense('tg_local_saved_key', { homeDir, version: '0.8.4-test' });
  assert.equal(licensePath, getLicensePath(homeDir));

  const license = readLicense({ homeDir });
  assert.equal(license.key, 'tg_local_saved_key');
  assert.equal(license.version, '0.8.4-test');
  assert.match(String(license.savedAt), /^\d{4}-\d{2}-\d{2}T/);

  fs.rmSync(homeDir, { recursive: true, force: true });
});

test('pro local dashboard helper prefers THUMBGATE_API_KEY over saved license', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-paid-env-'));
  saveLicense('tg_saved_license', { homeDir });

  const resolved = resolveProKey({
    homeDir,
    env: {
      THUMBGATE_API_KEY: 'tg_env_override',
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
  assert.equal(env.THUMBGATE_PRO_MODE, '1');
  assert.equal(env.THUMBGATE_API_KEY, 'tg_launch_key');
  assert.equal(env.PORT, '0');
  assert.equal(result.port, 4123);
  assert.equal(result.url, 'http://localhost:4123/dashboard');
});

test('pro activation alert sends a secret-safe owner email', async () => {
  const rawKey = 'tg_pro_unit_test_secret_key_1234567890';
  const sent = [];

  const result = await sendProActivationAlert({
    key: rawKey,
    source: 'unit_test_activate',
    version: '9.9.9-test',
    env: {
      THUMBGATE_PRO_ACTIVATION_ALERT_EMAIL: 'owner@example.com',
    },
    sendEmailImpl: async (payload) => {
      sent.push(payload);
      return { sent: true, id: 'email_test_activation' };
    },
  });

  assert.deepEqual(result, { sent: true, id: 'email_test_activation' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'owner@example.com');
  assert.equal(sent[0].subject, 'ThumbGate Pro activated');
  assert.match(sent[0].text, /ThumbGate Pro activation detected/);
  assert.match(sent[0].text, /Key fingerprint: sha256:/);
  assert.match(sent[0].html, /Key fingerprint/);
  assert.doesNotMatch(sent[0].text, new RegExp(rawKey));
  assert.doesNotMatch(sent[0].html, new RegExp(rawKey));
});

test('pro activation alert skips cleanly when email is unconfigured', async () => {
  const result = await sendProActivationAlert({
    key: 'tg_pro_unit_test_secret_key_0987654321',
    env: {
      RESEND_API_KEY: '',
      THUMBGATE_RESEND_API_KEY: '',
    },
    sendEmailImpl: null,
  });

  assert.deepEqual(result, {
    sent: false,
    reason: 'activation_alert_disabled_or_unconfigured',
  });
});

test('pro activation alert can be disabled explicitly', () => {
  assert.equal(canSendProActivationAlert({
    env: {
      RESEND_API_KEY: 're_test_key',
      THUMBGATE_DISABLE_PRO_ACTIVATION_ALERTS: '1',
    },
  }), false);
});

test('pro activation alert fingerprints keys without exposing the key', () => {
  const key = 'tg_pro_unit_test_fingerprint_key_1234567890';
  const fingerprint = fingerprintProKey(key);
  const bodies = renderProActivationAlertBodies({
    keyFingerprint: fingerprint,
    source: 'unit_test',
    version: '1.2.3',
    activatedAt: '2026-07-09T12:00:00.000Z',
    hostname: 'test-host',
    platform: 'darwin',
    arch: 'arm64',
    nodeVersion: 'v99.0.0',
  });

  assert.match(fingerprint, /^sha256:[a-f0-9]{12}$/);
  assert.equal(resolveProActivationAlertRecipient({
    THUMBGATE_PRO_ACTIVATION_ALERT_EMAIL: 'alerts@example.com',
  }), 'alerts@example.com');
  assert.match(bodies.text, new RegExp(fingerprint));
  assert.match(bodies.html, new RegExp(fingerprint));
  assert.doesNotMatch(bodies.text, new RegExp(key));
  assert.doesNotMatch(bodies.html, new RegExp(key));
});

test('hosted pro activation notifier sends key only as bearer auth', async () => {
  const rawKey = 'tg_pro_unit_test_notify_key_1234567890';
  let captured = null;
  const result = await notifyHostedProActivation({
    key: rawKey,
    source: 'unit_test_cli',
    version: '7.7.7-test',
    apiBaseUrl: 'https://api.example.com/base',
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            alert: { sent: true, id: 'email_activation_test' },
            keyFingerprint: fingerprintProKey(rawKey),
          };
        },
      };
    },
  });

  assert.equal(result.notified, true);
  assert.equal(result.alert.sent, true);
  assert.equal(captured.url, 'https://api.example.com/v1/billing/pro-activation');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers.authorization, `Bearer ${rawKey}`);
  const body = JSON.parse(captured.init.body);
  assert.equal(body.source, 'unit_test_cli');
  assert.equal(body.version, '7.7.7-test');
  assert.match(body.keyFingerprint, /^sha256:[a-f0-9]{12}$/);
  assert.doesNotMatch(captured.init.body, new RegExp(rawKey));
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

test('creator bypass takes priority over env THUMBGATE_API_KEY and saved license', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-creator-prio-'));
  saveLicense('tg_saved_key', { homeDir: tmpHome });

  const resolved = resolveProKey({
    env: { [CREATOR_BYPASS_ENV]: CREATOR_BYPASS_VALUE, THUMBGATE_API_KEY: 'tg_env_key' },
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
  assert.equal(env.THUMBGATE_PRO_MODE, '1');
});
