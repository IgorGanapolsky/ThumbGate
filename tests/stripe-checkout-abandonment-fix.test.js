'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stripe-abandonment-fix-'));
const feedbackDir = path.join(tmpRoot, 'feedback');
fs.mkdirSync(feedbackDir, { recursive: true });

const savedEnv = {};
const TEST_ENV = {
  _TEST_API_KEYS_PATH: path.join(tmpRoot, 'api-keys.json'),
  _TEST_FUNNEL_LEDGER_PATH: path.join(tmpRoot, 'funnel-events.jsonl'),
  _TEST_REVENUE_LEDGER_PATH: path.join(tmpRoot, 'revenue-events.jsonl'),
  _TEST_LOCAL_CHECKOUT_SESSIONS_PATH: path.join(tmpRoot, 'local-checkout-sessions.json'),
  _TEST_TRIAL_EMAIL_LEDGER_PATH: path.join(tmpRoot, 'trial-emails.jsonl'),
  THUMBGATE_FEEDBACK_DIR: feedbackDir,
  THUMBGATE_API_KEY: 'tg_test_abandonment_fix_key',
  THUMBGATE_PUBLIC_APP_ORIGIN: 'https://thumbgate.ai',
  THUMBGATE_PLAUSIBLE_DISABLE: '1',
  STRIPE_SECRET_KEY: 'sk_test_mock_abandonment_fix',
};

for (const [k, v] of Object.entries(TEST_ENV)) {
  savedEnv[k] = process.env[k];
  process.env[k] = v;
}

const createdStripePayloads = [];
let forceNextStripeError = null;

class MockStripe {
  constructor() {
    this.products = {
      list: async () => ({
        data: [{ id: 'prod_pro_active', name: 'ThumbGate Pro', active: true }],
      }),
    };
    this.checkout = {
      sessions: {
        create: async (payload) => {
          createdStripePayloads.push(payload);
          if (forceNextStripeError) {
            const err = forceNextStripeError;
            forceNextStripeError = null;
            throw err;
          }
          const idx = createdStripePayloads.length;
          return {
            id: `cs_test_fix_${idx}`,
            url: `https://checkout.stripe.com/c/pay/cs_test_fix_${idx}`,
          };
        },
      },
    };
  }
}

const stripeResolvedPath = require.resolve('stripe');
const originalStripeCache = require.cache[stripeResolvedPath];
require.cache[stripeResolvedPath] = {
  id: stripeResolvedPath,
  filename: stripeResolvedPath,
  loaded: true,
  exports: MockStripe,
};

const billing = require('../scripts/billing');
const { startServer } = require('../src/api/server');

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

