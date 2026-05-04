'use strict';

/**
 * tests/billing.test.js
 */

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { EventEmitter } = require('events');

const { startServer } = require('../src/api/server');

let tmpDir;
const billingTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-suite-'));
const testApiKeysPath = path.join(billingTestRoot, 'api-keys.json');
const testFunnelLedgerPath = path.join(billingTestRoot, 'funnel-events.jsonl');
const testRevenueLedgerPath = path.join(billingTestRoot, 'revenue-events.jsonl');
const testLocalCheckoutSessionsPath = path.join(billingTestRoot, 'local-checkout-sessions.json');
const testTrialEmailLedgerPath = path.join(billingTestRoot, 'trial-emails.jsonl');
const testFeedbackDir = path.join(billingTestRoot, 'feedback');

const savedApiKeysPath = process.env._TEST_API_KEYS_PATH;
const savedFunnelPath = process.env._TEST_FUNNEL_LEDGER_PATH;
const savedRevenuePath = process.env._TEST_REVENUE_LEDGER_PATH;
const savedLocalCheckoutSessionsPath = process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH;
const savedTrialEmailLedgerPath = process.env._TEST_TRIAL_EMAIL_LEDGER_PATH;
const savedGithubPlanPricing = process.env.THUMBGATE_GITHUB_MARKETPLACE_PLAN_PRICES_JSON;
const savedStripeSecretKey = process.env.STRIPE_SECRET_KEY;
const savedStripePriceId = process.env.STRIPE_PRICE_ID;
const savedResendApiKey = process.env.RESEND_API_KEY;
const savedThumbGateResendApiKey = process.env.THUMBGATE_RESEND_API_KEY;
const savedFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
const savedTestStripeReconciledRevenueEvents = process.env._TEST_STRIPE_RECONCILED_REVENUE_EVENTS_JSON;
const savedTestLegacyFeedbackDir = process.env._TEST_LEGACY_FEEDBACK_DIR;
const savedTestRlhfFeedbackDir = process.env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR;
const savedLegacyFeedbackDir = process.env.THUMBGATE_LEGACY_FEEDBACK_DIR;
const savedFallbackFeedbackDir = process.env.THUMBGATE_FALLBACK_FEEDBACK_DIR;

// Initial setup
process.env._TEST_API_KEYS_PATH = testApiKeysPath;
process.env._TEST_FUNNEL_LEDGER_PATH = testFunnelLedgerPath;
process.env._TEST_REVENUE_LEDGER_PATH = testRevenueLedgerPath;
process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = testLocalCheckoutSessionsPath;
process.env._TEST_TRIAL_EMAIL_LEDGER_PATH = testTrialEmailLedgerPath;
process.env.THUMBGATE_FEEDBACK_DIR = testFeedbackDir;
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_PRICE_ID = '';
delete process.env.RESEND_API_KEY;
delete process.env.THUMBGATE_RESEND_API_KEY;
delete process.env._TEST_LEGACY_FEEDBACK_DIR;
delete process.env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR;
delete process.env.THUMBGATE_LEGACY_FEEDBACK_DIR;
delete process.env.THUMBGATE_FALLBACK_FEEDBACK_DIR;

