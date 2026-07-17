'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_STRIPE_REVENUE_CATALOG,
} = require('../scripts/stripe-revenue-catalog');
const {
  DEFAULT_STRIPE_PUBLIC_PAYMENT_RAILS,
  canonicalPaymentLinkUrl,
  validatePublicPaymentRails,
  buildStripeRevenueCatalogAudit,
  runAudit,
  renderMarkdown,
} = require('../scripts/stripe-revenue-catalog-audit');

const NOW = '2026-07-16T20:30:00.000Z';

function stripePrice(entry, overrides = {}) {
  return {
    id: entry.priceId,
    unit_amount: entry.unitAmountCents,
    currency: entry.currency,
    recurring: entry.cadence === 'one_time'
      ? null
      : { interval: entry.cadence, interval_count: entry.intervalCount },
    active: entry.expectedPriceActive,
    livemode: true,
    product: {
      id: entry.productId,
      name: `Product for ${entry.offerId}`,
      active: entry.expectedProductActive,
    },
    ...overrides,
  };
}

function fakeStripe({ priceOverrides = {}, linkOverrides = {} } = {}) {
  const prices = Object.fromEntries(DEFAULT_STRIPE_REVENUE_CATALOG.map((entry) => [
    entry.priceId,
    stripePrice(entry, priceOverrides[entry.priceId]),
  ]));
  const links = Object.fromEntries(DEFAULT_STRIPE_PUBLIC_PAYMENT_RAILS.map((rail) => {
    const entry = DEFAULT_STRIPE_REVENUE_CATALOG.find((candidate) => candidate.priceId === rail.priceId);
    return [rail.paymentLinkId, {
      id: rail.paymentLinkId,
      url: rail.url,
      active: rail.expectedActive,
      livemode: true,
      line_items: { data: [{ price: stripePrice(entry, priceOverrides[entry.priceId]) }] },
      ...linkOverrides[rail.paymentLinkId],
    }];
  }));
  return {
    prices: {
      async retrieve(id) {
        if (!prices[id]) throw new Error('not found');
        return prices[id];
      },
    },
    paymentLinks: {
      async retrieve(id) {
        if (!links[id]) throw new Error('not found');
        return links[id];
      },
    },
  };
}

test('live catalog audit verifies every exact offer and public checkout rail', async () => {
  const report = await buildStripeRevenueCatalogAudit({ stripe: fakeStripe(), generatedAt: NOW });

  assert.equal(report.verified, true);
  assert.deepEqual(report.gaps, []);
  assert.equal(report.summary.expectedOfferCount, 4);
  assert.equal(report.summary.verifiedOfferCount, 4);
  assert.equal(report.summary.priceDriftCount, 0);
  assert.equal(report.summary.expectedPublicPaymentRailCount, 2);
  assert.equal(report.summary.verifiedPublicPaymentRailCount, 2);
  assert.equal(report.summary.paymentRailDriftCount, 0);
  const legacy = report.offers.find((offer) => offer.offerId === 'team_monthly_legacy');
  assert.equal(legacy.observedPriceActive, true);
  assert.equal(legacy.observedProductActive, false);
});

test('known live price term drift fails the catalog and its public payment rail', async () => {
  const diagnostic = DEFAULT_STRIPE_REVENUE_CATALOG.find((entry) => entry.offerId === 'workflow_hardening_diagnostic');
  const report = await buildStripeRevenueCatalogAudit({
    stripe: fakeStripe({ priceOverrides: { [diagnostic.priceId]: { unit_amount: 99900 } } }),
    generatedAt: NOW,
  });

  assert.equal(report.verified, false);
  assert.equal(report.summary.priceDriftCount, 1);
  assert.equal(report.summary.paymentRailDriftCount, 1);
  assert.match(report.gaps.join('\n'), /catalog_terms_mismatch|payment_link_offer_mismatch/);
});

test('archived product-state drift fails even when immutable price terms still match', async () => {
  const legacy = DEFAULT_STRIPE_REVENUE_CATALOG.find((entry) => entry.offerId === 'team_monthly_legacy');
  const report = await buildStripeRevenueCatalogAudit({
    stripe: fakeStripe({
      priceOverrides: {
        [legacy.priceId]: {
          product: { id: legacy.productId, name: 'Legacy Team', active: true },
        },
      },
    }),
    generatedAt: NOW,
  });

  assert.equal(report.verified, false);
  assert.equal(report.summary.priceDriftCount, 1);
  assert.match(report.gaps.join('\n'), /product_active_state_mismatch/);
});

