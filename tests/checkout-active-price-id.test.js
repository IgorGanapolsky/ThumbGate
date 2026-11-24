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

async function open(stripe) {
  billing._setStripeClient(stripe);
  await billing.createCheckoutSession({
    successUrl: 'https://thumbgate.ai/success?session_id={CHECKOUT_SESSION_ID}',
    cancelUrl: 'https://thumbgate.ai/cancel',
    customerEmail: 'buyer@example.org',
    installId: 'inst_test',
    appOrigin: 'https://thumbgate.ai',
    humanClick: { admitted: true },
    metadata: { planId: 'pro', billingCycle: 'monthly' },
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
