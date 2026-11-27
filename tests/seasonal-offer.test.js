'use strict';

/**
 * Black Friday 2026 offer: inside the window, Pro checkouts get the coupon
 * applied automatically (no code box, since Stripe refuses both); outside it,
 * and for credit packs, checkout is unchanged; a Stripe failure never blocks
 * checkout. Fake Stripe client only; no network, no live key.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-offer-'));
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

const IN_WINDOW = Date.parse('2026-11-28T15:00:00Z');
const AFTER_WINDOW = Date.parse('2026-12-02T05:00:01Z');
const BEFORE_WINDOW = Date.parse('2026-11-27T04:59:59Z');

function fakeStripe({ existingCoupon = null, couponError = null } = {}) {
  const created = [];
  const couponsCreated = [];
  return {
    created,
    couponsCreated,
    products: { list: async () => ({ data: [{ id: 'prod_x', name: 'ThumbGate Pro', active: true }] }) },
    prices: {
      retrieve: async () => ({ id: billing.CONFIG.STRIPE_PRICE_ID_PRO_MONTHLY, active: true, currency: 'usd', unit_amount: 1900, recurring: { interval: 'month' } }),
    },
    coupons: {
      retrieve: async () => {
        if (couponError) throw couponError;
        if (existingCoupon) return existingCoupon;
        const err = new Error('No such coupon'); err.statusCode = 404; err.code = 'resource_missing'; throw err;
      },
      create: async (params) => { couponsCreated.push(params); return { ...params, valid: true }; },
    },
    checkout: { sessions: { create: async (payload) => { created.push(payload); return { id: 'cs_test_1', url: 'https://example.invalid/pay' }; } } },
  };
}

async function open(stripe, nowMs, metadata = { planId: 'pro', billingCycle: 'monthly' }) {
  billing._resetSeasonalOfferForTests();
  billing._setStripeClient(stripe);
  await billing.createCheckoutSession({
    successUrl: 'https://thumbgate.ai/success?session_id={CHECKOUT_SESSION_ID}',
    cancelUrl: 'https://thumbgate.ai/cancel',
    customerEmail: 'buyer@example.org',
    installId: 'inst_test',
    appOrigin: 'https://thumbgate.ai',
    humanClick: { admitted: true },
    metadata,
    nowMs,
  });
  return stripe.created[0];
}

test('the window runs Friday 12:00 AM ET through Monday 11:59 PM ET', () => {
  assert.equal(billing._activeOffer(BEFORE_WINDOW), null);
  assert.equal(billing._activeOffer(IN_WINDOW).code, 'BLACKFRIDAY');
  assert.equal(billing._activeOffer(Date.parse('2026-12-02T04:59:59Z')).code, 'BLACKFRIDAY');
  assert.equal(billing._activeOffer(AFTER_WINDOW), null);
});

test('inside the window the coupon is created once and applied without a code box', async () => {
  const stripe = fakeStripe();
  const payload = await open(stripe, IN_WINDOW);
  assert.deepEqual(payload.discounts, [{ coupon: 'BLACKFRIDAY2026' }]);
  assert.equal(payload.allow_promotion_codes, undefined);
  assert.deepEqual(payload.after_expiration, { recovery: { enabled: true } });
  assert.equal(payload.metadata.offerCode, 'BLACKFRIDAY');
  assert.equal(stripe.couponsCreated.length, 1);
  const coupon = stripe.couponsCreated[0];
  assert.equal(coupon.percent_off, 40);
  assert.equal(coupon.duration, 'repeating');
  assert.equal(coupon.duration_in_months, 12);
  assert.equal(coupon.redeem_by, Math.floor(Date.parse('2026-12-02T04:59:59Z') / 1000));
});

test('an existing valid coupon is reused, not recreated', async () => {
  const stripe = fakeStripe({ existingCoupon: { id: 'BLACKFRIDAY2026', valid: true } });
  const payload = await open(stripe, IN_WINDOW);
  assert.deepEqual(payload.discounts, [{ coupon: 'BLACKFRIDAY2026' }]);
  assert.equal(stripe.couponsCreated.length, 0);
});

test('after the window checkout is unchanged and keeps the code box', async () => {
  const stripe = fakeStripe();
  const payload = await open(stripe, AFTER_WINDOW);
  assert.equal(payload.discounts, undefined);
  assert.equal(payload.allow_promotion_codes, true);
  assert.equal(stripe.couponsCreated.length, 0);
});

test('a Stripe coupon error never blocks checkout', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const stripe = fakeStripe({ couponError: Object.assign(new Error('boom'), { statusCode: 500 }) });
    const payload = await open(stripe, IN_WINDOW);
    assert.equal(payload.discounts, undefined);
    assert.equal(payload.allow_promotion_codes, true);
  } finally {
    console.warn = warn;
  }
});

test('an expired or invalid coupon falls back to full price', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const stripe = fakeStripe({ existingCoupon: { id: 'BLACKFRIDAY2026', valid: false } });
    const payload = await open(stripe, IN_WINDOW);
    assert.equal(payload.discounts, undefined);
    assert.equal(payload.allow_promotion_codes, true);
  } finally {
    console.warn = warn;
  }
});

test('credit packs never get the subscription offer', () => {
  const payload = billing._buildCheckoutSessionPayload({
    successUrl: 'https://thumbgate.ai/s', cancelUrl: 'https://thumbgate.ai/c',
    checkoutMetadata: { planId: 'credits' }, packId: Object.keys(billing.CONFIG.CREDIT_PACKS)[0],
    appOrigin: 'https://thumbgate.ai', discountCouponId: 'BLACKFRIDAY2026',
  });
  assert.equal(payload.discounts, undefined);
  assert.equal(payload.allow_promotion_codes, true);
});
