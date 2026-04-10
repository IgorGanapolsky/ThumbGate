'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const billingModulePath = require.resolve('../scripts/billing');
const serverModulePath = require.resolve('../src/api/server');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stripe-webhook-route-'));
const savedEnv = {
  THUMBGATE_ALLOW_INSECURE: process.env.THUMBGATE_ALLOW_INSECURE,
  _TEST_API_KEYS_PATH: process.env._TEST_API_KEYS_PATH,
  _TEST_FUNNEL_LEDGER_PATH: process.env._TEST_FUNNEL_LEDGER_PATH,
  _TEST_REVENUE_LEDGER_PATH: process.env._TEST_REVENUE_LEDGER_PATH,
  _TEST_LOCAL_CHECKOUT_SESSIONS_PATH: process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function primeBillingEnv() {
  process.env.THUMBGATE_ALLOW_INSECURE = 'true';
  process.env._TEST_API_KEYS_PATH = path.join(tmpRoot, 'api-keys.json');
  process.env._TEST_FUNNEL_LEDGER_PATH = path.join(tmpRoot, 'funnel-events.jsonl');
  process.env._TEST_REVENUE_LEDGER_PATH = path.join(tmpRoot, 'revenue-events.jsonl');
  process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = path.join(tmpRoot, 'local-checkout-sessions.json');
  process.env.STRIPE_SECRET_KEY = '';
  process.env.STRIPE_PRICE_ID = '';
  process.env.STRIPE_WEBHOOK_SECRET = '';
}

function freshBilling() {
  delete require.cache[billingModulePath];
  return require('../scripts/billing');
}

async function startServerWithBillingOverrides(overrides = {}) {
  primeBillingEnv();
  delete require.cache[serverModulePath];
  const billing = freshBilling();
  Object.assign(billing, overrides);
  const { startServer } = require('../src/api/server');
  return startServer({ port: 0 });
}

function postWebhook(port, pathname, body, signature = 't=1,v1=deadbeef') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'stripe-signature': signature,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

test.after(() => {
  restoreEnv();
  delete require.cache[billingModulePath];
  delete require.cache[serverModulePath];
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('verifyWebhookSignature accepts Stripe rotation headers with multiple v1 digests', () => {
  primeBillingEnv();
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_rotation';
  const billing = freshBilling();
  const rawBody = '{"id":"evt_rotation"}';
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${timestamp}.${rawBody}`;
  const validDigest = crypto
    .createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');

  const signature = `t=${timestamp},v1=${'0'.repeat(64)},v1=${validDigest}`;
  assert.equal(billing.verifyWebhookSignature(rawBody, signature), true);
});

test('billing webhook returns 400 when Stripe verification fails after precheck', async (t) => {
  const handle = await startServerWithBillingOverrides({
    verifyWebhookSignature: () => true,
    handleWebhook: async () => ({ handled: false, reason: 'invalid_signature', error: 'Stripe SDK rejected payload' }),
  });

  t.after(async () => {
    await new Promise((resolve) => handle.server.close(resolve));
    restoreEnv();
    delete require.cache[billingModulePath];
    delete require.cache[serverModulePath];
  });

  const response = await postWebhook(handle.port, '/v1/billing/webhook', '{"id":"evt_invalid"}');
  assert.equal(response.status, 400);
  assert.match(response.body.detail, /Stripe SDK rejected payload/);
});

test('billing webhook returns 200 for handled Stripe events', async (t) => {
  const handle = await startServerWithBillingOverrides({
    verifyWebhookSignature: () => true,
    handleWebhook: async () => ({ handled: true, action: 'provisioned_api_key' }),
  });

  t.after(async () => {
    await new Promise((resolve) => handle.server.close(resolve));
    restoreEnv();
    delete require.cache[billingModulePath];
    delete require.cache[serverModulePath];
  });

  const response = await postWebhook(handle.port, '/v1/billing/webhook', '{"id":"evt_valid"}');
  assert.equal(response.status, 200);
  assert.equal(response.body.handled, true);
  assert.equal(response.body.action, 'provisioned_api_key');
});

test('legacy Stripe webhook returns 400 when signature verification fails', async (t) => {
  const handle = await startServerWithBillingOverrides({
    verifyWebhookSignature: () => false,
  });

  t.after(async () => {
    await new Promise((resolve) => handle.server.close(resolve));
    restoreEnv();
    delete require.cache[billingModulePath];
    delete require.cache[serverModulePath];
  });

  const response = await postWebhook(
    handle.port,
    '/webhook/stripe',
    JSON.stringify({ id: 'evt_legacy_invalid', type: 'checkout.session.completed', data: { object: {} } }),
  );
  assert.equal(response.status, 400);
  assert.match(response.body.detail, /could not be verified/i);
});

test('legacy Stripe webhook returns 200 for verified tracked events', async (t) => {
  const handle = await startServerWithBillingOverrides({
    verifyWebhookSignature: () => true,
  });

  t.after(async () => {
    await new Promise((resolve) => handle.server.close(resolve));
    restoreEnv();
    delete require.cache[billingModulePath];
    delete require.cache[serverModulePath];
  });

  const response = await postWebhook(
    handle.port,
    '/webhook/stripe',
    JSON.stringify({
      id: 'evt_legacy_valid',
      type: 'checkout.session.completed',
      data: {
        object: {
          customer_email: 'buyer@example.com',
          amount_total: 1900,
          currency: 'usd',
          subscription: 'sub_123',
        },
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.received, true);
  assert.equal(response.body.event_type, 'checkout.session.completed');
});
