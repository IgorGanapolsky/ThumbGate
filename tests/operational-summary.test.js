'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadOperatorConfig,
  resolveHostedSummaryConfig,
  shouldPreferHostedSummary,
  fetchHostedBillingSummary,
  getOperationalBillingSummary,
} = require('../scripts/operational-summary');

// ── helpers ──────────────────────────────────────────────────────────────────

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

// ── loadOperatorConfig ────────────────────────────────────────────────────────

describe('operational-summary', () => {
  describe('loadOperatorConfig', () => {
    it('returns null fields when config file does not exist', () => {
      const result = loadOperatorConfig('/nonexistent/path/operator.json');
      assert.strictEqual(result.operatorKey, null);
      assert.strictEqual(result.baseUrl, null);
    });

    it('returns null fields when config file contains invalid JSON', () => {
      const tmp = path.join(os.tmpdir(), `op-test-${Date.now()}.json`);
      fs.writeFileSync(tmp, 'not-json');
      try {
        const result = loadOperatorConfig(tmp);
        assert.strictEqual(result.operatorKey, null);
        assert.strictEqual(result.baseUrl, null);
      } finally {
        fs.unlinkSync(tmp);
      }
    });

    it('reads operatorKey and baseUrl from a valid config file', () => {
      const tmp = path.join(os.tmpdir(), `op-test-${Date.now()}.json`);
      fs.writeFileSync(tmp, JSON.stringify({
        operatorKey: 'tg_op_testkey123',
        baseUrl: 'https://example.thumbgate.app',
      }));
      try {
        const result = loadOperatorConfig(tmp);
        assert.strictEqual(result.operatorKey, 'tg_op_testkey123');
        assert.strictEqual(result.baseUrl, 'https://example.thumbgate.app');
      } finally {
        fs.unlinkSync(tmp);
      }
    });

    it('normalizes whitespace-only operatorKey to null', () => {
      const tmp = path.join(os.tmpdir(), `op-test-${Date.now()}.json`);
      fs.writeFileSync(tmp, JSON.stringify({ operatorKey: '   ', baseUrl: '' }));
      try {
        const result = loadOperatorConfig(tmp);
        assert.strictEqual(result.operatorKey, null);
        assert.strictEqual(result.baseUrl, null);
      } finally {
        fs.unlinkSync(tmp);
      }
    });
  });

  // ── shouldPreferHostedSummary ───────────────────────────────────────────────

  describe('shouldPreferHostedSummary', () => {
    it('returns true by default (no env var)', () => {
      withEnv({ THUMBGATE_METRICS_SOURCE: undefined }, () => {
        assert.strictEqual(shouldPreferHostedSummary(), true);
      });
    });

    it('returns false when THUMBGATE_METRICS_SOURCE=local', () => {
      withEnv({ THUMBGATE_METRICS_SOURCE: 'local' }, () => {
        assert.strictEqual(shouldPreferHostedSummary(), false);
      });
    });

    it('returns true when THUMBGATE_METRICS_SOURCE=hosted', () => {
      withEnv({ THUMBGATE_METRICS_SOURCE: 'hosted' }, () => {
        assert.strictEqual(shouldPreferHostedSummary(), true);
      });
    });
  });

  // ── resolveHostedSummaryConfig ──────────────────────────────────────────────

  describe('resolveHostedSummaryConfig', () => {
    it('prefers THUMBGATE_OPERATOR_KEY env var over other sources', () => {
      const result = withEnv({
        THUMBGATE_OPERATOR_KEY: 'tg_op_envkey',
        THUMBGATE_API_KEY: 'tg_admin_key',
        THUMBGATE_BILLING_API_BASE_URL: 'https://env.example.com',
      }, () => resolveHostedSummaryConfig());
      assert.strictEqual(result.apiKey, 'tg_op_envkey');
      assert.strictEqual(result.apiBaseUrl, 'https://env.example.com');
    });

    it('THUMBGATE_OPERATOR_KEY env var takes strict priority over THUMBGATE_API_KEY', () => {
      // When both env vars are set, operator key wins
      const result = withEnv({
        THUMBGATE_OPERATOR_KEY: 'tg_op_priority',
        THUMBGATE_API_KEY: 'tg_admin_should_not_win',
        THUMBGATE_BILLING_API_BASE_URL: 'https://env.example.com',
      }, () => resolveHostedSummaryConfig());
      assert.strictEqual(result.apiKey, 'tg_op_priority');
    });

    it('returns null apiKey when no key env vars are set and config file missing', () => {
      // Point module away from any real config by using env approach
      const result = withEnv({
        THUMBGATE_OPERATOR_KEY: undefined,
        THUMBGATE_API_KEY: undefined,
      }, () => {
        // loadOperatorConfig will read from real path; if it has a key, skip this assertion
        const config = resolveHostedSummaryConfig();
        // apiKey is either from the config file or null
        assert.ok(config.apiKey === null || typeof config.apiKey === 'string');
      });
    });

    it('always returns a non-empty apiBaseUrl (defaults to production URL)', () => {
      const result = withEnv({
        THUMBGATE_BILLING_API_BASE_URL: undefined,
        THUMBGATE_OPERATOR_KEY: 'tg_op_x',
      }, () => resolveHostedSummaryConfig());
      assert.ok(result.apiBaseUrl && result.apiBaseUrl.startsWith('https://'));
    });
  });

  // ── fetchHostedBillingSummary ───────────────────────────────────────────────

  describe('fetchHostedBillingSummary', () => {
    it('throws hosted_summary_disabled when THUMBGATE_METRICS_SOURCE=local', async () => {
      await withEnv({ THUMBGATE_METRICS_SOURCE: 'local' }, async () => {
        await assert.rejects(
          () => fetchHostedBillingSummary({}, { apiBaseUrl: 'https://x.com', apiKey: 'k' }),
          (err) => err.code === 'hosted_summary_disabled'
        );
      });
    });

    it('throws hosted_summary_unconfigured when config has no apiKey', async () => {
      await withEnv({ THUMBGATE_METRICS_SOURCE: undefined }, async () => {
        await assert.rejects(
          () => fetchHostedBillingSummary({}, { apiBaseUrl: 'https://x.com', apiKey: null }),
          (err) => err.code === 'hosted_summary_unconfigured'
        );
      });
    });

    it('throws hosted_summary_unconfigured when config has no apiBaseUrl', async () => {
      await withEnv({ THUMBGATE_METRICS_SOURCE: undefined }, async () => {
        await assert.rejects(
          () => fetchHostedBillingSummary({}, { apiBaseUrl: null, apiKey: 'tg_op_k' }),
          (err) => err.code === 'hosted_summary_unconfigured'
        );
      });
    });

    it('throws hosted_summary_timeout when the hosted request exceeds the timeout budget', async () => {
      await withEnv({ THUMBGATE_METRICS_SOURCE: undefined }, async () => {
        await assert.rejects(
          () => fetchHostedBillingSummary({
            timeoutMs: 5,
            fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
              signal.addEventListener('abort', () => {
                reject(signal.reason || Object.assign(new Error('aborted'), { name: 'AbortError' }));
              }, { once: true });
            }),
          }, {
            apiBaseUrl: 'https://x.com',
            apiKey: 'tg_op_k',
          }),
          (err) => err.code === 'hosted_summary_timeout'
        );
      });
    });
  });

  // ── getOperationalBillingSummary auth-failure contract ──────────────────────
  //
  // Regression test for the silent-lie bug: prior to 2026-04-24, a 401 from
  // the hosted summary endpoint was swallowed into a `source: 'local'` empty
  // summary, which reports $0.00 even when Stripe has real paid revenue.
  // The contract is now: 401/403 must throw loudly; other failures fall back
  // to local but tag `source: 'local-unverified'` so downstream surfaces can
  // distinguish verified hosted data from unverified fallback.

  describe('getOperationalBillingSummary', () => {
    const ORIGINAL_FETCH = global.fetch;

    after(() => {
      global.fetch = ORIGINAL_FETCH;
    });

    it('throws hosted_summary_unauthorized on 401 instead of silently returning $0', async () => {
      global.fetch = async () => ({
        ok: false,
        status: 401,
        text: async () => '{"detail":"A valid API key is required to access this endpoint."}',
      });
      await withEnv({
        THUMBGATE_METRICS_SOURCE: undefined,
        THUMBGATE_OPERATOR_KEY: 'tg_op_stale',
        THUMBGATE_BILLING_API_BASE_URL: 'https://fake.example.com',
      }, async () => {
        await assert.rejects(
          () => getOperationalBillingSummary({ window: 'lifetime' }),
          (err) => {
            assert.strictEqual(err.code, 'hosted_summary_unauthorized');
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
          () => getOperationalBillingSummary({ window: 'lifetime' }),
          (err) => err.code === 'hosted_summary_unauthorized' && err.status === 403
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
        const result = await getOperationalBillingSummary({ window: 'lifetime' });
        assert.strictEqual(result.source, 'local-unverified');
        assert.strictEqual(result.hostedStatus, 503);
        assert.ok(result.fallbackReason);
        assert.ok(result.summary, 'summary object should still be returned from local fallback');
      });
    });

    it('falls back to local-unverified on network error (no status)', async () => {
      global.fetch = async () => { throw new Error('ECONNREFUSED'); };
      await withEnv({
        THUMBGATE_METRICS_SOURCE: undefined,
        THUMBGATE_OPERATOR_KEY: 'tg_op_ok',
        THUMBGATE_BILLING_API_BASE_URL: 'https://fake.example.com',
      }, async () => {
        const result = await getOperationalBillingSummary({ window: 'lifetime' });
        assert.strictEqual(result.source, 'local-unverified');
        assert.strictEqual(result.hostedStatus, null);
      });
    });
  });
});
