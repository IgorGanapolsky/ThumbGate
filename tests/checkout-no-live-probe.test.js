'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const billing = require('../scripts/billing');

test('probe and audit requests are recognised as automated', () => {
  assert.equal(billing.isAutomatedCheckoutRequest({ source: 'internal_audit' }), true);
  assert.equal(billing.isAutomatedCheckoutRequest({ installId: 'consent_probe' }), true);
  assert.equal(billing.isAutomatedCheckoutRequest({ installId: 'probe_2026' }), true);
  assert.equal(billing.isAutomatedCheckoutRequest({ source: 'health_check' }), true);
});

test('visitor checkouts are not treated as automated', () => {
  assert.equal(billing.isAutomatedCheckoutRequest({ installId: 'unknown', utmMedium: 'cta_button' }), false);
  assert.equal(billing.isAutomatedCheckoutRequest({ installId: 'inst_8f2a' }), false);
  assert.equal(billing.isAutomatedCheckoutRequest({}), false);
});

// Production runs on a restricted key (rk_live_); an sk_live_-only check let a probe through on 2026-11-11.
for (const prefix of ['sk_live_', 'rk_live_']) test(`a probe never reaches Stripe with a ${prefix} key`, async () => {
  const savedKey = billing.CONFIG.STRIPE_SECRET_KEY;
  billing.CONFIG.STRIPE_SECRET_KEY = `${prefix}placeholder_not_a_real_key`;
  try {
    await assert.rejects(
      billing.createCheckoutSession({
        successUrl: 'https://thumbgate.ai/success',
        cancelUrl: 'https://thumbgate.ai/cancel',
        customerEmail: 'probe@example.com',
        installId: 'consent_probe',
        metadata: { source: 'internal_audit', planId: 'pro', billingCycle: 'monthly' },
      }),
      /Refusing to open a live Stripe Checkout session/,
    );
  } finally {
    billing.CONFIG.STRIPE_SECRET_KEY = savedKey;
  }
});
