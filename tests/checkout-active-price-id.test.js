'use strict';

/**
 * Checkout must charge the configured, ACTIVE Stripe price when there is one.
 * Before this fix every Pro session was built from inline price_data, so Stripe
 * created a new ad hoc price per session (shown as inactive) while the session
 * metadata named the canonical active price. A fake Stripe client is used; no
 * network, no live key.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-price-'));
process.env._TEST_FUNNEL_LEDGER_PATH = path.join(tmp, 'funnel.jsonl');
process.env._TEST_REVENUE_LEDGER_PATH = path.join(tmp, 'revenue.jsonl');
process.env._TEST_API_KEYS_PATH = path.join(tmp, 'keys.json');

const billing = require('../scripts/billing');

const savedKey = billing.CONFIG.STRIPE_SECRET_KEY;
billing.CONFIG.STRIPE_SECRET_KEY = 'sk_test_fake_for_unit_test';

test.after(() => {
  billing.CONFIG.STRIPE_SECRET_KEY = savedKey;
  billing._setStripeClient(null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

function fakeStripe({ price, priceError } = {}) {
  const created = [];
  return {
    created,
    products: { list: async () => ({ data: [{ id: 'prod_x', name: 'ThumbGate Pro', active: true }] }) },
    prices: {
      retrieve: async () => {
        if (priceError) throw priceError;
        return price;
      },
    },
    checkout: { sessions: { create: async (payload) => { created.push(payload); return { id: 'cs_test_1', url: 'https://example.invalid/pay' }; } } },
  };
}

async function open(stripe, metadata = { planId: 'pro', billingCycle: 'monthly' }) {
  billing._setStripeClient(stripe);
  await billing.createCheckoutSession({
    successUrl: 'https://thumbgate.ai/success?session_id={CHECKOUT_SESSION_ID}',
    cancelUrl: 'https://thumbgate.ai/cancel',
    customerEmail: 'buyer@example.org',
    installId: 'inst_test',
    appOrigin: 'https://thumbgate.ai',
    humanClick: { admitted: true },
    metadata,
  });
  return stripe.created[0];
}

const activeMonthly = () => ({ id: billing.CONFIG.STRIPE_PRICE_ID_PRO_MONTHLY, active: true, currency: 'usd', unit_amount: 1900, recurring: { interval: 'month' } });

test('an active matching price is charged by id, not as an inline ad hoc price', async () => {
  const payload = await open(fakeStripe({ price: activeMonthly() }));
  assert.equal(payload.line_items[0].price, billing.CONFIG.STRIPE_PRICE_ID_PRO_MONTHLY);
  assert.equal(payload.line_items[0].price_data, undefined);
  assert.equal(payload.line_items[0].quantity, 1);
});

test('an inactive configured price falls back to inline price_data so checkout still opens', async () => {
  const payload = await open(fakeStripe({ price: { ...activeMonthly(), active: false } }));
  assert.equal(payload.line_items[0].price, undefined);
  assert.equal(payload.line_items[0].price_data.unit_amount, 1900);
});

test('a price whose amount differs from the page price falls back to price_data', async () => {
  const payload = await open(fakeStripe({ price: { ...activeMonthly(), unit_amount: 2900 } }));
  assert.equal(payload.line_items[0].price, undefined);
  assert.equal(payload.line_items[0].price_data.unit_amount, 1900);
});

test('a price whose interval differs falls back to price_data', async () => {
  const payload = await open(fakeStripe({ price: { ...activeMonthly(), recurring: { interval: 'year' } } }));
  assert.equal(payload.line_items[0].price, undefined);
});

test('a Stripe lookup error falls back to price_data', async () => {
  const payload = await open(fakeStripe({ priceError: new Error('no such price') }));
  assert.equal(payload.line_items[0].price, undefined);
  assert.equal(payload.line_items[0].price_data.unit_amount, 1900);
});

test('session metadata still names the configured price id', async () => {
  const payload = await open(fakeStripe({ price: activeMonthly() }));
  assert.equal(payload.metadata.priceId, billing.CONFIG.STRIPE_PRICE_ID_PRO_MONTHLY);
});

function captureErrors(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...a) => lines.push(a.join(' '));
  return fn().then((r) => { console.error = orig; return { r, lines }; }, (e) => { console.error = orig; throw e; });
}

test('a price billed every 3 months is not accepted as monthly (interval_count)', async () => {
  const { r, lines } = await captureErrors(() => open(fakeStripe({ price: { ...activeMonthly(), recurring: { interval: 'month', interval_count: 3 } } })));
  assert.equal(r.line_items[0].price, undefined);
  assert.ok(lines.some((l) => /every 3 months/.test(l)));
});

test('fallback is loud: names the env var and the reason, and metadata records inline_price_data', async () => {
  const { r, lines } = await captureErrors(() => open(fakeStripe({ price: { ...activeMonthly(), active: false } })));
  assert.ok(lines.some((l) => /STRIPE_PRICE_ID_PRO_MONTHLY/.test(l) && /inactive/.test(l)));
  assert.equal(r.metadata.priceSource, 'inline_price_data');
});

test('the configured path records priceSource=configured_price_id and logs nothing', async () => {
  const { r, lines } = await captureErrors(() => open(fakeStripe({ price: activeMonthly() })));
  assert.equal(r.metadata.priceSource, 'configured_price_id');
  assert.equal(lines.length, 0);
});

test('annual: active matching price is charged by id; wrong interval falls back and names ANNUAL', async () => {
  const meta = { planId: 'pro', billingCycle: 'annual' };
  const id = billing.CONFIG.STRIPE_PRICE_ID_PRO_ANNUAL;
  const good = { id, active: true, currency: 'usd', unit_amount: 14900, recurring: { interval: 'year', interval_count: 1 } };
  const ok = await open(fakeStripe({ price: good }), meta);
  assert.equal(ok.line_items[0].price, id);
  const { r, lines } = await captureErrors(() => open(fakeStripe({ price: { ...good, recurring: { interval: 'month' } } }), meta));
  assert.equal(r.line_items[0].price, undefined);
  assert.equal(r.line_items[0].price_data.unit_amount, 14900);
  assert.ok(lines.some((l) => /STRIPE_PRICE_ID_PRO_ANNUAL/.test(l)));
});

test('team: active matching price is charged by id with the seat quantity; inactive falls back and names TEAM', async () => {
  const meta = { planId: 'team', seatCount: 3 };
  const id = billing.CONFIG.STRIPE_PRICE_ID_TEAM_MONTHLY;
  const unit = billing._buildCheckoutSessionPayload({ successUrl: 'https://thumbgate.ai/s', cancelUrl: 'https://thumbgate.ai/c', checkoutMetadata: meta, appOrigin: 'https://thumbgate.ai' }).line_items[0].price_data.unit_amount;
  const good = { id, active: true, currency: 'usd', unit_amount: unit, recurring: { interval: 'month', interval_count: 1 } };
  const ok = await open(fakeStripe({ price: good }), meta);
  assert.equal(ok.line_items[0].price, id);
  assert.equal(ok.line_items[0].quantity, 3);
  const { r, lines } = await captureErrors(() => open(fakeStripe({ price: { ...good, active: false } }), meta));
  assert.equal(r.line_items[0].price, undefined);
  assert.ok(lines.some((l) => /STRIPE_PRICE_ID_TEAM_MONTHLY/.test(l)));
});
