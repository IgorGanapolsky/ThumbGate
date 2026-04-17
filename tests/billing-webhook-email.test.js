'use strict';

/**
 * tests/billing-webhook-email.test.js
 *
 * Verifies that handleWebhook invokes the mailer on checkout.session.completed
 * and that mailer failures do not break the webhook flow.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const billingModulePath = require.resolve('../scripts/billing');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-webhook-email-'));

const savedEnv = {
  _TEST_API_KEYS_PATH: process.env._TEST_API_KEYS_PATH,
  _TEST_FUNNEL_LEDGER_PATH: process.env._TEST_FUNNEL_LEDGER_PATH,
  _TEST_REVENUE_LEDGER_PATH: process.env._TEST_REVENUE_LEDGER_PATH,
  _TEST_LOCAL_CHECKOUT_SESSIONS_PATH: process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH,
  THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
};

function primeEnv(suffix) {
  process.env._TEST_API_KEYS_PATH = path.join(tmpRoot, `api-keys-${suffix}.json`);
  process.env._TEST_FUNNEL_LEDGER_PATH = path.join(tmpRoot, `funnel-${suffix}.jsonl`);
  process.env._TEST_REVENUE_LEDGER_PATH = path.join(tmpRoot, `revenue-${suffix}.jsonl`);
  process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = path.join(tmpRoot, `local-sessions-${suffix}.json`);
  process.env.THUMBGATE_FEEDBACK_DIR = path.join(tmpRoot, `feedback-${suffix}`);
  // Force non-LOCAL_MODE so handleWebhook actually runs.
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake_for_webhook_test';
  process.env.STRIPE_PRICE_ID = '';
  // No webhook secret → constructEvent path skipped; raw body is JSON-parsed.
  delete process.env.STRIPE_WEBHOOK_SECRET;
}

function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function freshBilling() {
  delete require.cache[billingModulePath];
  return require('../scripts/billing');
}

function makeCheckoutCompletedEvent({ email, customerId, sessionId, name, trialEndUnix }) {
  const obj = {
    id: sessionId,
    customer: customerId,
    customer_details: { email, name: name || null },
    amount_total: 1900,
    currency: 'usd',
    mode: 'subscription',
    payment_status: 'paid',
    metadata: { installId: 'install_test', traceId: 'trace_test' },
  };
  if (typeof trialEndUnix === 'number') {
    obj.subscription = { trial_end: trialEndUnix };
  }
  return {
    id: 'evt_' + Math.random().toString(36).slice(2),
    type: 'checkout.session.completed',
    data: { object: obj },
  };
}

test.after(() => {
  restoreEnv();
  delete require.cache[billingModulePath];
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('handleWebhook invokes mailer.sendTrialWelcomeEmail with license key + customer email', async () => {
  primeEnv('happy');
  const billing = freshBilling();

  const calls = [];
  billing._mailer = {
    sendTrialWelcomeEmail: async (args) => {
      calls.push(args);
      return { sent: true, id: 'email_fake_123' };
    },
  };

  const trialEndUnix = Math.floor(Date.UTC(2026, 3, 24) / 1000);
  const event = makeCheckoutCompletedEvent({
    email: 'buyer@example.com',
    customerId: 'cus_test_happy',
    sessionId: 'cs_test_happy',
    name: 'Ada Lovelace',
    trialEndUnix,
  });

  const res = await billing.handleWebhook(Buffer.from(JSON.stringify(event)), null);

  assert.equal(res.handled, true);
  assert.equal(res.action, 'provisioned_api_key');
  assert.ok(res.result && typeof res.result.key === 'string' && res.result.key.startsWith('tg_'));
  assert.equal(res.email.sent, true);

  assert.equal(calls.length, 1, 'mailer should be invoked exactly once');
  assert.equal(calls[0].to, 'buyer@example.com');
  assert.equal(calls[0].licenseKey, res.result.key);
  assert.equal(calls[0].customerId, 'cus_test_happy');
  // New: the Stripe customer name flows through to the mailer for personalization.
  assert.equal(calls[0].customerName, 'Ada Lovelace');
  // New: trial expiry (from Stripe subscription.trial_end unix) flows through as a Date.
  assert.ok(calls[0].trialEndAt instanceof Date, 'trialEndAt should be a Date');
  assert.equal(calls[0].trialEndAt.getUTCFullYear(), 2026);
  assert.equal(calls[0].trialEndAt.getUTCMonth(), 3); // April (0-indexed)
  assert.equal(calls[0].trialEndAt.getUTCDate(), 24);

  billing._mailer = null;
});

test('handleWebhook succeeds even when mailer throws', async () => {
  primeEnv('throws');
  const billing = freshBilling();

  billing._mailer = {
    sendTrialWelcomeEmail: async () => { throw new Error('resend is down'); },
  };

  const event = makeCheckoutCompletedEvent({
    email: 'buyer2@example.com',
    customerId: 'cus_test_throws',
    sessionId: 'cs_test_throws',
  });

  const res = await billing.handleWebhook(Buffer.from(JSON.stringify(event)), null);

  assert.equal(res.handled, true, 'webhook must still report handled=true on mailer failure');
  assert.equal(res.action, 'provisioned_api_key');
  assert.ok(res.result && res.result.key);
  assert.equal(res.email.sent, false);
  assert.equal(res.email.reason, 'exception');
  assert.match(res.email.error, /resend is down/);

  billing._mailer = null;
});

test('handleWebhook reports no_recipient when customer email missing', async () => {
  primeEnv('norecipient');
  const billing = freshBilling();

  let called = false;
  billing._mailer = {
    sendTrialWelcomeEmail: async () => { called = true; return { sent: true }; },
  };

  const event = {
    id: 'evt_norcp',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_norcp',
        customer: 'cus_test_norcp',
        customer_details: null,
        amount_total: 1900,
        currency: 'usd',
        mode: 'subscription',
        metadata: {},
      },
    },
  };

  const res = await billing.handleWebhook(Buffer.from(JSON.stringify(event)), null);
  assert.equal(res.handled, true);
  assert.equal(res.email.sent, false);
  assert.equal(res.email.reason, 'no_recipient');
  assert.equal(called, false, 'mailer should not be called with no recipient');

  billing._mailer = null;
});
