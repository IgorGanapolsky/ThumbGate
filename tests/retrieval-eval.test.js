'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_CASES,
  DEFAULT_LESSONS,
  assertRetrievalEval,
  formatReport,
  rankOf,
  runRetrievalEval,
  scoreCases,
} = require('../scripts/retrieval-eval');

test('retrieval eval fixtures cover the trust-critical failure modes', () => {
  assert.deepEqual(DEFAULT_CASES.map((testCase) => testCase.id), [
    'revenue_truth_operator_transactions',
    'secret_browser_request',
    'social_publish_auth_blocker',
    'pending_pr_completion_claim',
  ]);
  assert.ok(DEFAULT_LESSONS.some((lesson) => lesson.id === 'lesson-revenue-customer-provenance'));
  assert.ok(DEFAULT_LESSONS.some((lesson) => /Verified customer revenue is \$0/.test(lesson.content)));
});

test('runRetrievalEval ranks every critical lesson first', () => {
  const report = runRetrievalEval();

  assert.equal(report.passed, true, formatReport(report));
  assert.equal(report.metrics.hitRateAt1, 1);
  assert.equal(report.metrics.hitRateAt3, 1);
  assert.equal(report.metrics.mrr, 1);
  for (const row of report.cases) {
    assert.equal(row.rank, 1, `${row.id} should rank first; got ${row.rank}; topIds=${row.topIds.join(',')}`);
  }
});

test('assertRetrievalEval throws with actionable case details', () => {
  const report = {
    metrics: { hitRateAt1: 0, hitRateAt3: 0, mrr: 0 },
    cases: [
      {
        id: 'revenue_truth_operator_transactions',
        expectedId: 'lesson-revenue-customer-provenance',
        requiredTopK: 1,
        rank: null,
        passed: false,
        reason: 'must rank first',
      },
    ],
  };

  assert.throws(
    () => assertRetrievalEval(report),
    /revenue_truth_operator_transactions: expected lesson-revenue-customer-provenance <= top 1/,
  );
});

test('scoreCases computes hit rates and MRR from ranks', () => {
  const metrics = scoreCases([
    { rank: 1 },
    { rank: 2 },
    { rank: null },
  ]);

  assert.equal(metrics.totalCases, 3);
  assert.equal(metrics.hitRateAt1, 0.333333);
  assert.equal(metrics.hitRateAt3, 0.666667);
  assert.equal(metrics.mrr, 0.5);
});

test('rankOf returns one-indexed ranks and null for misses', () => {
  const results = [{ id: 'a' }, { id: 'b' }];

  assert.equal(rankOf(results, 'a'), 1);
  assert.equal(rankOf(results, 'b'), 2);
  assert.equal(rankOf(results, 'c'), null);
});

test('formatReport prints pass/fail summary and top ids', () => {
  const report = runRetrievalEval();
  const text = formatReport(report);

  assert.match(text, /ThumbGate Retrieval Eval/);
  assert.match(text, /Hit@1: 1/);
  assert.match(text, /revenue_truth_operator_transactions/);
  assert.match(text, /topIds=lesson-revenue-customer-provenance/);
});
