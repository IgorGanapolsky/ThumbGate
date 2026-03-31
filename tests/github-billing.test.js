'use strict';

/**
 * tests/github-billing.test.js
 *
 * Tests for GitHub Marketplace integration in scripts/billing.js and API server.
 */

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

let tmpDir;
let keyStorePath;
let revenueLedgerPath;

function setupTempStore() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-billing-test-'));
  keyStorePath = path.join(tmpDir, 'api-keys.json');
  revenueLedgerPath = path.join(tmpDir, 'revenue-events.jsonl');
  process.env._TEST_API_KEYS_PATH = keyStorePath;
  process.env._TEST_REVENUE_LEDGER_PATH = revenueLedgerPath;
  process.env._TEST_FUNNEL_LEDGER_PATH = path.join(tmpDir, 'funnel-events.jsonl');
  fs.writeFileSync(keyStorePath, JSON.stringify({ keys: {} }), 'utf-8');
}

function cleanupTempStore() {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  delete process.env._TEST_API_KEYS_PATH;
  delete process.env._TEST_REVENUE_LEDGER_PATH;
  delete process.env._TEST_FUNNEL_LEDGER_PATH;
  delete process.env.RLHF_GITHUB_MARKETPLACE_PLAN_PRICES_JSON;
}

function readRevenueEvents() {
  if (!revenueLedgerPath || !fs.existsSync(revenueLedgerPath)) return [];
  return fs.readFileSync(revenueLedgerPath, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('billing.js — GitHub Marketplace Webhooks', () => {
  let billing;

  before(() => {
    setupTempStore();
    delete require.cache[require.resolve('../scripts/billing')];
    billing = require('../scripts/billing');
  });

  after(() => {
    cleanupTempStore();
    delete require.cache[require.resolve('../scripts/billing')];
  });

  test('handleGithubWebhook — purchased provisions an API key', () => {
    const event = {
      action: 'purchased',
      marketplace_purchase: {
        account: {
          type: 'User',
          id: 12345,
          login: 'octocat'
        },
        plan: { id: 1, name: 'Context Gateway' }
      }
    };

    const result = billing.handleGithubWebhook(event);
    assert.equal(result.handled, true);
    assert.equal(result.action, 'provisioned_api_key');
    assert.ok(result.result.key.startsWith('rlhf_'));
    assert.equal(result.result.customerId, 'github_user_12345');

    // Verify key is valid
    const validation = billing.validateApiKey(result.result.key);
    assert.equal(validation.valid, true);
    assert.equal(validation.customerId, 'github_user_12345');

    const revenueEvents = readRevenueEvents();
    assert.equal(revenueEvents.length, 1);
    assert.equal(revenueEvents[0].provider, 'github_marketplace');
    assert.equal(revenueEvents[0].amountKnown, false);
  });

  test('handleGithubWebhook — purchased uses configured plan pricing when available', () => {
    process.env.RLHF_GITHUB_MARKETPLACE_PLAN_PRICES_JSON = JSON.stringify({
      11: { amountCents: 4900, currency: 'USD', recurringInterval: null },
    });
    delete require.cache[require.resolve('../scripts/billing')];
    billing = require('../scripts/billing');

    const event = {
      action: 'purchased',
      marketplace_purchase: {
        account: {
          type: 'Organization',
          id: 2026,
          login: 'memory-gateway'
        },
        plan: { id: 11, name: 'Pro' }
      }
    };

    const result = billing.handleGithubWebhook(event);
    assert.equal(result.handled, true);

    const revenueEvents = readRevenueEvents();
    const latest = revenueEvents[revenueEvents.length - 1];
    assert.equal(latest.amountKnown, true);
    assert.equal(latest.amountCents, 4900);
    assert.equal(latest.currency, 'USD');
    assert.equal(latest.recurringInterval, null);
    assert.equal(latest.metadata.githubMarketplaceAmountSource, 'configured_plan_price');

    delete process.env.RLHF_GITHUB_MARKETPLACE_PLAN_PRICES_JSON;
    delete require.cache[require.resolve('../scripts/billing')];
    billing = require('../scripts/billing');
  });

  test('handleGithubWebhook — purchased uses webhook pricing when present', () => {
    const event = {
      action: 'purchased',
      marketplace_purchase: {
        billing_cycle: 'monthly',
        account: {
          type: 'Organization',
          id: 2027,
          login: 'gates'
        },
        plan: {
          id: 12,
          name: 'Pro',
          monthly_price_in_cents: 4900,
          yearly_price_in_cents: 49000,
          price_model: 'FLAT_RATE'
        }
      }
    };

    const result = billing.handleGithubWebhook(event);
    assert.equal(result.handled, true);

    const revenueEvents = readRevenueEvents();
    const latest = revenueEvents[revenueEvents.length - 1];
    assert.equal(latest.amountKnown, true);
    assert.equal(latest.amountCents, 4900);
    assert.equal(latest.currency, 'USD');
    assert.equal(latest.recurringInterval, 'month');
    assert.equal(latest.metadata.billingCycle, 'monthly');
    assert.equal(latest.metadata.monthlyPriceInCents, 4900);
    assert.equal(latest.metadata.yearlyPriceInCents, 49000);
    assert.equal(latest.metadata.priceModel, 'FLAT_RATE');
    assert.equal(latest.metadata.githubMarketplaceAmountSource, 'webhook');
  });

  test('handleGithubWebhook — purchased multiplies per-unit webhook pricing by unit count', () => {
    const event = {
      action: 'purchased',
      marketplace_purchase: {
        billing_cycle: 'monthly',
        unit_count: 3,
        account: {
          type: 'Organization',
          id: 2028,
          login: 'gates-team'
        },
        plan: {
          id: 13,
          name: 'Team',
          monthly_price_in_cents: 1500,
          yearly_price_in_cents: 15000,
          price_model: 'PER_UNIT'
        }
      }
    };

    const result = billing.handleGithubWebhook(event);
    assert.equal(result.handled, true);

    const revenueEvents = readRevenueEvents();
    const latest = revenueEvents[revenueEvents.length - 1];
    assert.equal(latest.amountKnown, true);
    assert.equal(latest.amountCents, 4500);
    assert.equal(latest.currency, 'USD');
    assert.equal(latest.recurringInterval, 'month');
    assert.equal(latest.metadata.unitCount, 3);
    assert.equal(latest.metadata.priceModel, 'PER_UNIT');
  });

  test('handleGithubWebhook — cancelled disables API keys', () => {
    // Fire cancelled webhook
    const event = {
      action: 'cancelled',
      marketplace_purchase: {
        account: {
          type: 'User',
          id: 12345,
          login: 'octocat'
        }
      }
    };

    const result = billing.handleGithubWebhook(event);
    assert.equal(result.handled, true);
    assert.equal(result.action, 'disabled_customer_keys');
    assert.equal(result.result.disabledCount, 1);

    // Verify all keys for this customer are now invalid
    const store = billing.loadKeyStore();
    const keys = Object.keys(store.keys).filter(k => store.keys[k].customerId === 'github_user_12345');
    for (const k of keys) {
      assert.equal(billing.validateApiKey(k).valid, false);
    }
  });

  test('handleGithubWebhook — changed (upgrade) ensures key exists', () => {
    const event = {
      action: 'changed',
      marketplace_purchase: {
        account: {
          type: 'Organization',
          id: 67890,
          login: 'github'
        },
        plan: { id: 2, name: 'Context Gateway Plus' }
      }
    };

    const result = billing.handleGithubWebhook(event);
    assert.equal(result.handled, true);
    assert.equal(result.action, 'plan_changed');
    assert.ok(result.result.key.startsWith('rlhf_'));
    assert.equal(result.result.customerId, 'github_organization_67890');
  });

  test('verifyGithubWebhookSignature — returns true in local mode', () => {
    const oldSecret = process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET;
    delete process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET;
    
    // Need to re-require to pick up env change or just use the logic
    // Since billing.js captures it at top level, we'll just check the exported function
    const res = billing.verifyGithubWebhookSignature('body', 'any-sig');
    assert.equal(res, true);

    if (oldSecret) process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET = oldSecret;
  });

  test('handleGithubWebhook — purchased is idempotent for repeated marketplace order events', () => {
    const event = {
      action: 'purchased',
      marketplace_purchase: {
        id: 4444,
        account: {
          type: 'User',
          id: 333,
          login: 'repeatbuyer'
        },
        plan: { id: 1, name: 'Context Gateway' }
      }
    };

    billing.handleGithubWebhook(event);
    billing.handleGithubWebhook(event);

    const revenueEvents = readRevenueEvents().filter((entry) => entry.orderId === '4444');
    assert.equal(revenueEvents.length, 1);
  });
});

describe('API server — GitHub Webhook Route', () => {
  let server;
  let port;

  before(async () => {
    setupTempStore();
    process.env.RLHF_ALLOW_INSECURE = 'true';
    delete process.env.GITHUB_MARKETPLACE_WEBHOOK_SECRET;

    const { startServer } = require('../src/api/server');
    const started = await startServer({ port: 0 });
    server = started.server;
    port = started.port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    cleanupTempStore();
    delete process.env.RLHF_ALLOW_INSECURE;
  });

  async function apiRequest(method, path, body, headers = {}) {
    const http = require('http');
    return new Promise((resolve, reject) => {
      const bodyStr = body ? JSON.stringify(body) : undefined;
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
      };
      const req = http.request(options, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString('utf-8');
            resolve({ status: res.statusCode, body: JSON.parse(text) });
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  test('POST /v1/billing/github-webhook processes purchase', async () => {
    const event = {
      action: 'purchased',
      marketplace_purchase: {
        account: { type: 'User', id: 999, login: 'testuser' },
        plan: { id: 1 }
      }
    };

    const res = await apiRequest('POST', '/v1/billing/github-webhook', event);
    assert.equal(res.status, 200);
    assert.equal(res.body.handled, true);
    assert.equal(res.body.action, 'provisioned_api_key');
    assert.equal(res.body.result.customerId, 'github_user_999');
  });

  test('POST /v1/billing/github-webhook handles invalid JSON', async () => {
    const http = require('http');
    const res = await new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/v1/billing/github-webhook',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        resolve(res.statusCode);
      });
      req.write('not-json');
      req.end();
    });
    assert.equal(res, 400);
  });
});