function rawBrowserGet(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    http
      .get(
        url,
        {
          headers: {
            'user-agent': BROWSER_UA,
            accept: BROWSER_ACCEPT,
            'sec-fetch-mode': 'navigate',
            'sec-fetch-dest': 'document',
            ...extraHeaders,
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            resolve({
              status: res.statusCode,
              location: res.headers.location || '',
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      )
      .on('error', reject);
  });
}

describe('Stripe checkout conversion & Payment Link / Annual routing fixes', () => {
  let handle;
  let origin = '';

  before(async () => {
    handle = await startServer({ port: 0, host: '127.0.0.1' });
    origin = `http://127.0.0.1:${handle.port}`;
  });

  after(async () => {
    if (handle) handle.server.close();
    if (originalStripeCache) require.cache[stripeResolvedPath] = originalStripeCache;
    else delete require.cache[stripeResolvedPath];
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('populates real Pro value differentiators and refund assurance on Stripe Checkout line items', () => {
    const monthlyPayload = billing._buildCheckoutSessionPayload({
      successUrl: 'https://thumbgate.ai/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://thumbgate.ai/cancel',
      customerEmail: 'dev@acme.io',
      checkoutMetadata: { planId: 'pro', billingCycle: 'monthly', traceId: 'tr_monthly' },
    });
    assert.match(monthlyPayload.line_items[0].price_data.product_data.description, /Unlimited learned gates/);
    assert.match(monthlyPayload.line_items[0].price_data.product_data.description, /instant Pro API key/);
    assert.match(monthlyPayload.line_items[0].price_data.product_data.description, /7-day refund/);

    const annualPayload = billing._buildCheckoutSessionPayload({
      successUrl: 'https://thumbgate.ai/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://thumbgate.ai/cancel',
      checkoutMetadata: { planId: 'pro', billingCycle: 'annual', traceId: 'tr_annual' },
    });
    assert.equal(annualPayload.line_items[0].price_data.unit_amount, 14900);
    assert.equal(annualPayload.line_items[0].price_data.recurring.interval, 'year');
    assert.match(annualPayload.line_items[0].price_data.product_data.description, /Annual Pro \(save \$79\/yr\)/);

    const teamPayload = billing._buildCheckoutSessionPayload({
      successUrl: 'https://thumbgate.ai/success',
      cancelUrl: 'https://thumbgate.ai/cancel',
      checkoutMetadata: { planId: 'team', billingCycle: 'monthly', traceId: 'tr_team' },
    });
    assert.match(teamPayload.line_items[0].price_data.product_data.description, /Shared Pre-Action Checks/);
  });

  it('creates dynamic $19/mo and $149/yr Stripe Checkout Sessions with /success and /cancel URLs on human /go/pro-direct and /go/pro-annual', async () => {
    const startIdx = createdStripePayloads.length;

    const monthlyRes = await rawBrowserGet(
      `${origin}/go/pro-direct?utm_source=homepage&prefilled_email=buyer%40acme.io`,
    );
    assert.equal(monthlyRes.status, 302);
    assert.match(monthlyRes.location, /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_fix_/);
    const monthlyCreated = createdStripePayloads[startIdx];
    assert.equal(monthlyCreated.line_items[0].price_data.unit_amount, 1900);
    assert.equal(monthlyCreated.line_items[0].price_data.recurring.interval, 'month');
    assert.equal(monthlyCreated.customer_email, 'buyer@acme.io');
    assert.match(monthlyCreated.success_url, /\/success\?session_id=\{CHECKOUT_SESSION_ID\}/);
    assert.match(monthlyCreated.cancel_url, /\/cancel\?/);

    const annualRes = await rawBrowserGet(`${origin}/go/pro-annual?utm_source=pricing`);
    assert.equal(annualRes.status, 302);
    assert.match(annualRes.location, /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_fix_/);
    const annualCreated = createdStripePayloads[startIdx + 1];
    assert.equal(annualCreated.line_items[0].price_data.unit_amount, 14900);
    assert.equal(annualCreated.line_items[0].price_data.recurring.interval, 'year');

    const annualQueryRes = await rawBrowserGet(`${origin}/go/pro-direct?plan_id=pro&billing_cycle=annual`);
    assert.equal(annualQueryRes.status, 302);
    assert.equal(annualCreated.metadata.utmCampaign, 'pro_annual_149');
    assert.equal(annualCreated.metadata.ctaId, 'pro_checkout_annual_stripe');
    assert.equal(createdStripePayloads[startIdx + 2].line_items[0].price_data.unit_amount, 14900);
    assert.equal(createdStripePayloads[startIdx + 2].line_items[0].price_data.recurring.interval, 'year');

    const beforeProbe = createdStripePayloads.length;
    const probeRes = await rawBrowserGet(`${origin}/go/pro-direct?probe=1`);
    assert.equal(probeRes.status, 302);
    assert.equal(createdStripePayloads.length, beforeProbe, 'probe=1 must not mint a dynamic Stripe session');

    forceNextStripeError = new Error('Stripe network down');
    const fallbackRes = await rawBrowserGet(`${origin}/go/pro-direct`);
    assert.equal(fallbackRes.status, 302);
    assert.match(fallbackRes.location, /^https:\/\/buy\.stripe\.com\//);
  });

  it('renders annual $149/yr view on /checkout/pro?billing_cycle=annual and routes /pricing Pro CTAs to 1-click /go/pro-direct', async () => {
    const annualIntent = await rawBrowserGet(`${origin}/checkout/pro?plan_id=pro&billing_cycle=annual`);
    assert.equal(annualIntent.status, 200);
    assert.match(annualIntent.body, /Start ThumbGate Pro Annual/);
    assert.match(annualIntent.body, /\$149<small>\/yr<\/small>/);
    assert.match(annualIntent.body, /Pay \$149\/yr with Stripe/);
    assert.match(annualIntent.body, /\/go\/pro-annual\?/);
    assert.match(annualIntent.body, /<details class="objection-box"/);

    const pricingHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'pricing.html'), 'utf8');
    assert.match(pricingHtml, /href="\/go\/pro-direct\?[^"]*"[^>]*>Start Pro<\/a>/);
    assert.match(pricingHtml, /href="\/go\/pro-direct\?[^"]*"[^>]*>Choose Pro<\/a>/);
    assert.match(pricingHtml, /href="\/go\/pro-annual\?/);
  });
});