after(() => {
  process.env.STRIPE_SECRET_KEY = savedStripeSecretKey || '';
  process.env.STRIPE_PRICE_ID = savedStripePriceId || '';
  if (savedApiKeysPath === undefined) delete process.env._TEST_API_KEYS_PATH;
  else process.env._TEST_API_KEYS_PATH = savedApiKeysPath;
  if (savedFunnelPath === undefined) delete process.env._TEST_FUNNEL_LEDGER_PATH;
  else process.env._TEST_FUNNEL_LEDGER_PATH = savedFunnelPath;
  if (savedRevenuePath === undefined) delete process.env._TEST_REVENUE_LEDGER_PATH;
  else process.env._TEST_REVENUE_LEDGER_PATH = savedRevenuePath;
  if (savedLocalCheckoutSessionsPath === undefined) delete process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH;
  else process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = savedLocalCheckoutSessionsPath;
  if (savedTrialEmailLedgerPath === undefined) delete process.env._TEST_TRIAL_EMAIL_LEDGER_PATH;
  else process.env._TEST_TRIAL_EMAIL_LEDGER_PATH = savedTrialEmailLedgerPath;
  if (savedGithubPlanPricing === undefined) delete process.env.THUMBGATE_GITHUB_MARKETPLACE_PLAN_PRICES_JSON;
  else process.env.THUMBGATE_GITHUB_MARKETPLACE_PLAN_PRICES_JSON = savedGithubPlanPricing;
  if (savedFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
  else process.env.THUMBGATE_FEEDBACK_DIR = savedFeedbackDir;
  if (savedResendApiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = savedResendApiKey;
  if (savedThumbGateResendApiKey === undefined) delete process.env.THUMBGATE_RESEND_API_KEY;
  else process.env.THUMBGATE_RESEND_API_KEY = savedThumbGateResendApiKey;
  if (savedTestStripeReconciledRevenueEvents === undefined) delete process.env._TEST_STRIPE_RECONCILED_REVENUE_EVENTS_JSON;
  else process.env._TEST_STRIPE_RECONCILED_REVENUE_EVENTS_JSON = savedTestStripeReconciledRevenueEvents;
  if (savedTestLegacyFeedbackDir === undefined) delete process.env._TEST_LEGACY_FEEDBACK_DIR;
  else process.env._TEST_LEGACY_FEEDBACK_DIR = savedTestLegacyFeedbackDir;
  if (savedTestRlhfFeedbackDir === undefined) delete process.env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR;
  else process.env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR = savedTestRlhfFeedbackDir;
  if (savedLegacyFeedbackDir === undefined) delete process.env.THUMBGATE_LEGACY_FEEDBACK_DIR;
  else process.env.THUMBGATE_LEGACY_FEEDBACK_DIR = savedLegacyFeedbackDir;
  if (savedFallbackFeedbackDir === undefined) delete process.env.THUMBGATE_FALLBACK_FEEDBACK_DIR;
  else process.env.THUMBGATE_FALLBACK_FEEDBACK_DIR = savedFallbackFeedbackDir;
  fs.rmSync(billingTestRoot, { recursive: true, force: true });
});

function setupTempStore() {
  if (fs.existsSync(testApiKeysPath)) fs.rmSync(testApiKeysPath, { force: true });
  return testApiKeysPath;
}

function cleanupTempStore() {
  if (fs.existsSync(testApiKeysPath)) fs.rmSync(testApiKeysPath, { force: true });
}

function requireFreshBilling(stripeKey = '') {
  delete require.cache[require.resolve('../scripts/billing')];
  process.env.STRIPE_SECRET_KEY = stripeKey;
  return require('../scripts/billing');
}

function clearBillingArtifacts() {
  for (const target of [testApiKeysPath, testFunnelLedgerPath, testRevenueLedgerPath, testLocalCheckoutSessionsPath, testTrialEmailLedgerPath]) {
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  }
  fs.rmSync(testFeedbackDir, { recursive: true, force: true });
  delete process.env._TEST_STRIPE_RECONCILED_REVENUE_EVENTS_JSON;
  delete process.env.RESEND_API_KEY;
  delete process.env.THUMBGATE_RESEND_API_KEY;
}

function readLedgerEvents() {
  if (!fs.existsSync(testFunnelLedgerPath)) return [];
  return fs.readFileSync(testFunnelLedgerPath, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l));
}

function readRevenueEvents() {
  if (!fs.existsSync(testRevenueLedgerPath)) return [];
  return fs.readFileSync(testRevenueLedgerPath, 'utf-8').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}

function readTrialEmailRows() {
  if (!fs.existsSync(testTrialEmailLedgerPath)) return [];
  return fs.readFileSync(testTrialEmailLedgerPath, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function installStripeMock(factory) {
  const stripeModuleId = require.resolve('stripe');
  const previous = require.cache[stripeModuleId];
  delete require.cache[require.resolve('../scripts/billing')];
  require.cache[stripeModuleId] = {
    id: stripeModuleId,
    filename: stripeModuleId,
    loaded: true,
    exports: factory,
  };
  return () => {
    delete require.cache[require.resolve('../scripts/billing')];
    if (previous) {
      require.cache[stripeModuleId] = previous;
    } else {
      delete require.cache[stripeModuleId];
    }
  };
}

function installHttpsRequestMock(handler) {
  const previous = https.request;
  https.request = (options, callback) => {
    const request = new EventEmitter();
    request.end = (body) => {
      handler({ options, body, callback, request });
    };
    request.destroy = (err) => {
      process.nextTick(() => request.emit('error', err));
    };
    request.setTimeout = () => request;
    return request;
  };
  return () => {
    https.request = previous;
  };
}

function emitHttpsResponse(callback, statusCode, payload) {
  const response = new EventEmitter();
  response.statusCode = statusCode;
  response.setEncoding = () => {};
  process.nextTick(() => {
    callback(response);
    response.emit('data', typeof payload === 'string' ? payload : JSON.stringify(payload));
    response.emit('end');
  });
}

function writeNewsletterSubscribers(entries) {
  const newsletterPath = path.join(testFeedbackDir, 'newsletter-subscribers.jsonl');
  fs.mkdirSync(path.dirname(newsletterPath), { recursive: true });
  fs.writeFileSync(
    newsletterPath,
    `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    'utf8'
  );
  return newsletterPath;
}

describe('billing.js — provisionApiKey', () => {
  let keyStorePath;
  beforeEach(() => { keyStorePath = setupTempStore(); });
  afterEach(() => { cleanupTempStore(); });

  test('generates a unique key with tg_ prefix', () => {
    const billing = requireFreshBilling('');
    assert.equal(billing._API_KEYS_PATH(), keyStorePath);
    const result = billing.provisionApiKey('cus_test_001');
    assert.ok(result.key.startsWith('tg_'));
    assert.equal(result.customerId, 'cus_test_001');
    assert.ok(JSON.parse(fs.readFileSync(keyStorePath, 'utf-8')).keys[result.key]);
  });

  test('reuses existing active key for same customerId', () => {
    const billing = requireFreshBilling('');
    const r1 = billing.provisionApiKey('cus_reuse_001');
    const r2 = billing.provisionApiKey('cus_reuse_001');
    assert.equal(r1.key, r2.key);
  });
});

describe('billing.js — funnel ledger', () => {
  beforeEach(() => { 
    clearBillingArtifacts(); 
    delete require.cache[require.resolve('../scripts/billing')];
    process.env._TEST_FUNNEL_LEDGER_PATH = testFunnelLedgerPath;
    process.env._TEST_REVENUE_LEDGER_PATH = testRevenueLedgerPath;
    delete process.env.THUMBGATE_GITHUB_MARKETPLACE_PLAN_PRICES_JSON;
  });

  test('createCheckoutSession emits acquisition event', async () => {
    const billing = require('../scripts/billing');
    const result = await billing.createCheckoutSession({
      installId: 'inst_123',
      metadata: {
        source: 'website',
        utmSource: 'website',
        utmMedium: 'cta_button',
        utmCampaign: 'test',
      },
    });
    assert.ok(result.sessionId.startsWith('test_session_'));
    assert.match(result.traceId, /^checkout_/);
    const events = readLedgerEvents();
    const acq = events.find(e => e.stage === 'acquisition');
    assert.ok(acq);
    assert.equal(acq.installId, 'inst_123');
    assert.equal(acq.traceId, result.traceId);
    assert.equal(acq.metadata.utmSource, 'website');
    assert.equal(acq.metadata.utmCampaign, 'test');
  });

  test('checkout session payload omits null customer email', () => {
    const billing = require('../scripts/billing');
    const withoutEmail = billing._buildCheckoutSessionPayload({
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      customerEmail: null,
      checkoutMetadata: {
        traceId: 'trace_checkout_payload',
      },
    });
    assert.equal(Object.prototype.hasOwnProperty.call(withoutEmail, 'customer_email'), false);

    const withEmail = billing._buildCheckoutSessionPayload({
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      customerEmail: 'buyer@example.com',
      checkoutMetadata: {
        traceId: 'trace_checkout_payload_email',
      },
    });
    assert.equal(withEmail.customer_email, 'buyer@example.com');
    assert.equal(withoutEmail.mode, 'subscription');
    assert.equal(withoutEmail.payment_method_collection, 'if_required');
    assert.equal(withoutEmail.metadata.priceId, billing.CONFIG.STRIPE_PRICE_ID_PRO_MONTHLY);
    assert.equal(withoutEmail.line_items[0].price_data.unit_amount, 1900);
    assert.equal(withoutEmail.line_items[0].price_data.recurring.interval, 'month');
    assert.match(withoutEmail.line_items[0].price_data.product_data.images[0], /\/assets\/brand\/thumbgate-icon-pro-512\.png$/);
    assert.match(withoutEmail.branding_settings.logo.url, /\/assets\/brand\/thumbgate-logo-1200x360\.png$/);
    assert.equal(Object.prototype.hasOwnProperty.call(withoutEmail.branding_settings, 'icon'), false);
    assert.equal(withoutEmail.line_items[0].quantity, 1);
  });

  test('checkout session payload selects annual Pro and Team pricing explicitly', () => {
    const billing = require('../scripts/billing');

    const annual = billing._buildCheckoutSessionPayload({
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      checkoutMetadata: {
        traceId: 'trace_checkout_payload_annual',
        planId: 'pro',
        billingCycle: 'annual',
      },
    });
    assert.equal(annual.metadata.priceId, billing.CONFIG.STRIPE_PRICE_ID_PRO_ANNUAL);
    assert.equal(annual.line_items[0].price_data.unit_amount, 14900);
    assert.equal(annual.line_items[0].price_data.recurring.interval, 'year');
    assert.equal(annual.line_items[0].quantity, 1);
    assert.equal(annual.payment_method_collection, 'if_required');
    assert.equal(annual.metadata.billingCycle, 'annual');

    const team = billing._buildCheckoutSessionPayload({
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      checkoutMetadata: {
        traceId: 'trace_checkout_payload_team',
        planId: 'team',
        billingCycle: 'monthly',
        seatCount: 2,
      },
    });
    assert.equal(team.metadata.priceId, billing.CONFIG.STRIPE_PRICE_ID_TEAM_MONTHLY);
    assert.equal(team.line_items[0].price_data.unit_amount, 4900);
    assert.equal(team.line_items[0].price_data.recurring.interval, 'month');
    assert.equal(team.line_items[0].quantity, 3);
    assert.equal(team.payment_method_collection, 'if_required');
    assert.equal(team.metadata.planId, 'team');
    assert.equal(team.metadata.seatCount, '3');

    // Regression guard: each tier must ship its own product image so the
    // Stripe product catalog, checkout, and dashboard never render twins.
    const proIcon = annual.line_items[0].price_data.product_data.images[0];
    const teamIcon = team.line_items[0].price_data.product_data.images[0];
    assert.match(proIcon, /\/assets\/brand\/thumbgate-icon-pro-512\.png$/);
    assert.match(teamIcon, /\/assets\/brand\/thumbgate-icon-team-512\.png$/);
    assert.notEqual(proIcon, teamIcon);
  });

  test('checkout session status preserves trace id for cross-service lookup', async () => {
    const billing = require('../scripts/billing');
    const checkout = await billing.createCheckoutSession({
      installId: 'inst_trace_lookup',
      customerEmail: 'buyer@example.com',
    });
    const session = await billing.getCheckoutSessionStatus(checkout.sessionId);
    assert.equal(session.found, true);
    assert.equal(session.traceId, checkout.traceId);
    assert.equal(session.customerEmail, 'buyer@example.com');
    assert.equal(session.trialEmail.status, 'skipped');
    assert.equal(session.trialEmail.reason, 'missing_resend_api_key');
  });

  test('trial activation email includes the license command and records provider delivery', async () => {
    process.env.THUMBGATE_RESEND_API_KEY = 're_test_provider_key';
    const billing = requireFreshBilling('');
    const delivered = [];
    const result = await billing._sendTrialActivationEmail({
      sessionId: 'cs_test_email_001',
      customerEmail: 'Buyer@Example.com',
      apiKey: 'tg_test_activation_key',
      planId: 'pro',
      appOrigin: 'https://thumbgate-production.up.railway.app',
      source: 'unit_test',
    }, {
      transport: async (message) => {
        delivered.push(message);
        return { ok: true, body: { id: 'email_test_001' } };
      },
    });

    assert.equal(result.status, 'sent');
    assert.equal(result.customerEmail, 'buyer@example.com');
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].subject, 'Your 7-day ThumbGate Pro trial is live');
    assert.match(delivered[0].text, /npx thumbgate pro --activate --key=tg_test_activation_key/);
    assert.match(delivered[0].text, /Pre-Action Checks/);
    assert.match(delivered[0].text, /Give one concrete thumbs up or thumbs down/);
    assert.match(delivered[0].html, /Reliability Gateway blocks/);
    assert.match(delivered[0].html, /verification evidence/);
    assert.deepEqual(delivered[0].to, ['buyer@example.com']);

    const rows = fs.readFileSync(testTrialEmailLedgerPath, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(rows[0].status, 'sent');
    assert.equal(rows[0].providerId, 'email_test_001');
    assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'apiKey'), false);
  });

  test('trial activation email skips incomplete delivery inputs without ledger churn', async () => {
    const billing = requireFreshBilling('');

    const missingEmail = await billing._sendTrialActivationEmail({
      sessionId: 'cs_missing_email',
      customerEmail: '',
      apiKey: 'tg_test_activation_key',
    });
    const missingKey = await billing._sendTrialActivationEmail({
      sessionId: 'cs_missing_key',
      customerEmail: 'buyer@example.com',
      apiKey: '',
    });

    assert.deepEqual(missingEmail, { status: 'skipped', reason: 'missing_customer_email' });
    assert.deepEqual(missingKey, {
      status: 'skipped',
      reason: 'missing_api_key',
      customerEmail: 'buyer@example.com',
    });
    assert.deepEqual(readTrialEmailRows(), []);
  });

  test('trial activation email dedupes sent messages and records provider errors safely', async () => {
    process.env.THUMBGATE_RESEND_API_KEY = 're_test_provider_key';
    const billing = requireFreshBilling('');
    const delivered = [];

    const first = await billing._sendTrialActivationEmail({
      sessionId: 'cs_test_email_dedupe',
      customerEmail: 'buyer@example.com',
      apiKey: 'tg_test_activation_key',
      planId: 'pro',
      source: 'unit_test',
    }, {
      transport: async (message) => {
        delivered.push(message);
        return { ok: true, body: { id: 'email_dedupe_001' } };
      },
    });
    const second = await billing._sendTrialActivationEmail({
      sessionId: 'cs_test_email_dedupe',
      customerEmail: 'buyer@example.com',
      apiKey: 'tg_test_activation_key',
      planId: 'pro',
      source: 'unit_test',
    }, {
      transport: async () => {
        throw new Error('duplicate send attempted');
      },
    });
    const failed = await billing._sendTrialActivationEmail({
      sessionId: 'cs_test_email_failed',
      customerEmail: 'fail@example.com',
      apiKey: 'tg_failed_activation_key',
      planId: 'pro',
      source: 'unit_test',
    }, {
      transport: async () => {
        throw new Error('provider rejected message');
      },
    });

    assert.equal(first.status, 'sent');
    assert.equal(second.status, 'already_sent');
    assert.equal(second.providerId, 'email_dedupe_001');
    assert.equal(failed.status, 'failed');
    assert.equal(failed.reason, 'provider_error');
    assert.equal(delivered.length, 1);

    const rows = readTrialEmailRows();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, 'sent');
    assert.equal(rows[1].status, 'failed');
    assert.equal(rows[1].error, 'provider rejected message');
    assert.equal(Object.prototype.hasOwnProperty.call(rows[1], 'apiKey'), false);
  });

  test('trial activation email records missing provider once per checkout session', async () => {
    const billing = requireFreshBilling('');

    const first = await billing._sendTrialActivationEmail({
      sessionId: 'cs_test_email_no_provider',
      customerEmail: 'buyer@example.com',
      apiKey: 'tg_test_activation_key',
      planId: 'pro',
    });
    const second = await billing._sendTrialActivationEmail({
      sessionId: 'cs_test_email_no_provider',
      customerEmail: 'buyer@example.com',
      apiKey: 'tg_test_activation_key',
      planId: 'pro',
    });

    assert.equal(first.status, 'skipped');
    assert.equal(first.reason, 'missing_resend_api_key');
    assert.equal(second.status, 'skipped');
    assert.equal(second.reason, 'missing_resend_api_key');

    const rows = readTrialEmailRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'skipped');
    assert.equal(rows[0].reason, 'missing_resend_api_key');
  });

  test('trial activation email uses Resend transport and reports API errors', async () => {
    process.env.THUMBGATE_RESEND_API_KEY = 're_test_provider_key';
    const acceptedBodies = [];
    let restoreHttps = installHttpsRequestMock(({ body, callback }) => {
      acceptedBodies.push(JSON.parse(body));
      emitHttpsResponse(callback, 202, { id: 'resend_email_001' });
    });
    let billing = requireFreshBilling('');
    billing._mailer = null;
    try {
      const sent = await billing._sendTrialActivationEmail({
        sessionId: 'cs_test_resend_success',
        customerEmail: 'buyer@example.com',
        apiKey: 'tg_resend_success',
        planId: 'pro',
      });

      assert.equal(sent.status, 'sent');
      assert.equal(sent.providerId, 'resend_email_001');
      assert.equal(acceptedBodies.length, 1);
      assert.deepEqual(acceptedBodies[0].to, ['buyer@example.com']);
      assert.equal(acceptedBodies[0].subject, 'Your 7-day ThumbGate Pro trial is live');
      assert.match(acceptedBodies[0].text, /npx thumbgate pro --activate --key=tg_resend_success/);
      assert.match(acceptedBodies[0].html, /Pre-Action Checks/);
    } finally {
      restoreHttps();
    }

    restoreHttps = installHttpsRequestMock(({ callback }) => {
      emitHttpsResponse(callback, 403, { message: 'domain is not verified' });
    });
    billing = requireFreshBilling('');
    billing._mailer = null;
    try {
      const failed = await billing._sendTrialActivationEmail({
        sessionId: 'cs_test_resend_failure',
        customerEmail: 'fail@example.com',
        apiKey: 'tg_resend_failure',
        planId: 'pro',
      });

      assert.equal(failed.status, 'failed');
      assert.equal(failed.reason, 'provider_error');
      assert.equal(failed.error, 'domain is not verified');
    } finally {
      restoreHttps();
    }
  });

  test('checkout session payload supports hosted credit packs with public product image', () => {
    const billing = require('../scripts/billing');
    billing.CONFIG.CREDIT_PACKS.test_pack = {
      id: 'test_pack',
      name: 'ThumbGate Credit Pack',
      currency: 'USD',
      amountCents: 5000,
      credits: 1000,
    };

    const payload = billing._buildCheckoutSessionPayload({
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      customerEmail: 'buyer@example.com',
      checkoutMetadata: {
        traceId: 'trace_credit_pack',
        planId: 'credits',
      },
      packId: 'test_pack',
      appOrigin: 'https://thumbgate-production.up.railway.app',
    });

    assert.equal(payload.mode, 'payment');
    assert.equal(payload.customer_email, 'buyer@example.com');
    assert.equal(payload.metadata.packId, 'test_pack');
    assert.equal(payload.metadata.credits, '1000');
    assert.equal(payload.line_items[0].price_data.currency, 'usd');
    assert.equal(payload.line_items[0].price_data.unit_amount, 5000);
    assert.equal(payload.line_items[0].price_data.product_data.name, 'ThumbGate Credit Pack');
    assert.deepEqual(payload.line_items[0].price_data.product_data.images, [
      'https://thumbgate-production.up.railway.app/assets/brand/thumbgate-icon-512.png',
    ]);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'subscription_data'), false);

    delete billing.CONFIG.CREDIT_PACKS.test_pack;
  });

  test('hosted checkout retries without unsupported branding settings', async () => {
    const attempts = [];
    const restoreStripe = installStripeMock(function Stripe() {
      return {
        checkout: {
          sessions: {
            create: async (payload) => {
              attempts.push(payload);
              if (attempts.length === 1) {
                throw new Error('Received unknown parameter: branding_settings');
              }
              return { id: 'cs_live_fallback', url: 'https://checkout.stripe.com/c/pay/cs_live_fallback' };
            },
          },
        },
      };
    });

    try {
      const billing = requireFreshBilling('sk_test_live_checkout');
      const result = await billing.createCheckoutSession({
        installId: 'inst_live_checkout',
        customerEmail: 'buyer@example.com',
        appOrigin: 'https://thumbgate-production.up.railway.app',
      });

      assert.equal(result.localMode, false);
      assert.equal(result.sessionId, 'cs_live_fallback');
      assert.equal(attempts.length, 2);
      assert.ok(attempts[0].branding_settings);
      assert.equal(Object.prototype.hasOwnProperty.call(attempts[1], 'branding_settings'), false);
      assert.match(attempts[1].line_items[0].price_data.product_data.images[0], /thumbgate-icon-pro-512\.png$/);
    } finally {
      restoreStripe();
    }
  });

  test('hosted checkout status provisions key and exposes trial email delivery status', async () => {
    const restoreStripe = installStripeMock(function Stripe() {
      return {
        checkout: {
          sessions: {
            retrieve: async (sessionId) => ({
              id: sessionId,
              customer: 'cus_live_status',
              customer_details: { email: 'Buyer@Example.com' },
              customer_email: null,
              payment_status: 'paid',
              status: 'complete',
              metadata: {
                installId: 'inst_live_status',
                traceId: 'trace_live_status',
                planId: 'pro',
                credits: '25',
                ctaId: 'install-free',
                ctaPlacement: 'pricing',
                landingPath: '/',
                referrerHost: 'thumbgate.test',
              },
            }),
          },
        },
      };
    });

    try {
      const billing = requireFreshBilling('sk_test_live_status');
      const status = await billing.getCheckoutSessionStatus('cs_live_status');

      assert.equal(status.found, true);
      assert.equal(status.localMode, false);
      assert.equal(status.paid, true);
      assert.equal(status.customerEmail, 'Buyer@Example.com');
      assert.equal(status.installId, 'inst_live_status');
      assert.equal(status.traceId, 'trace_live_status');
      assert.equal(status.remainingCredits, 25);
      assert.equal(status.trialEmail.status, 'skipped');
      assert.equal(status.trialEmail.reason, 'missing_resend_api_key');
    } finally {
      restoreStripe();
    }
  });

  test('stripe webhook provisions and reports skipped activation email when provider is missing', async () => {
    const savedWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = '';
    const billing = requireFreshBilling('sk_test_webhook');
    try {
      const result = await billing.handleWebhook(Buffer.from(JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_webhook_email',
            customer: 'cus_webhook_email',
            customer_email: null,
            customer_details: { email: 'webhook@example.com' },
            payment_status: 'paid',
            mode: 'subscription',
            amount_total: 1900,
            currency: 'usd',
            metadata: {
              installId: 'inst_webhook_email',
              traceId: 'trace_webhook_email',
              planId: 'pro',
              billingCycle: 'monthly',
            },
          },
        },
      })), null);

      assert.equal(result.handled, true);
      assert.equal(result.action, 'provisioned_api_key');
      assert.ok(result.result.key.startsWith('tg_'));
      assert.equal(result.trialEmail.status, 'skipped');
      assert.equal(result.trialEmail.reason, 'missing_resend_api_key');

      const rows = readTrialEmailRows();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].sessionId, 'cs_test_webhook_email');
      assert.equal(rows[0].customerEmail, 'webhook@example.com');
      assert.equal(rows[0].source, 'stripe_webhook_checkout_completed');
      assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'apiKey'), false);
    } finally {
      if (savedWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = savedWebhookSecret;
    }
  });

  test('recordUsage emits activation only once', () => {
    const billing = require('../scripts/billing');
    const p = billing.provisionApiKey('cus_act');
    billing.recordUsage(p.key);
    billing.recordUsage(p.key);
    const events = readLedgerEvents();
    assert.equal(events.filter(e => e.stage === 'activation').length, 1);
  });

  test('getBillingSummary merges funnel ledger and key store state', () => {
    const billing = require('../scripts/billing');
    const { appendWorkflowSprintLead } = require('../scripts/workflow-sprint-intake');
    const activeKey = billing.provisionApiKey('cus_summary_a', {
      installId: 'inst_summary_a',
      source: 'stripe_webhook_checkout_completed',
    });
    const disabledKey = billing.provisionApiKey('cus_summary_b', {
      installId: 'inst_summary_b',
      source: 'github_marketplace_purchased',
    });

    billing.recordUsage(activeKey.key);
    billing.recordUsage(activeKey.key);
    billing.disableCustomerKeys('cus_summary_b');
    billing.appendFunnelEvent({
      stage: 'acquisition',
      event: 'checkout_session_created',
      installId: 'inst_summary_a',
      evidence: 'sess_summary_a',
      metadata: {
        customerId: 'cus_summary_a',
        source: 'reddit',
        utmSource: 'reddit',
        utmMedium: 'organic_social',
        utmCampaign: 'reddit_launch',
        creator: 'reach_vb',
        community: 'ClaudeCode',
        postId: '1rsudq0',
        commentId: 'oa9mqjf',
        campaignVariant: 'comment_problem_solution',
        offerCode: 'REDDIT-EARLY',
      },
    });
    billing.appendFunnelEvent({
      stage: 'paid',
      event: 'stripe_checkout_completed',
      installId: 'inst_summary_a',
      evidence: 'cs_summary_a',
      traceId: 'trace_summary_a',
      metadata: {
        customerId: 'cus_summary_a',
        source: 'reddit',
        utmSource: 'reddit',
        utmMedium: 'organic_social',
        utmCampaign: 'reddit_launch',
        creator: 'reach_vb',
        community: 'ClaudeCode',
        postId: '1rsudq0',
        commentId: 'oa9mqjf',
        campaignVariant: 'comment_problem_solution',
        offerCode: 'REDDIT-EARLY',
      },
    });
    billing.appendRevenueEvent({
      provider: 'stripe',
      event: 'stripe_checkout_completed',
      status: 'paid',
      customerId: 'cus_summary_a',
      orderId: 'cs_summary_a',
      installId: 'inst_summary_a',
      traceId: 'trace_summary_a',
      amountCents: 4900,
      currency: 'usd',
      amountKnown: true,
      recurringInterval: null,
      attribution: {
        source: 'reddit',
        utmSource: 'reddit',
        utmMedium: 'organic_social',
        utmCampaign: 'reddit_launch',
        creator: 'reach_vb',
        community: 'ClaudeCode',
        postId: '1rsudq0',
        commentId: 'oa9mqjf',
        campaignVariant: 'comment_problem_solution',
        offerCode: 'REDDIT-EARLY',
      },
      metadata: { subscriptionId: 'sub_summary_a' },
    });
    appendWorkflowSprintLead({
      email: 'ops@example.com',
      company: 'Example Co',
      workflow: 'Claude code modernization approvals',
      owner: 'Platform lead',
      blocker: 'Auditors reject deployments without machine-readable proof',
      runtime: 'Claude Code + MCP',
      source: 'linkedin',
      utmSource: 'linkedin',
      utmCampaign: 'workflow_hardening',
      creator: 'reach_vb',
      community: 'platform',
    });

    const summary = billing.getBillingSummary();
    assert.equal(summary.coverage.source, 'funnel_ledger+revenue_ledger+key_store+workflow_sprint_leads');
    assert.equal(summary.coverage.tracksBookedRevenue, true);
    assert.equal(summary.coverage.tracksPaidOrders, true);
    assert.equal(summary.coverage.tracksWorkflowSprintLeads, true);
    assert.equal(summary.coverage.tracksNewsletterSubscribers, true);
    assert.equal(summary.funnel.stageCounts.acquisition, 1);
    assert.equal(summary.funnel.stageCounts.activation, 1);
    assert.equal(summary.funnel.stageCounts.paid, 1);
    assert.equal(summary.signups.uniqueLeads, 1);
    assert.equal(summary.revenue.paidOrders, 1);
    assert.equal(summary.revenue.bookedRevenueCents, 4900);
    assert.equal(summary.revenue.amountKnownCoverageRate, 1);
    assert.equal(summary.revenue.paidProviderEvents, 1);
    assert.equal(summary.pipeline.workflowSprintLeads.total, 1);
    assert.equal(summary.pipeline.workflowSprintLeads.contactable, 1);
    assert.equal(summary.pipeline.workflowSprintLeads.byStatus.new, 1);
    assert.equal(summary.pipeline.workflowSprintLeads.bySource.linkedin, 1);
    assert.equal(summary.pipeline.workflowSprintLeads.byCampaign.workflow_hardening, 1);
    assert.equal(summary.pipeline.workflowSprintLeads.byCreator.reach_vb, 1);
    assert.equal(summary.pipeline.workflowSprintLeads.byCommunity.platform, 1);
    assert.equal(summary.pipeline.workflowSprintLeads.byRuntime['Claude Code + MCP'], 1);
    assert.equal(summary.pipeline.workflowSprintLeads.latestLead.email, 'ops@example.com');
    assert.equal(summary.pipeline.qualifiedWorkflowSprintLeads.total, 1);
    assert.equal(summary.pipeline.qualifiedWorkflowSprintLeads.bySource.linkedin, 1);
    assert.equal(summary.pipeline.qualifiedWorkflowSprintLeads.byCreator.reach_vb, 1);
    assert.equal(summary.attribution.acquisitionBySource.reddit, 1);
    assert.equal(summary.attribution.acquisitionByCreator.reach_vb, 1);
    assert.equal(summary.attribution.acquisitionByCommunity.ClaudeCode, 1);
    assert.equal(summary.attribution.acquisitionByPostId['1rsudq0'], 1);
    assert.equal(summary.attribution.acquisitionByCommentId.oa9mqjf, 1);
    assert.equal(summary.attribution.acquisitionByCampaignVariant.comment_problem_solution, 1);
    assert.equal(summary.attribution.acquisitionByOfferCode['REDDIT-EARLY'], 1);
    assert.equal(summary.attribution.paidByCampaign.reddit_launch, 1);
    assert.equal(summary.attribution.paidByCreator.reach_vb, 1);
    assert.equal(summary.attribution.paidByCommunity.ClaudeCode, 1);
    assert.equal(summary.attribution.paidByPostId['1rsudq0'], 1);
    assert.equal(summary.attribution.paidByCommentId.oa9mqjf, 1);
    assert.equal(summary.attribution.paidByCampaignVariant.comment_problem_solution, 1);
    assert.equal(summary.attribution.paidByOfferCode['REDDIT-EARLY'], 1);
    assert.equal(summary.attribution.bookedRevenueBySourceCents.reddit, 4900);
    assert.equal(summary.attribution.bookedRevenueByCreatorCents.reach_vb, 4900);
    assert.equal(summary.attribution.bookedRevenueByCommunityCents.ClaudeCode, 4900);
    assert.equal(summary.attribution.bookedRevenueByPostIdCents['1rsudq0'], 4900);
    assert.equal(summary.attribution.bookedRevenueByCommentIdCents.oa9mqjf, 4900);
    assert.equal(summary.attribution.bookedRevenueByCampaignVariantCents.comment_problem_solution, 4900);
    assert.equal(summary.attribution.bookedRevenueByOfferCodeCents['REDDIT-EARLY'], 4900);
    assert.equal(summary.attribution.conversionByCreator.reach_vb, 1);
    assert.equal(summary.attribution.conversionByCommunity.ClaudeCode, 1);
    assert.equal(summary.attribution.conversionByPostId['1rsudq0'], 1);
    assert.equal(summary.attribution.conversionByCommentId.oa9mqjf, 1);
    assert.equal(summary.attribution.conversionByCampaignVariant.comment_problem_solution, 1);
    assert.equal(summary.attribution.conversionByOfferCode['REDDIT-EARLY'], 1);
    assert.equal(summary.keys.total, 2);
    assert.equal(summary.keys.active, 1);
    assert.equal(summary.keys.disabled, 1);
    assert.equal(summary.keys.totalUsage, 2);
    assert.equal(summary.keys.activeCustomers, 1);
    assert.equal(summary.keys.bySource.stripe_webhook_checkout_completed, 1);
    assert.equal(summary.keys.bySource.github_marketplace_purchased, 1);
    assert.equal(summary.keys.activeBySource.stripe_webhook_checkout_completed, 1);
    assert.ok(summary.funnel.firstPaidAt);
    assert.equal(summary.funnel.lastPaidEvent.customerId, 'cus_summary_a');
    assert.equal(summary.dataQuality.unreconciledPaidEvents, 0);

    const activeCustomer = summary.customers.find((entry) => entry.customerId === 'cus_summary_a');
    const disabledCustomer = summary.customers.find((entry) => entry.customerId === 'cus_summary_b');
    assert.equal(activeCustomer.activeKeys, 1);
    assert.equal(activeCustomer.usageCount, 2);
    assert.equal(disabledCustomer.activeKeys, 0);
    assert.equal(disabledCustomer.source, 'github_marketplace_purchased');
    assert.equal(disabledKey.customerId, 'cus_summary_b');
  });

  test('getBillingSummary reports newsletter subscribers separately from acquisition events', () => {
    const billing = requireFreshBilling('');
    fs.mkdirSync(testFeedbackDir, { recursive: true });
    writeNewsletterSubscribers([
      {
        email: 'first@example.com',
        subscribedAt: '2026-04-06T14:00:00.000Z',
        source: 'reddit',
        referrerHost: 'www.reddit.com',
        landingPath: '/',
        attribution: {
          source: 'reddit',
          campaign: 'reddit_launch',
          creator: 'reach_vb',
          community: 'ClaudeCode',
          postId: '1rsudq0',
          commentId: 'oa9mqjf',
          campaignVariant: 'comment_problem_solution',
          offerCode: 'REDDIT-EARLY',
        },
      },
      {
        email: 'second@example.com',
        subscribedAt: '2026-04-06T15:00:00.000Z',
        source: 'x',
        referrerHost: 'x.com',
        landingPath: '/',
        attribution: {
          source: 'x',
          campaign: 'x_launch',
        },
      },
    ]);

    const summary = billing.getBillingSummary();
    assert.equal(summary.newsletter.total, 2);
    assert.equal(summary.newsletter.uniqueSubscribers, 2);
    assert.equal(summary.newsletter.bySource.reddit, 1);
    assert.equal(summary.newsletter.bySource.x, 1);
    assert.equal(summary.newsletter.byCampaign.reddit_launch, 1);
    assert.equal(summary.newsletter.byCampaign.x_launch, 1);
    assert.equal(summary.newsletter.byCreator.reach_vb, 1);
    assert.equal(summary.newsletter.byCommunity.ClaudeCode, 1);
    assert.equal(summary.newsletter.byPostId['1rsudq0'], 1);
    assert.equal(summary.newsletter.byCommentId.oa9mqjf, 1);
    assert.equal(summary.newsletter.byCampaignVariant.comment_problem_solution, 1);
    assert.equal(summary.newsletter.byOfferCode['REDDIT-EARLY'], 1);
    assert.equal(summary.newsletter.latestSubscriber.email, 'second@example.com');
    assert.equal(summary.trafficMetrics.newsletterSignups, 2);
  });

  test('handleGithubWebhook records paid order with unknown amount when plan pricing is not configured', () => {
    const billing = require('../scripts/billing');
    billing.handleGithubWebhook({
      action: 'purchased',
      marketplace_purchase: {
        account: { type: 'User', id: 42, login: 'octocat' },
        plan: { id: 1, name: 'Pro' },
      },
    });

    const revenueEvents = readRevenueEvents();
    assert.equal(revenueEvents.length, 1);
    assert.equal(revenueEvents[0].provider, 'github_marketplace');
    assert.equal(revenueEvents[0].amountKnown, false);
    assert.equal(revenueEvents[0].amountCents, null);
  });

  test('handleGithubWebhook records booked revenue when plan pricing is configured', () => {
    process.env.THUMBGATE_GITHUB_MARKETPLACE_PLAN_PRICES_JSON = JSON.stringify({
      7: { amountCents: 4900, currency: 'USD', recurringInterval: null },
    });
    const billing = requireFreshBilling('');
    billing.handleGithubWebhook({
      action: 'purchased',
      marketplace_purchase: {
        account: { type: 'Organization', id: 77, login: 'team' },
        plan: { id: 7, name: 'Pro' },
      },
    });

    const revenueEvents = readRevenueEvents();
    assert.equal(revenueEvents.length, 1);
    assert.equal(revenueEvents[0].amountKnown, true);
    assert.equal(revenueEvents[0].amountCents, 4900);
    assert.equal(revenueEvents[0].currency, 'USD');
    assert.equal(revenueEvents[0].recurringInterval, null);
  });

  test('handleGithubWebhook records booked revenue from webhook plan pricing before env mapping', () => {
    const billing = requireFreshBilling('');
    billing.handleGithubWebhook({
      action: 'purchased',
      marketplace_purchase: {
        billing_cycle: 'monthly',
        account: { type: 'Organization', id: 78, login: 'webhook-priced' },
        plan: {
          id: 8,
          name: 'Pro',
          monthly_price_in_cents: 4900,
          yearly_price_in_cents: 49000,
          price_model: 'FLAT_RATE'
        },
      },
    });

    const revenueEvents = readRevenueEvents();
    assert.equal(revenueEvents.length, 1);
    assert.equal(revenueEvents[0].amountKnown, true);
    assert.equal(revenueEvents[0].amountCents, 4900);
    assert.equal(revenueEvents[0].currency, 'USD');
    assert.equal(revenueEvents[0].recurringInterval, 'month');
  });

  test('getBillingSummary reports github marketplace webhook pricing coverage', () => {
    const billing = requireFreshBilling('');
    const summary = billing.getBillingSummary();

    assert.equal(summary.coverage.providerCoverage.githubMarketplace, 'webhook_or_configured_plan_prices');
  });

  test('getBillingSummary backfills legacy github marketplace amounts from configured plan pricing at read time', () => {
    process.env.THUMBGATE_GITHUB_MARKETPLACE_PLAN_PRICES_JSON = JSON.stringify({
      70: { amountCents: 4900, currency: 'USD', recurringInterval: 'month' },
    });
    const billing = requireFreshBilling('');
    fs.writeFileSync(testRevenueLedgerPath, `${JSON.stringify({
      timestamp: '2026-03-19T12:00:00.000Z',
      provider: 'github_marketplace',
      event: 'github_marketplace_purchased',
      status: 'paid',
      orderId: 'marketplace_order_backfill_preview',
      evidence: 'marketplace_order_backfill_preview',
      customerId: 'github_org_70',
      amountCents: null,
      currency: null,
      amountKnown: false,
      recurringInterval: null,
      attribution: { source: 'github_marketplace' },
      metadata: {
        planId: 70,
        planName: 'Pro',
        marketplaceOrderId: 'marketplace_order_backfill_preview',
      },
    })}\n`, 'utf-8');

    const preview = billing.repairGithubMarketplaceRevenueLedger();
    const summary = billing.getBillingSummary();
    const revenueEvents = readRevenueEvents();

    assert.equal(preview.write, false);
    assert.equal(preview.wrote, false);
    assert.equal(preview.repaired, 1);
    assert.equal(preview.repairs[0].amountCents, 4900);
    assert.equal(preview.repairs[0].pricingSource, 'configured_plan_price');
    assert.equal(summary.revenue.bookedRevenueCents, 4900);
    assert.equal(summary.revenue.amountKnownOrders, 1);
    assert.equal(summary.revenue.amountUnknownOrders, 0);
    assert.equal(revenueEvents[0].amountKnown, false);
    assert.equal(revenueEvents[0].amountCents, null);
  });

  test('repairGithubMarketplaceRevenueLedger writes repaired github marketplace amounts into the local ledger', () => {
    process.env.THUMBGATE_GITHUB_MARKETPLACE_PLAN_PRICES_JSON = JSON.stringify({
      71: { amountCents: 9900, currency: 'USD', recurringInterval: 'year' },
    });
    const billing = requireFreshBilling('');
    fs.writeFileSync(testRevenueLedgerPath, `${JSON.stringify({
      timestamp: '2026-03-19T12:30:00.000Z',
      provider: 'github_marketplace',
      event: 'github_marketplace_purchased',
      status: 'paid',
      orderId: 'marketplace_order_backfill_write',
      evidence: 'marketplace_order_backfill_write',
      customerId: 'github_org_71',
      amountCents: null,
      currency: null,
      amountKnown: false,
      recurringInterval: null,
      attribution: { source: 'github_marketplace' },
      metadata: {
        planId: 71,
        planName: 'Annual Pro',
        marketplaceOrderId: 'marketplace_order_backfill_write',
      },
    })}\n`, 'utf-8');

    const repair = billing.repairGithubMarketplaceRevenueLedger({ write: true });
    const revenueEvents = readRevenueEvents();

    assert.equal(repair.write, true);
    assert.equal(repair.wrote, true);
    assert.equal(repair.repaired, 1);
    assert.equal(revenueEvents[0].amountKnown, true);
    assert.equal(revenueEvents[0].amountCents, 9900);
    assert.equal(revenueEvents[0].currency, 'USD');
    assert.equal(revenueEvents[0].recurringInterval, 'year');
    assert.equal(revenueEvents[0].metadata.githubMarketplaceAmountSource, 'configured_plan_price');
    assert.ok(revenueEvents[0].metadata.githubMarketplaceAmountResolvedAt);
  });

  test('getBillingSummary derives paid orders from paid provider events when revenue ledger is missing', () => {
    const billing = require('../scripts/billing');
    billing.appendFunnelEvent({
      stage: 'paid',
      event: 'github_marketplace_purchased',
      evidence: 'marketplace_order_derived',
      metadata: {
        provider: 'github_marketplace',
        customerId: 'github_user_derived',
        marketplaceOrderId: 'marketplace_order_derived',
        source: 'github_marketplace',
      },
    });

    const summary = billing.getBillingSummary();
    assert.equal(summary.revenue.paidProviderEvents, 1);
    assert.equal(summary.revenue.paidOrders, 1);
    assert.equal(summary.revenue.bookedRevenueCents, 0);
    assert.equal(summary.revenue.amountKnownCoverageRate, 0);
    assert.equal(summary.revenue.derivedPaidOrders, 1);
    assert.equal(summary.dataQuality.unreconciledPaidEvents, 0);
  });
  test('getBillingSummary applies today window across revenue, telemetry, and sprint leads', () => {
    const billing = require('../scripts/billing');
    const telemetryPath = path.join(testFeedbackDir, 'telemetry-pings.jsonl');
    const leadsPath = path.join(testFeedbackDir, 'workflow-sprint-leads.jsonl');

    billing.provisionApiKey('cus_window_summary', {
      installId: 'inst_window_summary',
      source: 'stripe_webhook_checkout_completed',
    });

    fs.mkdirSync(testFeedbackDir, { recursive: true });
    fs.writeFileSync(testFunnelLedgerPath, [
      JSON.stringify({
        timestamp: '2026-03-18T23:30:00.000Z',
        stage: 'acquisition',
        event: 'checkout_session_created',
        installId: 'inst_old_summary',
        traceId: 'trace_old_summary',
        evidence: 'sess_old_summary',
        metadata: {
          customerId: 'cus_old_summary',
          source: 'reddit',
          utmSource: 'reddit',
          utmCampaign: 'old_launch',
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-19T10:00:00.000Z',
        stage: 'acquisition',
        event: 'checkout_session_created',
        installId: 'inst_window_summary',
        traceId: 'trace_window_summary',
        evidence: 'sess_window_summary',
        metadata: {
          customerId: 'cus_window_summary',
          source: 'website',
          utmSource: 'website',
          utmCampaign: 'today_launch',
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-19T10:05:00.000Z',
        stage: 'paid',
        event: 'stripe_checkout_completed',
        installId: 'inst_window_summary',
        traceId: 'trace_window_summary',
        evidence: 'cs_window_summary',
        metadata: {
          customerId: 'cus_window_summary',
          source: 'website',
          utmSource: 'website',
          utmCampaign: 'today_launch',
        },
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(testRevenueLedgerPath, [
      JSON.stringify({
        timestamp: '2026-03-18T23:40:00.000Z',
        provider: 'stripe',
        event: 'stripe_checkout_completed',
        status: 'paid',
        orderId: 'cs_old_summary',
        evidence: 'cs_old_summary',
        customerId: 'cus_old_summary',
        installId: 'inst_old_summary',
        traceId: 'trace_old_summary',
        amountCents: 9900,
        currency: 'USD',
        amountKnown: true,
        recurringInterval: null,
        attribution: {
          source: 'reddit',
          utmSource: 'reddit',
          utmCampaign: 'old_launch',
        },
        metadata: {},
      }),
      JSON.stringify({
        timestamp: '2026-03-19T10:05:00.000Z',
        provider: 'stripe',
        event: 'stripe_checkout_completed',
        status: 'paid',
        orderId: 'cs_window_summary',
        evidence: 'cs_window_summary',
        customerId: 'cus_window_summary',
        installId: 'inst_window_summary',
        traceId: 'trace_window_summary',
        amountCents: 4900,
        currency: 'USD',
        amountKnown: true,
        recurringInterval: null,
        attribution: {
          source: 'website',
          utmSource: 'website',
          utmCampaign: 'today_launch',
        },
        metadata: {},
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(leadsPath, [
      JSON.stringify({
        leadId: 'lead_old_summary',
        submittedAt: '2026-03-18T20:00:00.000Z',
        status: 'new',
        offer: 'workflow_hardening_sprint',
        contact: {
          email: 'old@example.com',
          company: 'Old Co',
        },
        qualification: {
          workflow: 'Old workflow',
          owner: 'Old owner',
          blocker: 'Old blocker',
          runtime: 'Claude Code',
          note: null,
        },
        attribution: {
          source: 'reddit',
          utmSource: 'reddit',
          utmCampaign: 'old_launch',
        },
      }),
      JSON.stringify({
        leadId: 'lead_window_summary',
        submittedAt: '2026-03-19T11:00:00.000Z',
        status: 'new',
        offer: 'workflow_hardening_sprint',
        contact: {
          email: 'today@example.com',
          company: 'Today Co',
        },
        qualification: {
          workflow: 'Today workflow',
          owner: 'Today owner',
          blocker: 'Today blocker',
          runtime: 'Claude Code',
          note: null,
        },
        attribution: {
          source: 'linkedin',
          utmSource: 'linkedin',
          utmCampaign: 'today_launch',
        },
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(telemetryPath, [
      JSON.stringify({
        receivedAt: '2026-03-18T22:00:00.000Z',
        eventType: 'landing_page_view',
        clientType: 'web',
        acquisitionId: 'acq_old_summary',
        visitorId: 'visitor_old_summary',
        sessionId: 'session_old_summary',
        source: 'reddit',
        page: '/',
      }),
      JSON.stringify({
        receivedAt: '2026-03-19T09:55:00.000Z',
        eventType: 'landing_page_view',
        clientType: 'web',
        acquisitionId: 'acq_window_summary',
        visitorId: 'visitor_window_summary',
        sessionId: 'session_window_summary',
        source: 'website',
        page: '/',
      }),
      JSON.stringify({
        receivedAt: '2026-03-19T10:00:00.000Z',
        eventType: 'checkout_start',
        clientType: 'web',
        acquisitionId: 'acq_window_summary',
        visitorId: 'visitor_window_summary',
        sessionId: 'session_window_summary',
        source: 'website',
        ctaId: 'pricing_pro',
      }),
      JSON.stringify({
        receivedAt: '2026-03-19T10:06:00.000Z',
        eventType: 'checkout_paid_confirmed',
        clientType: 'web',
        acquisitionId: 'acq_window_summary',
        visitorId: 'visitor_window_summary',
        sessionId: 'session_window_summary',
        traceId: 'trace_window_summary',
      }),
      '',
    ].join('\n'));

    const summary = billing.getBillingSummary({
      window: 'today',
      timeZone: 'UTC',
      now: '2026-03-19T18:00:00.000Z',
    });

    assert.equal(summary.window.window, 'today');
    assert.equal(summary.window.startLocalDate, '2026-03-19');
    assert.equal(summary.signups.total, 1);
    assert.equal(summary.revenue.paidOrders, 1);
    assert.equal(summary.revenue.bookedRevenueCents, 4900);
    assert.equal(summary.pipeline.workflowSprintLeads.total, 1);
    assert.equal(summary.pipeline.workflowSprintLeads.bySource.linkedin, 1);
    assert.equal(summary.trafficMetrics.pageViews, 1);
    assert.equal(summary.trafficMetrics.checkoutStarts, 1);
    assert.equal(summary.trafficMetrics.checkoutPaidConfirmations, 1);
    assert.equal(summary.sourceDiagnostics.files.keyStore.activeMode, 'primary');
    assert.equal(summary.sourceDiagnostics.files.funnelLedger.activeMode, 'primary');
    assert.equal(summary.sourceDiagnostics.files.revenueLedger.activeMode, 'primary');
    assert.equal(summary.sourceDiagnostics.files.telemetry.activeMode, 'primary');
    assert.equal(summary.sourceDiagnostics.mixedRoots, false);
    assert.deepEqual(summary.sourceDiagnostics.warnings, []);
    assert.equal(summary.keys.scope, 'current_state');
    assert.equal(summary.keys.windowed, false);
  });

  test('getBillingSummaryLive includes Stripe-reconciled historical revenue without claiming money today', async () => {
    process.env._TEST_STRIPE_RECONCILED_REVENUE_EVENTS_JSON = JSON.stringify([
      {
        timestamp: '2025-11-18T10:36:00.000Z',
        provider: 'stripe',
        event: 'stripe_charge_reconciled',
        status: 'paid',
        orderId: 'ch_hist_001',
        evidence: 'ch_hist_001',
        customerId: 'cus_hist_001',
        amountCents: 1000,
        currency: 'USD',
        amountKnown: true,
        recurringInterval: 'month',
        attribution: {
          source: 'stripe_reconciled',
        },
        metadata: {
          stripeReconciled: true,
          priceId: 'price_hist_001',
          productId: 'prod_hist_001',
        },
      },
    ]);

    const billing = requireFreshBilling('');
    const summary = await billing.getBillingSummaryLive();

    assert.equal(summary.revenue.bookedRevenueCents, 1000);
    assert.equal(summary.revenue.bookedRevenueTodayCents, 0);
    assert.equal(summary.revenue.paidOrders, 1);
    assert.equal(summary.revenue.paidOrdersToday, 0);
    assert.equal(summary.revenue.processorReconciledOrders, 1);
    assert.equal(summary.revenue.processorReconciledRevenueCents, 1000);
    assert.equal(summary.coverage.providerCoverage.stripe, 'booked_revenue+processor_reconciled');
  });
});

describe('billing.js — rotateApiKey', () => {
  test('rotateApiKey rotates key and disables old one', () => {
    const keyStorePath = setupTempStore();
    const billing = requireFreshBilling('');
    const p1 = billing.provisionApiKey('cus_rot');
    const oldKey = p1.key;
    const rot = billing.rotateApiKey(oldKey);
    assert.equal(rot.rotated, true);
    assert.ok(rot.key.startsWith('tg_'));
    assert.notEqual(rot.key, oldKey);
    assert.equal(billing.validateApiKey(oldKey).valid, false);
    assert.equal(billing.validateApiKey(rot.key).valid, true);
    cleanupTempStore();
  });
});

describe('API server — /v1/billing/* routes', () => {
  let server, port, billing;
  before(async () => {
    process.env.THUMBGATE_ALLOW_INSECURE = 'true';
    process.env._TEST_API_KEYS_PATH = testApiKeysPath;
    process.env._TEST_FUNNEL_LEDGER_PATH = testFunnelLedgerPath;
    process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = testLocalCheckoutSessionsPath;

    delete require.cache[require.resolve('../src/api/server')];
    delete require.cache[require.resolve('../scripts/billing')];
    
    const { startServer: freshStart } = require('../src/api/server');
    const started = await freshStart({ port: 0 });
    server = started.server;
    port = started.port;
    billing = require('../scripts/billing');
  });
  after(async () => {
    await new Promise(r => server.close(r));
    delete process.env.THUMBGATE_ALLOW_INSECURE;
  });

  test('POST /v1/billing/checkout returns sessionId', async () => {
    const res = await fetch(`http://localhost:${port}/v1/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installId: 'inst_api' })
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const body = await res.json();
    assert.ok(body && body.sessionId && body.sessionId.startsWith('test_session_'));
    assert.match(body.traceId, /^checkout_/);
    assert.equal(res.headers.get('x-thumbgate-trace-id'), body.traceId);
  });
});

describe('billing.js — withTimeout helper', () => {
  test('resolves when promise settles before timeout', async () => {
    const billing = requireFreshBilling('');
    const result = await billing._withTimeout(Promise.resolve('ok'), 1000);
    assert.equal(result, 'ok');
  });

  test('rejects with timeout error when promise exceeds timeout', async () => {
    const billing = requireFreshBilling('');
    const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 5000));
    await assert.rejects(
      () => billing._withTimeout(slow, 50),
      (err) => {
        assert.ok(err.message.includes('Stripe API timeout after 50ms'));
        return true;
      }
    );
  });

  test('rejects with original error when promise rejects before timeout', async () => {
    const billing = requireFreshBilling('');
    await assert.rejects(
      () => billing._withTimeout(Promise.reject(new Error('stripe_err')), 5000),
      (err) => {
        assert.equal(err.message, 'stripe_err');
        return true;
      }
    );
  });
});

