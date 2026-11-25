'use strict';

/**
 * Checkout must charge the configured, ACTIVE Stripe price, and refuse to open a
 * session when that price is inactive or does not match the page. Before this fix
 * every subscription session was built from inline price_data, so Stripe created a
 * new ad hoc price (and product data) per session while the metadata named the
 * configured price. Buyers were charged the right dollar amount; the fix is about
 * consistency, so archived prices and duplicate products stop growing. A fake
 * Stripe client is used; no network, no live key.
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


async function rejects(stripe, metadata, pattern) {
  const lines = [];
  const orig = console.error;
  console.error = (...a) => lines.push(a.join(' '));
  try {
    await assert.rejects(() => open(stripe, metadata), (err) => {
      assert.equal(err.code, 'STRIPE_PRICE_MISCONFIGURED');
      assert.match(err.message, pattern);
      return true;
    });
  } finally {
    console.error = orig;
  }
  assert.equal(stripe.created.length, 0, 'no Stripe session may be created');
  return lines;
}

test('an inactive configured price refuses checkout and names the env var', async () => {
  const lines = await rejects(fakeStripe({ price: { ...activeMonthly(), active: false } }), undefined, /STRIPE_PRICE_ID_PRO_MONTHLY.*inactive/);
  assert.ok(lines.some((l) => /inactive/.test(l)));
});

test('a price whose amount differs from the page price refuses checkout', async () => {
  await rejects(fakeStripe({ price: { ...activeMonthly(), unit_amount: 2900 } }), undefined, /charges 2900 cents, page shows 1900/);
});

test('a price whose interval differs refuses checkout', async () => {
  await rejects(fakeStripe({ price: { ...activeMonthly(), recurring: { interval: 'year' } } }), undefined, /bills every year, expected month/);
});

test('a price billed every 3 months is not accepted as monthly (interval_count)', async () => {
  await rejects(fakeStripe({ price: { ...activeMonthly(), recurring: { interval: 'month', interval_count: 3 } } }), undefined, /every 3 months/);
});

test('a non-USD price refuses checkout', async () => {
  await rejects(fakeStripe({ price: { ...activeMonthly(), currency: 'eur' } }), undefined, /is not USD/);
});

test('a Stripe lookup error refuses checkout instead of creating an ad hoc price', async () => {
  await rejects(fakeStripe({ priceError: new Error('no such price') }), undefined, /lookup failed \(no such price\)/);
});

test('session metadata names the same configured price the line item charges', async () => {
  const payload = await open(fakeStripe({ price: activeMonthly() }));
  assert.equal(payload.metadata.priceId, billing.CONFIG.STRIPE_PRICE_ID_PRO_MONTHLY);
  assert.equal(payload.line_items[0].price, payload.metadata.priceId);
});

test('annual: active matching price is charged by id; wrong interval refuses and names ANNUAL', async () => {
  const meta = { planId: 'pro', billingCycle: 'annual' };
  const id = billing.CONFIG.STRIPE_PRICE_ID_PRO_ANNUAL;
  const good = { id, active: true, currency: 'usd', unit_amount: 14900, recurring: { interval: 'year', interval_count: 1 } };
  const ok = await open(fakeStripe({ price: good }), meta);
  assert.equal(ok.line_items[0].price, id);
  await rejects(fakeStripe({ price: { ...good, recurring: { interval: 'month' } } }), meta, /STRIPE_PRICE_ID_PRO_ANNUAL.*bills every month, expected year/);
});

test('team: active matching price is charged by id with the seat quantity; inactive refuses and names TEAM', async () => {
  const meta = { planId: 'team', seatCount: 3 };
  const id = billing.CONFIG.STRIPE_PRICE_ID_TEAM_MONTHLY;
  const unit = billing._buildCheckoutSessionPayload({ successUrl: 'https://thumbgate.ai/s', cancelUrl: 'https://thumbgate.ai/c', checkoutMetadata: meta, appOrigin: 'https://thumbgate.ai' }).line_items[0].price_data.unit_amount;
  const good = { id, active: true, currency: 'usd', unit_amount: unit, recurring: { interval: 'month', interval_count: 1 } };
  const ok = await open(fakeStripe({ price: good }), meta);
  assert.equal(ok.line_items[0].price, id);
  assert.equal(ok.line_items[0].quantity, 3);
  await rejects(fakeStripe({ price: { ...good, active: false } }), meta, /STRIPE_PRICE_ID_TEAM_MONTHLY.*inactive/);
});
