'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  tokenF1,
  claimSupportScore,
  evaluateAnswerQuality,
  evaluateAnswerQualityWithJudge,
} = require('../scripts/rag-structured-output');
const {
  loadAnswerGolden,
  evaluateAnswerGolden,
} = require('../scripts/rag-answer-quality-eval');

test('token F1 rewards overlap and rejects unrelated text', () => {
  assert.ok(tokenF1('force push protected main', 'never force push protected main') > 0.7);
  assert.equal(tokenF1('force push', 'cooking sauce'), 0);
});

test('claim support catches negation flips and numeric drift', () => {
  assert.ok(claimSupportScore(
    'Never force-push protected main.',
    'Never force-push protected main because it rewrites history.',
  ) > 0.5);
  assert.ok(claimSupportScore(
    'Force-push is safe on protected main.',
    'Never force-push protected main because it rewrites history.',
  ) < 0.4);
  assert.equal(claimSupportScore(
    'Build 43 is live.',
    'Build 42 is live.',
  ), 0);
});

test('answer quality binds supported claims to valid citation IDs', () => {
  const result = evaluateAnswerQuality({
    query: 'How do I prevent duplicate Stripe charges?',
    answer: 'Use a Stripe idempotency key for PaymentIntent retries [billing-policy].',
    referenceAnswer: 'Use a Stripe idempotency key for PaymentIntent retries.',
    contexts: [{
      id: 'billing-policy',
      text: 'Use a Stripe idempotency key for PaymentIntent retries to prevent duplicate charges.',
    }],
  });
  assert.equal(result.passed, true);
  assert.equal(result.metrics.citationPrecision, 1);
  assert.equal(result.citations.invalid.length, 0);
});

test('unsupported claims and invalid citations fail closed', () => {
  const result = evaluateAnswerQuality({
    query: 'Which build is live?',
    answer: 'Build 43 is live and revenue doubled [invented].',
    referenceAnswer: 'Build 42 is live.',
    contexts: [{ id: 'health', text: 'Build 42 is live.' }],
  });
  assert.equal(result.passed, false);
  assert.ok(result.failures.includes('faithfulness'));
  assert.deepEqual(result.citations.invalid, ['invented']);
});

test('judge remains diagnostic and cannot override deterministic failures', async () => {
  const result = await evaluateAnswerQualityWithJudge({
    query: 'Which build is live?',
    answer: 'Build 43 is live [health].',
    contexts: [{ id: 'health', text: 'Build 42 is live.' }],
  }, {
    judge: async () => ({
      faithfulness: 1,
      groundedness: 1,
      answerRelevance: 1,
      rationale: 'incorrectly optimistic fixture judge',
    }),
  });
  assert.equal(result.passed, false);
  assert.equal(result.judgeDiagnostic.metrics.faithfulness, 1);
});

test('malformed judge diagnostics degrade to null', async () => {
  const result = await evaluateAnswerQualityWithJudge({
    query: 'query',
    answer: 'answer',
    contexts: [],
  }, {
    judge: async () => ({ faithfulness: 5 }),
  });
  assert.equal(result.judgeDiagnostic, null);
});

test('answer-quality golden is adversarial and passes without false positives', () => {
  const golden = loadAnswerGolden();
  assert.ok(golden.cases.length >= 8);
  assert.ok(golden.cases.some((sample) => sample.id === 'negation-flip'));
  assert.ok(golden.cases.some((sample) => sample.id === 'numeric-drift'));
  const result = evaluateAnswerGolden({ golden });
  assert.equal(result.passed, true, result.failures.join('; '));
  assert.equal(result.summary.classificationAccuracy, 1);
  assert.equal(result.summary.falsePasses, 0);
});
