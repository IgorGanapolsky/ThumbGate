const test = require('node:test');
const assert = require('node:assert/strict');

const { isNonFatalPostFailure } = require('../scripts/social-post-hourly');
const { ZernioQuotaError } = require('../scripts/social-analytics/publishers/zernio');

test('daily social poster treats Zernio quota exhaustion as a controlled skip', () => {
  const error = new ZernioQuotaError('Post limit reached', {
    billingPeriod: 'monthly',
    current: 120,
    limit: 120,
    planName: 'Build',
    status: 403,
  });

  assert.equal(isNonFatalPostFailure(error), true);
});

test('daily social poster still fails on non-quota publisher errors', () => {
  assert.equal(isNonFatalPostFailure(new Error('ZERNIO_API_KEY environment variable is required')), false);
  assert.equal(isNonFatalPostFailure(new Error('Zernio API 500 for POST /posts')), false);
});
