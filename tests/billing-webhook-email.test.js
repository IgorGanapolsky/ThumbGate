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
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const billingModulePath = require.resolve('../scripts/billing');
const TEST_DIAGNOSTIC_PAYMENT_LINK_ID = 'plink_testdiagnostic';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-webhook-email-'));

const savedEnv = {
  _TEST_API_KEYS_PATH: process.env._TEST_API_KEYS_PATH,
  _TEST_FUNNEL_LEDGER_PATH: process.env._TEST_FUNNEL_LEDGER_PATH,
  _TEST_REVENUE_LEDGER_PATH: process.env._TEST_REVENUE_LEDGER_PATH,
  _TEST_ORDER_EMAIL_LEDGER_PATH: process.env._TEST_ORDER_EMAIL_LEDGER_PATH,
  _TEST_LOCAL_CHECKOUT_SESSIONS_PATH: process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH,
  THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  THUMBGATE_ALLOW_UNSIGNED_STRIPE_WEBHOOKS: process.env.THUMBGATE_ALLOW_UNSIGNED_STRIPE_WEBHOOKS,
  THUMBGATE_PLAUSIBLE_DISABLE: process.env.THUMBGATE_PLAUSIBLE_DISABLE,
  THUMBGATE_OPERATOR_ALERT_EMAIL: process.env.THUMBGATE_OPERATOR_ALERT_EMAIL,
  THUMBGATE_DIAGNOSTIC_PAYMENT_LINK_ID: process.env.THUMBGATE_DIAGNOSTIC_PAYMENT_LINK_ID,
};