test('current offer price active-state drift fails independently of public-link state', async () => {
  const pro = DEFAULT_STRIPE_REVENUE_CATALOG.find((entry) => entry.offerId === 'pro_monthly');
  const report = await buildStripeRevenueCatalogAudit({
    stripe: fakeStripe({ priceOverrides: { [pro.priceId]: { active: false } } }),
    generatedAt: NOW,
  });

  assert.equal(report.verified, false);
  assert.equal(report.summary.priceDriftCount, 1);
  assert.match(report.gaps.join('\n'), /price_active_state_mismatch/);
});

test('payment link URL, active state, mode, and single-offer mapping are all fail closed', async () => {
  const rail = DEFAULT_STRIPE_PUBLIC_PAYMENT_RAILS[0];
  const cases = [
    { url: 'https://buy.stripe.com/wrong' },
    { active: false },
    { livemode: false },
    { line_items: { data: [] } },
  ];
  for (const override of cases) {
    const report = await buildStripeRevenueCatalogAudit({
      stripe: fakeStripe({ linkOverrides: { [rail.paymentLinkId]: override } }),
      generatedAt: NOW,
    });
    assert.equal(report.verified, false);
    assert.equal(report.summary.paymentRailDriftCount, 1);
  }
});

test('provider retrieval failures stay explicit without reflecting provider errors', async () => {
  const stripe = fakeStripe();
  stripe.prices.retrieve = async () => { throw new Error('secret provider response'); };
  const report = await buildStripeRevenueCatalogAudit({ stripe, generatedAt: NOW });

  assert.equal(report.verified, false);
  assert.equal(report.summary.priceDriftCount, 4);
  assert.doesNotMatch(JSON.stringify(report), /secret provider response/);
});

test('invalid catalog and unavailable credentials fail even with no payment activity', async () => {
  const invalid = await buildStripeRevenueCatalogAudit({
    stripe: fakeStripe(),
    catalog: [],
    generatedAt: NOW,
  });
  assert.equal(invalid.verified, false);
  assert.match(invalid.gaps.join('\n'), /catalog/i);

  const unconfigured = await runAudit({ env: {}, secretPaths: [], generatedAt: NOW });
  assert.equal(unconfigured.configured, false);
  assert.equal(unconfigured.verified, false);
  assert.match(unconfigured.gaps.join('\n'), /credential/i);
});

test('public Payment Link validation rejects lookalike hosts and inconsistent offer bindings', () => {
  assert.equal(canonicalPaymentLinkUrl('https://buy.stripe.com/example?utm_source=test'), 'https://buy.stripe.com/example');
  assert.equal(canonicalPaymentLinkUrl('https://buy.stripe.com.evil.test/example'), null);
  assert.equal(canonicalPaymentLinkUrl('http://buy.stripe.com/example'), null);
  const credentialedUrl = ['https://buyer', ':', 'example', '@buy.stripe.com/example'].join('');
  assert.equal(canonicalPaymentLinkUrl(credentialedUrl), null);
  assert.deepEqual(validatePublicPaymentRails(), { ok: true, gap: null });

  const inconsistent = [{
    ...DEFAULT_STRIPE_PUBLIC_PAYMENT_RAILS[0],
    priceId: DEFAULT_STRIPE_REVENUE_CATALOG[1].priceId,
  }];
  assert.equal(validatePublicPaymentRails(inconsistent).ok, false);
});

test('Markdown rendering reports only aggregate verification counts and gaps', async () => {
  const report = await buildStripeRevenueCatalogAudit({ stripe: fakeStripe(), generatedAt: NOW });
  const markdown = renderMarkdown(report);

  assert.match(markdown, /Status: VERIFIED/);
  assert.match(markdown, /Exact live offers: 4\/4/);
  assert.match(markdown, /Exact public payment rails: 2\/2/);
  assert.doesNotMatch(markdown, /sk_live|secret/i);
});
