'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  revenueCredibleRange,
  buildPredictiveInsights,
} = require('../scripts/predictive-insights');

test('revenueCredibleRange: low <= expected <= high (rate and cents)', () => {
  const r = revenueCredibleRange({ successes: 3, trials: 40, revenuePerPaidCents: 1900 });
  assert.ok(r.rateLo <= r.rateExpected && r.rateExpected <= r.rateHi, 'rate ordered');
  assert.ok(r.lowCents <= r.expectedCents && r.expectedCents <= r.highCents, 'cents ordered');
  assert.ok(r.confidence >= 0 && r.confidence <= 1, 'confidence in [0,1]');
});

test('revenueCredibleRange: more data -> narrower interval + higher confidence', () => {
  const sparse = revenueCredibleRange({ successes: 1, trials: 5, revenuePerPaidCents: 1900 });
  const rich = revenueCredibleRange({ successes: 200, trials: 1000, revenuePerPaidCents: 1900 });
  const width = (x) => x.rateHi - x.rateLo;
  assert.ok(width(rich) < width(sparse), 'interval tightens with N');
  assert.ok(rich.confidence > sparse.confidence, 'confidence rises with N');
});

test('revenueCredibleRange: zero trials yields a zeroed, non-throwing result', () => {
  const r = revenueCredibleRange({ successes: 0, trials: 0, revenuePerPaidCents: 1900 });
  assert.equal(r.trials, 0);
  assert.equal(r.lowCents, 0);
  assert.equal(r.highCents, 0);
  assert.equal(r.confidence, 0);
});

test('revenueCredibleRange: never exceeds the all-convert ceiling', () => {
  const r = revenueCredibleRange({ successes: 10, trials: 20, revenuePerPaidCents: 1900 });
  assert.ok(r.highCents <= 20 * 1900, 'high bound cannot exceed trials * revenuePerPaid');
});

test('buildPredictiveInsights: adds a credible revenue range without changing the point forecast', () => {
  const input = {
    telemetryAnalytics: { visitors: { uniqueVisitors: 800 }, ctas: { checkoutStarts: 60 } },
    billingSummary: { signups: { uniqueLeads: 30 }, revenue: { paidCustomers: 6, bookedRevenueCents: 11400 } },
  };
  const insights = buildPredictiveInsights(input);
  const rf = insights.revenueForecast;

  // Backward-compatible fields still present + unchanged in shape.
  assert.equal(typeof rf.predictedBookedRevenueCents, 'number');
  assert.ok(rf.predictedBookedRevenueCents >= 0);

  // New principled fields.
  assert.ok(rf.range && typeof rf.range.expectedCents === 'number', 'range present');
  assert.ok(rf.range.lowCents <= rf.range.expectedCents && rf.range.expectedCents <= rf.range.highCents, 'range ordered');
  assert.ok(rf.rateCredibleInterval && rf.rateCredibleInterval.basis === 'checkout_to_paid', 'uses checkout signal when present');
  assert.equal(rf.rateCredibleInterval.sampleSize, 60);
  assert.ok(rf.statisticalConfidence >= 0 && rf.statisticalConfidence <= 1);
});
