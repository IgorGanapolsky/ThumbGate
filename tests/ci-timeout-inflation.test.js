'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeTimeoutInflation,
  shouldFlagPassOnRetry,
} = require('../scripts/ci-timeout-inflation');

test('analyzeTimeoutInflation flags TIMED_OUT and long failing jobs', () => {
  const report = analyzeTimeoutInflation([
    { name: 'unit', conclusion: 'SUCCESS' },
    { name: 'e2e', conclusion: 'TIMED_OUT' },
    { name: 'slow-suite', bucket: 'fail', durationMs: 20 * 60 * 1000 },
  ], { minDurationMs: 10 * 60 * 1000 });
  assert.equal(report.ok, false);
  assert.equal(report.suspectCount, 2);
  assert.ok(report.suspects.some((s) => s.name === 'e2e'));
  assert.ok(report.suspects.some((s) => s.name === 'slow-suite'));
});

test('shouldFlagPassOnRetry respects minRetries', () => {
  assert.equal(shouldFlagPassOnRetry({ failureCount: 1, laterPassed: true, minRetries: 2 }), false);
  assert.equal(shouldFlagPassOnRetry({ failureCount: 2, laterPassed: true, minRetries: 2 }), true);
  assert.equal(shouldFlagPassOnRetry({ failureCount: 5, laterPassed: false, minRetries: 2 }), false);
});