describe('billing.js — getBillingSummaryLive fallback paths', () => {
  beforeEach(() => {
    clearBillingArtifacts();
  });

  test('returns default object with stripe_timeout error when options getter throws timeout', async () => {
    const billing = requireFreshBilling('');
    const trap = Object.create(null, {
      poisoned: {
        get() { throw new Error('Stripe API timeout after 5000ms'); },
        enumerable: true,
      },
    });

    const summary = await billing.getBillingSummaryLive(trap);

    assert.equal(summary.error, 'stripe_timeout');
    assert.ok(summary.message.includes('Stripe API timeout'));
    assert.equal(summary.revenue.total, 0);
    assert.equal(summary.revenue.mrr, 0);
    assert.deepEqual(summary.revenue.events, []);
    assert.deepEqual(summary.customers, []);
  });

  test('returns default object with billing_summary_error on non-timeout errors', async () => {
    const billing = requireFreshBilling('');
    const trap = Object.create(null, {
      poisoned: {
        get() { throw new Error('unexpected failure'); },
        enumerable: true,
      },
    });

    const summary = await billing.getBillingSummaryLive(trap);

    assert.equal(summary.error, 'billing_summary_error');
    assert.equal(summary.message, 'unexpected failure');
    assert.equal(summary.revenue.total, 0);
    assert.equal(summary.usage.totalUsage, 0);
  });

  test('returns default object when error has no message property', async () => {
    const billing = requireFreshBilling('');
    const trap = Object.create(null, {
      poisoned: {
        get() { throw null; },
        enumerable: true,
      },
    });

    const summary = await billing.getBillingSummaryLive(trap);

    assert.equal(summary.error, 'billing_summary_error');
    assert.equal(summary.message, 'Unknown error');
  });
});

