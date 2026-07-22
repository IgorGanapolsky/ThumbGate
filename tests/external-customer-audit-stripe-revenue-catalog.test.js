'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  STRIPE_REVENUE_CATALOG_VERSION,
  DEFAULT_STRIPE_REVENUE_CATALOG,
  inspectStripePrice,
  validateStripeRevenueCatalog,
  matchStripeRevenueCatalogPrice,
} = require('../scripts/stripe-revenue-catalog');

function diagnosticPrice(overrides = {}) {
  return {
    id: 'price_1TsO6kGGBpd520QYbbEgThb3',
    unit_amount: 49900,
    currency: 'usd',
    recurring: null,
    product: {
      id: 'prod_Us8Nf20z0bOb1g',
      name: 'Managed AI Agent Workflow Gate',
    },
    ...overrides,
  };
}

test('default catalog is versioned, valid, and unique by immutable Stripe price ID', () => {
  assert.equal(STRIPE_REVENUE_CATALOG_VERSION, 'thumbgate-stripe-revenue-catalog-v1');
  assert.deepEqual(validateStripeRevenueCatalog(DEFAULT_STRIPE_REVENUE_CATALOG), { ok: true, gap: null });
  assert.equal(new Set(DEFAULT_STRIPE_REVENUE_CATALOG.map((entry) => entry.priceId)).size, DEFAULT_STRIPE_REVENUE_CATALOG.length);
});

test('live $499 managed gate matches its immutable catalog identity', () => {
  const result = matchStripeRevenueCatalogPrice(diagnosticPrice());
  assert.equal(result.matched, true);
  assert.equal(result.complete, true);
  assert.equal(result.offerId, 'workflow_hardening_diagnostic');
  assert.equal(result.reason, 'exact_catalog_match');
});

test('the separate $999 price on the same diagnostic product is not ThumbGate revenue', () => {
  const result = matchStripeRevenueCatalogPrice(diagnosticPrice({
    id: 'price_1TtXwQGGBpd520QYUw8XB4W1',
    unit_amount: 99900,
  }));
  assert.equal(result.matched, false);
  assert.equal(result.complete, true);
  assert.equal(result.reason, 'price_not_in_catalog');
});

test('a ThumbGate-looking product name cannot substitute for an exact catalog identity', () => {
  const result = matchStripeRevenueCatalogPrice({
    id: 'price_unreviewed',
    unit_amount: 49900,
    currency: 'usd',
    product: { id: 'prod_unreviewed', name: 'ThumbGate Workflow Diagnostic' },
  });
  assert.equal(result.matched, false);
  assert.equal(result.reason, 'price_not_in_catalog');
});

test('known price ID fails closed when product, amount, currency, or cadence drifts', () => {
  const cases = [
    diagnosticPrice({ product: { id: 'prod_wrong', name: 'Managed AI Agent Workflow Gate' } }),
    diagnosticPrice({ unit_amount: 99900 }),
    diagnosticPrice({ currency: 'eur' }),
    diagnosticPrice({ recurring: { interval: 'month', interval_count: 1 } }),
  ];
  for (const price of cases) {
    const result = matchStripeRevenueCatalogPrice(price);
    assert.equal(result.matched, false);
    assert.equal(result.reason, 'catalog_terms_mismatch');
  }
});

test('current Pro monthly price matches with a string product reference', () => {
  const result = matchStripeRevenueCatalogPrice({
    id: 'price_1THQY7GGBpd520QYHoS7RG0J',
    unit_amount: 1900,
    currency: 'usd',
    recurring: { interval: 'month', interval_count: 1 },
    product: 'prod_UE7SR5NFBkumEp',
  });
  assert.equal(result.matched, true);
  assert.equal(result.offerId, 'pro_monthly');
});

test('incomplete Stripe expansion data is not treated as a known non-ThumbGate price', () => {
  const result = matchStripeRevenueCatalogPrice({
    id: 'price_1TsO6kGGBpd520QYbbEgThb3',
    product: 'prod_Us8Nf20z0bOb1g',
  });
  assert.equal(result.matched, false);
  assert.equal(result.complete, false);
  assert.equal(result.reason, 'price_identity_incomplete');
});

test('catalog validation rejects malformed and duplicate price identities', () => {
  assert.equal(validateStripeRevenueCatalog([]).ok, false);
  const duplicate = [DEFAULT_STRIPE_REVENUE_CATALOG[0], DEFAULT_STRIPE_REVENUE_CATALOG[0]];
  assert.equal(validateStripeRevenueCatalog(duplicate).ok, false);
  assert.match(validateStripeRevenueCatalog(duplicate).gap, /Duplicate/);
});

test('price inspection normalizes amount, currency, cadence, and product identity', () => {
  assert.deepEqual(inspectStripePrice({
    id: 'price_test',
    unit_amount: 1900,
    currency: 'USD',
    recurring: { interval: 'month', interval_count: 1 },
    product: { id: 'prod_test' },
  }), {
    priceId: 'price_test',
    productId: 'prod_test',
    unitAmountCents: 1900,
    currency: 'usd',
    cadence: 'month',
    intervalCount: 1,
  });
});
