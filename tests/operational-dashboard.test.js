'use strict';
const { describe, it, after } = require('node:test');
const assert = require('node:assert');

const {
  getOperationalDashboard,
} = require('../scripts/operational-dashboard');

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// Regression coverage for the same silent-$0 lie as operational-summary:
// if the hosted dashboard endpoint 401s on a stale operator key, we must
// refuse to render local-ledger numbers as if they were verified truth.
describe('getOperationalDashboard', () => {
  const ORIGINAL_FETCH = global.fetch;

  after(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it('throws hosted_dashboard_unauthorized on 401 instead of silently returning local-only', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 401,
      text: async () => '{"detail":"A valid API key is required."}',
    });
    await withEnv({
      THUMBGATE_METRICS_SOURCE: undefined,
      THUMBGATE_OPERATOR_KEY: 'tg_op_stale',
      THUMBGATE_BILLING_API_BASE_URL: 'https://fake.example.com',
    }, async () => {
      await assert.rejects(
        () => getOperationalDashboard({ window: 'lifetime' }),
        (err) => {
          assert.strictEqual(err.code, 'hosted_dashboard_unauthorized');
          assert.strictEqual(err.status, 401);
          assert.match(err.message, /THUMBGATE_OPERATOR_KEY/);
          assert.match(err.message, /operator\.json/);
          return true;
        }
      );
    });
  });

  it('also throws on 403', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 403,
      text: async () => '',
    });
    await withEnv({
      THUMBGATE_METRICS_SOURCE: undefined,
      THUMBGATE_OPERATOR_KEY: 'tg_op_forbidden',
      THUMBGATE_BILLING_API_BASE_URL: 'https://fake.example.com',
    }, async () => {
      await assert.rejects(
        () => getOperationalDashboard({ window: 'lifetime' }),
        (err) => err.code === 'hosted_dashboard_unauthorized' && err.status === 403
      );
    });
  });

  it('falls back to local-unverified on 503 (non-auth failure)', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });
    await withEnv({
      THUMBGATE_METRICS_SOURCE: undefined,
      THUMBGATE_OPERATOR_KEY: 'tg_op_ok',
      THUMBGATE_BILLING_API_BASE_URL: 'https://fake.example.com',
    }, async () => {
      const result = await getOperationalDashboard({ window: 'lifetime' });
      assert.strictEqual(result.source, 'local-unverified');
      assert.strictEqual(result.hostedStatus, 503);
      assert.ok(result.fallbackReason);
      assert.ok(result.data, 'data object should still be returned from local fallback');
    });
  });

  it('falls back to local-unverified on network error (no status)', async () => {
    global.fetch = async () => { throw new Error('ECONNREFUSED'); };
    await withEnv({
      THUMBGATE_METRICS_SOURCE: undefined,
      THUMBGATE_OPERATOR_KEY: 'tg_op_ok',
      THUMBGATE_BILLING_API_BASE_URL: 'https://fake.example.com',
    }, async () => {
      const result = await getOperationalDashboard({ window: 'lifetime' });
      assert.strictEqual(result.source, 'local-unverified');
      assert.strictEqual(result.hostedStatus, null);
    });
  });
});