describe('billing.js — listStripeReconciledRevenueEvents edge cases', () => {
  beforeEach(() => {
    clearBillingArtifacts();
  });

  test('returns empty array when STRIPE_SECRET_KEY is missing', async () => {
    delete process.env._TEST_STRIPE_RECONCILED_REVENUE_EVENTS_JSON;
    const billing = requireFreshBilling('');
    const events = await billing.listStripeReconciledRevenueEvents();
    assert.deepEqual(events, []);
  });

  test('returns test events from env var when set', async () => {
    process.env._TEST_STRIPE_RECONCILED_REVENUE_EVENTS_JSON = JSON.stringify([
      { provider: 'stripe', event: 'stripe_charge_reconciled', orderId: 'ch_test_1' },
    ]);
    const billing = requireFreshBilling('');
    const events = await billing.listStripeReconciledRevenueEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].orderId, 'ch_test_1');
  });

  test('returns empty array when env var has invalid JSON', async () => {
    process.env._TEST_STRIPE_RECONCILED_REVENUE_EVENTS_JSON = 'not-json{{{';
    const billing = requireFreshBilling('');
    const events = await billing.listStripeReconciledRevenueEvents();
    assert.deepEqual(events, []);
  });

  test('live billing summary falls back when Stripe reconciliation exceeds budget', async () => {
    const restore = installStripeMock(() => ({
      prices: {
        retrieve: () => new Promise(() => {}),
        list: () => new Promise(() => {}),
      },
      charges: {
        list: () => new Promise(() => {}),
      },
    }));
    process.env.STRIPE_PRICE_ID = 'price_timeout_probe';
    try {
      const billing = requireFreshBilling('sk_live_timeout_probe');
      const startedAt = Date.now();
      const summary = await billing.getBillingSummaryLive({ stripeReconciliationTimeoutMs: 5 });

      assert.ok(Date.now() - startedAt < 500);
      assert.equal(summary.error, undefined);
      assert.equal(summary.coverage.source, 'funnel_ledger+revenue_ledger+key_store+workflow_sprint_leads');
    } finally {
      restore();
      process.env.STRIPE_PRICE_ID = '';
    }
  });
});
