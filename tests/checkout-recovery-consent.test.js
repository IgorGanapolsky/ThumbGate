'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  _buildCheckoutSessionPayload: buildCheckoutSessionPayload,
  _createSessionDroppingRejectedOptionals: createSessionDroppingRejectedOptionals,
} = require('../scripts/billing');

function fakeStripe(rejectWhilePresent) {
  const calls = [];
  return {
    calls,
    checkout: {
      sessions: {
        async create(payload) {
          calls.push(Object.keys(payload));
          const field = rejectWhilePresent.find((f) => f in payload);
          if (field) throw new Error(`To set \`${field}.promotions\`, please visit the Dashboard`);
          return { id: 'cs_test_fake', url: 'https://checkout.stripe.com/c/pay/cs_test_fake' };
        },
      },
    },
  };
}

test('checkout still opens when Stripe refuses consent_collection (terms not accepted yet)', async () => {
  const stripe = fakeStripe(['consent_collection']);
  const session = await createSessionDroppingRejectedOptionals(stripe, {
    mode: 'subscription', consent_collection: { promotions: 'auto' }, branding_settings: {},
  });
  assert.equal(session.id, 'cs_test_fake');
  assert.equal(stripe.calls.length, 2);
  assert.ok(!stripe.calls[1].includes('consent_collection'));
  assert.ok(stripe.calls[1].includes('branding_settings'));
});

test('checkout drops both optional fields when both are refused', async () => {
  const stripe = fakeStripe(['branding_settings', 'consent_collection']);
  const session = await createSessionDroppingRejectedOptionals(stripe, {
    mode: 'subscription', consent_collection: {}, branding_settings: {},
  });
  assert.equal(session.id, 'cs_test_fake');
  assert.equal(stripe.calls.length, 3);
});

test('unrelated Stripe errors still surface', async () => {
  const stripe = { checkout: { sessions: { async create() { throw new Error('No such price'); } } } };
  await assert.rejects(createSessionDroppingRejectedOptionals(stripe, { consent_collection: {} }), /No such price/);
});
const { isHumanCheckoutNavigation } = require('../scripts/bot-detection');

test('checkout payload collects promotional consent so Stripe can send recovery emails', () => {
  const payload = buildCheckoutSessionPayload({
    successUrl: 'https://thumbgate.ai/success',
    cancelUrl: 'https://thumbgate.ai/cancel',
    checkoutMetadata: { planId: 'cloud_indie', billingCycle: 'monthly' },
    appOrigin: 'https://thumbgate.ai',
  });
  assert.equal(payload.after_expiration.recovery.enabled, true);
  assert.deepEqual(payload.consent_collection, { promotions: 'auto' });
});

test('isHumanCheckoutNavigation accepts top-level browser clicks only', () => {
  const origin = 'https://thumbgate.ai';
  assert.equal(isHumanCheckoutNavigation({ 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }, origin), true);
  assert.equal(isHumanCheckoutNavigation({ 'sec-fetch-mode': 'navigate' }, origin), true);
  assert.equal(isHumanCheckoutNavigation({ 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' }, origin), false);
  assert.equal(isHumanCheckoutNavigation({ 'sec-fetch-mode': 'no-cors' }, origin), false);
  assert.equal(isHumanCheckoutNavigation({}, origin), false);
  assert.equal(isHumanCheckoutNavigation({ referer: 'https://thumbgate.ai/pricing' }, origin), true);
  assert.equal(isHumanCheckoutNavigation({ referer: 'https://evil.example/x' }, origin), false);
  assert.equal(isHumanCheckoutNavigation({ referer: 'not a url' }, origin), false);
});