function primeEnv(suffix) {
  process.env._TEST_API_KEYS_PATH = path.join(tmpRoot, `api-keys-${suffix}.json`);
  process.env._TEST_FUNNEL_LEDGER_PATH = path.join(tmpRoot, `funnel-${suffix}.jsonl`);
  process.env._TEST_REVENUE_LEDGER_PATH = path.join(tmpRoot, `revenue-${suffix}.jsonl`);
  process.env._TEST_ORDER_EMAIL_LEDGER_PATH = path.join(tmpRoot, `order-email-${suffix}.jsonl`);
  process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = path.join(tmpRoot, `local-sessions-${suffix}.json`);
  process.env.THUMBGATE_FEEDBACK_DIR = path.join(tmpRoot, `feedback-${suffix}`);
  // Force non-LOCAL_MODE so handleWebhook actually runs.
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake_for_webhook_test';
  process.env.STRIPE_PRICE_ID = '';
  process.env.THUMBGATE_PLAUSIBLE_DISABLE = '1';
  process.env.THUMBGATE_DIAGNOSTIC_PAYMENT_LINK_ID = TEST_DIAGNOSTIC_PAYMENT_LINK_ID;
  process.env.THUMBGATE_OPERATOR_ALERT_EMAIL = 'owner@example.com';
  // Test-only unsigned path exercises mailer side effects without real Stripe keys.
  process.env.THUMBGATE_ALLOW_UNSIGNED_STRIPE_WEBHOOKS = '1';
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

function makeCheckoutCompletedEvent({
  email,
  customerId,
  sessionId,
  name,
  trialEndUnix,
  amountTotal = 1900,
  mode = 'subscription',
  metadata = { installId: 'install_test', traceId: 'trace_test' },
  clientReferenceId,
  paymentStatus = 'paid',
  eventType = 'checkout.session.completed',
  paymentLinkId = mode === 'payment' && amountTotal === 49900
    ? TEST_DIAGNOSTIC_PAYMENT_LINK_ID
    : null,
}) {
  const obj = {
    id: sessionId,
    customer: customerId,
    customer_details: { email, name: name || null },
    amount_total: amountTotal,
    currency: 'usd',
    mode,
    payment_status: paymentStatus,
    metadata,
  };
  if (paymentLinkId) obj.payment_link = paymentLinkId;
  if (clientReferenceId) obj.client_reference_id = clientReferenceId;
  if (typeof trialEndUnix === 'number') {
    obj.subscription = { trial_end: trialEndUnix };
  }
  return {
    id: 'evt_' + Math.random().toString(36).slice(2),
    type: eventType,
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
  assert.match(calls[0].idempotencyKey, /^trial-[a-f0-9]{64}$/);
  // New: trial expiry (from Stripe subscription.trial_end unix) flows through as a Date.
  assert.ok(calls[0].trialEndAt instanceof Date, 'trialEndAt should be a Date');
  assert.equal(calls[0].trialEndAt.getUTCFullYear(), 2026);
  assert.equal(calls[0].trialEndAt.getUTCMonth(), 3); // April (0-indexed)
  assert.equal(calls[0].trialEndAt.getUTCDate(), 24);

  billing._mailer = null;
});

test('a $499 diagnostic payment sends fulfillment emails and never provisions a Pro key', async () => {
  primeEnv('diagnostic');
  process.env.THUMBGATE_OPERATOR_ALERT_EMAIL = 'owner@example.com';
  const billing = freshBilling();
  const { packCheckoutReference } = require('../scripts/checkout-attribution-reference');

  const trialCalls = [];
  const emailCalls = [];
  billing._mailer = {
    sendTrialWelcomeEmail: async (args) => {
      trialCalls.push(args);
      return { sent: true, id: 'wrong_email' };
    },
    sendEmail: async (args) => {
      emailCalls.push(args);
      return { sent: true, id: `email_${emailCalls.length}` };
    },
  };

  const event = makeCheckoutCompletedEvent({
    email: 'diagnostic-buyer@example.com',
    customerId: 'cus_test_diagnostic',
    sessionId: 'cs_test_diagnostic',
    name: 'Ada Lovelace',
    amountTotal: 49900,
    mode: 'payment',
    metadata: {},
    clientReferenceId: packCheckoutReference({
      utmSource: 'aiventyx',
      acquisitionId: 'acq_diagnostic',
      planId: 'sprint_diagnostic',
    }),
  });

  const res = await billing.handleWebhook(Buffer.from(JSON.stringify(event)), null);

  assert.equal(res.handled, true);
  assert.equal(res.action, 'diagnostic_order_recorded');
  assert.equal(res.result, null);
  assert.equal(trialCalls.length, 0, 'diagnostic buyers must not receive a Pro activation email');
  assert.equal(emailCalls.length, 2);
  assert.ok(emailCalls.some((call) => call.to === 'diagnostic-buyer@example.com'));
  assert.ok(emailCalls.some((call) => call.to === 'owner@example.com'));
  assert.ok(emailCalls.some((call) => /diagnostic order received/i.test(call.subject)));
  assert.ok(emailCalls.some((call) => /Paid ThumbGate diagnostic/.test(call.subject)));
  assert.equal(new Set(emailCalls.map((call) => call.idempotencyKey)).size, 2);
  assert.ok(emailCalls.every((call) => /^diagnostic-[a-f0-9]{64}$/.test(call.idempotencyKey)));
  assert.equal(fs.existsSync(process.env._TEST_API_KEYS_PATH), false, 'diagnostic payment must not provision a Pro key');

  const revenueRows = fs.readFileSync(process.env._TEST_REVENUE_LEDGER_PATH, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const paid = revenueRows.find((row) => row.orderId === 'cs_test_diagnostic');
  assert.equal(paid.metadata.offerKind, 'workflow_hardening_diagnostic');
  assert.equal(paid.attribution.source, 'aiventyx');

  const replay = await billing.handleWebhook(Buffer.from(JSON.stringify(event)), null);
  assert.equal(replay.handled, true);
  assert.equal(replay.action, 'diagnostic_order_already_processed');
  assert.equal(emailCalls.length, 2, 'Stripe webhook retries must not duplicate fulfillment emails');
  const funnelRows = fs.readFileSync(process.env._TEST_FUNNEL_LEDGER_PATH, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(funnelRows.filter((row) => row.event === 'stripe_checkout_completed').length, 1);
  assert.equal(funnelRows.filter((row) => row.event === 'checkout_paid_confirmed').length, 1);

  billing._mailer = null;
});

test('an unpaid checkout session is never fulfilled or booked as revenue', async () => {
  primeEnv('unpaid');
  const billing = freshBilling();
  const calls = [];
  billing._mailer = {
    sendEmail: async (args) => {
      calls.push(args);
      return { sent: true, id: 'must_not_send' };
    },
  };

  const event = makeCheckoutCompletedEvent({
    email: 'unpaid@example.com',
    customerId: 'cus_unpaid',
    sessionId: 'cs_unpaid',
    mode: 'payment',
    metadata: { planId: 'sprint_diagnostic' },
    amountTotal: 49900,
    paymentStatus: 'unpaid',
  });
  const result = await billing.handleWebhook(Buffer.from(JSON.stringify(event)), null);

  assert.equal(result.action, 'payment_pending');
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(process.env._TEST_REVENUE_LEDGER_PATH), false);
  assert.equal(fs.existsSync(process.env._TEST_API_KEYS_PATH), false);

  const noPaymentRequired = makeCheckoutCompletedEvent({
    email: 'free-diagnostic@example.com',
    customerId: 'cus_free_diagnostic',
    sessionId: 'cs_free_diagnostic',
    mode: 'payment',
    metadata: { planId: 'sprint_diagnostic' },
    amountTotal: 0,
    paymentStatus: 'no_payment_required',
  });
  const freeResult = await billing.handleWebhook(Buffer.from(JSON.stringify(noPaymentRequired)), null);
  assert.equal(freeResult.action, 'payment_pending');
  assert.equal(calls.length, 0);

  const failed = makeCheckoutCompletedEvent({
    email: 'failed@example.com',
    customerId: 'cus_failed',
    sessionId: 'cs_failed',
    mode: 'payment',
    metadata: { planId: 'sprint_diagnostic' },
    amountTotal: 49900,
    paymentStatus: 'unpaid',
    eventType: 'checkout.session.async_payment_failed',
  });
  const failedResult = await billing.handleWebhook(Buffer.from(JSON.stringify(failed)), null);
  assert.equal(failedResult.action, 'payment_failed');
  assert.equal(calls.length, 0);
  billing._mailer = null;
});

test('a paid one-time service SKU records revenue without provisioning Pro', async () => {
  primeEnv('service-order');
  const billing = freshBilling();
  const trialCalls = [];
  billing._mailer = {
    sendTrialWelcomeEmail: async (args) => {
      trialCalls.push(args);
      return { sent: true, id: 'must_not_send' };
    },
  };

  const event = makeCheckoutCompletedEvent({
    email: 'service-buyer@example.com',
    customerId: 'cus_service_order',
    sessionId: 'cs_service_order',
    mode: 'payment',
    amountTotal: 100,
    paymentLinkId: 'plink_firstfailurerule',
    metadata: {
      thumbgate_tier: 'first_failure_rule',
      thumbgate_lookup_key: 'thumbgate_first_failure_rule',
    },
  });
  const result = await billing.handleWebhook(Buffer.from(JSON.stringify(event)), null);

  assert.equal(result.handled, true);
  assert.equal(result.action, 'paid_service_order_recorded');
  assert.equal(result.result, null);
  assert.equal(trialCalls.length, 0);
  assert.equal(fs.existsSync(process.env._TEST_API_KEYS_PATH), false);
  const revenueRows = fs.readFileSync(process.env._TEST_REVENUE_LEDGER_PATH, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(revenueRows.length, 1);
  assert.equal(revenueRows[0].orderId, 'cs_service_order');
  assert.equal(revenueRows[0].metadata.offerKind, 'service_order');

  billing._mailer = null;
});

test('concurrent paid-service deliveries record one revenue row', async () => {
  primeEnv('service-order-concurrent');
  const billingA = freshBilling();
  const billingB = freshBilling();
  const event = makeCheckoutCompletedEvent({
    email: 'service-concurrent@example.com',
    customerId: 'cus_service_concurrent',
    sessionId: 'cs_service_concurrent',
    mode: 'payment',
    amountTotal: 100,
    paymentLinkId: 'plink_firstfailurerule',
    metadata: { thumbgate_tier: 'first_failure_rule' },
  });

  const payload = Buffer.from(JSON.stringify(event));
  const results = await Promise.all([
    billingA.handleWebhook(payload, null),
    billingB.handleWebhook(payload, null),
  ]);
  assert.ok(results.every((result) => result.handled === true));
  const rows = fs.readFileSync(process.env._TEST_REVENUE_LEDGER_PATH, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(rows.filter((row) => row.orderId === 'cs_service_concurrent').length, 1);
});

test('an async payment success fulfills the diagnostic after payment confirmation', async () => {
  primeEnv('async-success');
  const billing = freshBilling();
  const calls = [];
  billing._mailer = {
    sendEmail: async (args) => {
      calls.push(args);
      return { sent: true, id: `async_${calls.length}` };
    },
  };

  const event = makeCheckoutCompletedEvent({
    email: 'async@example.com',
    customerId: 'cus_async',
    sessionId: 'cs_async',
    mode: 'payment',
    metadata: { planId: 'sprint_diagnostic' },
    amountTotal: 49900,
    eventType: 'checkout.session.async_payment_succeeded',
  });
  const result = await billing.handleWebhook(Buffer.from(JSON.stringify(event)), null);

  assert.equal(result.action, 'diagnostic_order_recorded');
  assert.equal(calls.length, 2);
  billing._mailer = null;
});

test('concurrent Stripe deliveries share one idempotent fulfillment operation', async () => {
  primeEnv('concurrent');
  const billingA = freshBilling();
  const billingB = freshBilling();
  const calls = [];
  const mailerStub = {
    sendEmail: async (args) => {
      calls.push(args);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { sent: true, id: `concurrent_${calls.length}` };
    },
  };
  billingA._mailer = mailerStub;
  billingB._mailer = mailerStub;
  const event = makeCheckoutCompletedEvent({
    email: 'concurrent@example.com',
    customerId: 'cus_concurrent',
    sessionId: 'cs_concurrent',
    mode: 'payment',
    metadata: { planId: 'sprint_diagnostic' },
    amountTotal: 49900,
  });

  const payload = Buffer.from(JSON.stringify(event));
  const results = await Promise.all([
    billingA.handleWebhook(payload, null),
    billingB.handleWebhook(payload, null),
  ]);

  assert.ok(results.some((result) => result.action === 'diagnostic_order_recorded'));
  assert.ok(results.some((result) => (
    result.action === 'diagnostic_order_already_processed'
    || result.reason === 'diagnostic_fulfillment_in_progress'
  )));
  assert.equal(calls.length, 2, 'one buyer email and one operator email across concurrent deliveries');
  assert.equal(new Set(calls.map((call) => call.idempotencyKey)).size, 2);
  billingA._mailer = null;
  billingB._mailer = null;
});

test('diagnostic fulfillment failure stays retryable after payment is booked', async () => {
  primeEnv('diagnostic-retry');
  const billing = freshBilling();
  billing._mailer = {
    sendEmail: async ({ to }) => (
      to === 'diagnostic-retry@example.com'
        ? { sent: false, reason: 'provider_error' }
        : { sent: true, id: 'operator_sent' }
    ),
  };
  const event = makeCheckoutCompletedEvent({
    email: 'diagnostic-retry@example.com',
    customerId: 'cus_diagnostic_retry',
    sessionId: 'cs_diagnostic_retry',
    mode: 'payment',
    metadata: { planId: 'sprint_diagnostic' },
    amountTotal: 49900,
  });

  const result = await billing.handleWebhook(Buffer.from(JSON.stringify(event)), null);
  assert.equal(result.handled, false);
  assert.equal(result.retryable, true);
  assert.equal(result.paymentRecorded, true);
  assert.equal(result.reason, 'diagnostic_fulfillment_retry_required');
  const revenueRows = fs.readFileSync(process.env._TEST_REVENUE_LEDGER_PATH, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(revenueRows.filter((row) => row.orderId === 'cs_diagnostic_retry').length, 1);
  assert.equal(fs.existsSync(process.env._TEST_API_KEYS_PATH), false);
  billing._mailer = null;
});

test('permanent diagnostic email rejection records payment and stops webhook retries', async () => {
  primeEnv('diagnostic-permanent-email-failure');
  const billing = freshBilling();
  billing._mailer = {
    sendEmail: async ({ to }) => (
      to === 'invalid@example.com'
        ? {
          sent: false,
          reason: 'api_error',
          status: 422,
          body: { name: 'invalid_to_address', message: 'Recipient address is invalid' },
        }
        : { sent: true, id: 'operator_sent' }
    ),
  };
  const event = makeCheckoutCompletedEvent({
    email: 'invalid@example.com',
    customerId: 'cus_diagnostic_permanent',
    sessionId: 'cs_diagnostic_permanent',
    mode: 'payment',
    metadata: {},
    amountTotal: 49900,
  });

  const result = await billing.handleWebhook(Buffer.from(JSON.stringify(event)), null);
  assert.equal(result.handled, true);
  assert.equal(result.fulfillment, 'attention_required');
  assert.equal(result.diagnosticEmails.buyer.status, 422);
  const revenueRows = fs.readFileSync(process.env._TEST_REVENUE_LEDGER_PATH, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(revenueRows.filter((row) => row.orderId === 'cs_diagnostic_permanent').length, 1);
  billing._mailer = null;
});

test('shared Resend sender rejection keeps diagnostic fulfillment retryable', async () => {
  primeEnv('diagnostic-invalid-sender');
  const billing = freshBilling();
  billing._mailer = {
    sendEmail: async () => ({
      sent: false,
      reason: 'api_error',
      status: 422,
      body: { name: 'invalid_from_address', message: 'Sender address is invalid' },
    }),
  };
  const event = makeCheckoutCompletedEvent({
    email: 'buyer@example.com',
    customerId: 'cus_diagnostic_invalid_sender',
    sessionId: 'cs_diagnostic_invalid_sender',
    mode: 'payment',
    metadata: {},
    amountTotal: 49900,
  });

  const result = await billing.handleWebhook(Buffer.from(JSON.stringify(event)), null);
  assert.equal(result.handled, false);
  assert.equal(result.retryable, true);
  assert.equal(result.paymentRecorded, true);
  assert.equal(result.reason, 'diagnostic_fulfillment_retry_required');
  billing._mailer = null;
});

test('missing operator recipient keeps paid diagnostic fulfillment retryable', async () => {
  primeEnv('diagnostic-missing-operator');
  process.env.THUMBGATE_OPERATOR_ALERT_EMAIL = 'not-an-email';
  const billing = freshBilling();
  billing._mailer = {
    sendEmail: async () => ({ sent: true, id: 'buyer_sent' }),
  };
  const event = makeCheckoutCompletedEvent({
    email: 'buyer@example.com',
    customerId: 'cus_diagnostic_missing_operator',
    sessionId: 'cs_diagnostic_missing_operator',
    mode: 'payment',
    metadata: {},
    amountTotal: 49900,
  });

  const result = await billing.handleWebhook(Buffer.from(JSON.stringify(event)), null);
  assert.equal(result.handled, false);
  assert.equal(result.retryable, true);
  assert.equal(result.reason, 'diagnostic_fulfillment_retry_required');
  assert.equal(result.delivery.operator, 'missing_recipient');
  billing._mailer = null;
});

test('credit-pack webhook replay adds credits exactly once', async () => {
  primeEnv('credit-pack-replay');
  const billing = freshBilling();
  billing.CONFIG.CREDIT_PACKS.pack_100 = {
    id: 'pack_100',
    name: '100 credits',
    credits: 100,
    amountCents: 5000,
    currency: 'USD',
  };
  billing._mailer = {
    sendTrialWelcomeEmail: async () => ({ sent: true, id: 'credit_pack_email' }),
  };
  const event = makeCheckoutCompletedEvent({
    email: 'credits@example.com',
    customerId: 'cus_credit_pack',
    sessionId: 'cs_credit_pack',
    mode: 'payment',
    amountTotal: 5000,
    paymentLinkId: null,
    metadata: { packId: 'pack_100', credits: '100' },
  });

  const first = await billing.handleWebhook(Buffer.from(JSON.stringify(event)), null);
  const replay = await billing.handleWebhook(Buffer.from(JSON.stringify(event)), null);
  assert.equal(first.result.remainingCredits, 100);
  assert.equal(replay.result.remainingCredits, 100);
  assert.equal(billing.loadKeyStore().keys[first.result.key].remainingCredits, 100);

  delete billing.CONFIG.CREDIT_PACKS.pack_100;
  billing._mailer = null;
});

test('out-of-order subscription cancellation blocks delayed checkout fulfillment', async () => {
  primeEnv('subscription-cancel-before-checkout');
  const billing = freshBilling();
  billing._mailer = {
    sendTrialWelcomeEmail: async () => ({ sent: true, id: 'must_not_send' }),
  };
  const cancellation = {
    id: 'evt_cancel_before_checkout',
    created: 200,
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: 'sub_cancel_before_checkout',
        customer: 'cus_cancel_before_checkout',
        canceled_at: 200,
      },
    },
  };
  const checkout = makeCheckoutCompletedEvent({
    email: 'cancelled@example.com',
    customerId: 'cus_cancel_before_checkout',
    sessionId: 'cs_delayed_after_cancel',
  });
  checkout.data.object.subscription = 'sub_cancel_before_checkout';
  checkout.data.object.created = 100;

  const canceled = await billing.handleWebhook(Buffer.from(JSON.stringify(cancellation)), null);
  const delayed = await billing.handleWebhook(Buffer.from(JSON.stringify(checkout)), null);
  assert.equal(canceled.action, 'disabled_customer_keys');
  assert.equal(delayed.action, 'checkout_entitlement_inactive');
  assert.equal(delayed.result.key, null);
  assert.equal(delayed.result.entitlementActive, false);
  assert.equal(Object.values(billing.loadKeyStore().keys).filter((metadata) => metadata.active).length, 0);
  billing._mailer = null;
});

test('Resend authentication failure remains retryable after payment is recorded', async () => {
  primeEnv('diagnostic-resend-auth');
  const billing = freshBilling();
  billing._mailer = {
    sendEmail: async () => ({ sent: false, reason: 'api_error', status: 401 }),
  };
  const event = makeCheckoutCompletedEvent({
    email: 'auth-retry@example.com',
    customerId: 'cus_diagnostic_auth_retry',
    sessionId: 'cs_diagnostic_auth_retry',
    mode: 'payment',
    metadata: {},
    amountTotal: 49900,
  });

  const result = await billing.handleWebhook(Buffer.from(JSON.stringify(event)), null);
  assert.equal(result.handled, false);
  assert.equal(result.retryable, true);
  assert.equal(result.paymentRecorded, true);
  const revenueRows = fs.readFileSync(process.env._TEST_REVENUE_LEDGER_PATH, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(revenueRows.filter((row) => row.orderId === 'cs_diagnostic_auth_retry').length, 1);
  billing._mailer = null;
});

test('guest diagnostic checkout records revenue without provisioning a Pro key', async () => {
  primeEnv('diagnostic-guest');
  const billing = freshBilling();
  billing._mailer = {
    sendEmail: async () => ({ sent: true, id: 'guest_email_sent' }),
  };
  const event = makeCheckoutCompletedEvent({
    email: 'guest@example.com',
    customerId: null,
    sessionId: 'cs_diagnostic_guest',
    mode: 'payment',
    metadata: {},
    amountTotal: 49900,
  });

  const result = await billing.handleWebhook(Buffer.from(JSON.stringify(event)), null);
  assert.equal(result.handled, true);
  const revenueRows = fs.readFileSync(process.env._TEST_REVENUE_LEDGER_PATH, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const paid = revenueRows.find((row) => row.orderId === 'cs_diagnostic_guest');
  assert.match(paid.customerId, /^guest_[a-f0-9]{24}$/);
  assert.equal(fs.existsSync(process.env._TEST_API_KEYS_PATH), false);
  billing._mailer = null;
});

test('diagnostic classification rejects amount-only and substring lookalikes', () => {
  primeEnv('classification');
  const billing = freshBilling();
  assert.equal(billing._isDiagnosticCheckoutSession({
    mode: 'payment',
    amount_total: 49900,
    currency: 'eur',
    metadata: {},
  }), false);
  assert.equal(billing._isDiagnosticCheckoutSession({
    mode: 'payment',
    metadata: { planId: 'not_sprint_diagnostic_product' },
  }), false);
  assert.equal(billing._isDiagnosticCheckoutSession({
    mode: 'payment',
    metadata: { thumbgate_tier: 'sprint_diagnostic' },
  }), false);
  assert.equal(billing._isDiagnosticCheckoutSession({
    mode: 'payment',
    amount_total: 49900,
    currency: 'usd',
    metadata: {},
  }), false);
  assert.equal(billing._isDiagnosticCheckoutSession({
    mode: 'payment',
    amount_subtotal: 49900,
    amount_total: 53900,
    currency: 'usd',
    metadata: { thumbgate_tier: 'pro' },
    payment_link: TEST_DIAGNOSTIC_PAYMENT_LINK_ID,
  }), true);
  assert.equal(billing._isDiagnosticCheckoutSession({
    mode: 'payment',
    amount_total: 75000,
    currency: 'usd',
    metadata: {},
    payment_link: { id: TEST_DIAGNOSTIC_PAYMENT_LINK_ID },
  }), true);
  assert.equal(billing._isDiagnosticCheckoutSession({
    mode: 'subscription',
    amount_subtotal: 1900,
    amount_total: 1900,
    currency: 'usd',
    metadata: { thumbgate_tier: 'sprint_diagnostic', ctaId: 'diagnostic' },
  }), false);
  assert.equal(billing._isDiagnosticCheckoutSession({
    mode: 'payment',
    amount_total: 1900,
    currency: 'usd',
    metadata: {},
    client_reference_id: require('../scripts/checkout-attribution-reference').packCheckoutReference({
      source: 'attacker',
      planId: 'sprint_diagnostic',
    }),
  }), false);
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
        payment_status: 'paid',
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

test('handleWebhook emits Plausible purchase event on checkout completion', async () => {
  primeEnv('plausible');
  process.env.THUMBGATE_PLAUSIBLE_DISABLE = '0';
  process.env.THUMBGATE_PLAUSIBLE_DOMAIN = 'thumbgate.test';

  const originalRequest = https.request;
  const requests = [];
  https.request = (options, callback) => {
    const req = new EventEmitter();
    let body = '';
    req.write = (chunk) => { body += chunk; };
    req.end = (chunk) => {
      if (chunk) body += chunk;
      requests.push({ options, body });
      const res = new EventEmitter();
      res.statusCode = 202;
      callback(res);
      res.emit('end');
    };
    req.destroy = () => {};
    req.setTimeout = () => {};
    req.on = EventEmitter.prototype.on.bind(req);
    return req;
  };

  try {
    const billing = freshBilling();
    billing._mailer = {
      sendTrialWelcomeEmail: async () => ({ sent: true, id: 'email_fake_plausible' }),
    };

    const event = makeCheckoutCompletedEvent({
      email: 'buyer3@example.com',
      customerId: 'cus_test_plausible',
      sessionId: 'cs_test_plausible',
    });

    const res = await billing.handleWebhook(Buffer.from(JSON.stringify(event)), null);

    assert.equal(res.handled, true);
    assert.equal(requests.length, 1);
    const payload = JSON.parse(requests[0].body);
    assert.equal(payload.name, 'Checkout Pro Purchase Completed');
    assert.equal(payload.domain, 'thumbgate.test');
    assert.equal(payload.url, 'https://thumbgate.test/success');
    assert.equal(payload.props.sessionId, 'cs_test_plausible');
    assert.equal(payload.props.customerId, 'cus_test_plausible');
    assert.equal(payload.props.amount, '1900');
    assert.equal(payload.props.currency, 'usd');

    billing._mailer = null;
  } finally {
    https.request = originalRequest;
    delete process.env.THUMBGATE_PLAUSIBLE_DOMAIN;
  }
});
