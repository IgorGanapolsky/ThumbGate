'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_THRESHOLDS,
  computeLexicalRecall,
  computeLexicalPrecision,
  computeRankedMetrics,
  evaluateThresholds,
  retrieveEvalItems,
  runRagEval,
} = require('../scripts/eval-rag');

test('computeLexicalRecall returns 1 when query term is found and 0 otherwise', () => {
  assert.equal(computeLexicalRecall('idempotency', 'Use idempotency key for transactions'), 1);
  assert.equal(computeLexicalRecall('idempotency', 'Normal transaction flow'), 0);
  assert.equal(computeLexicalRecall('', 'Some text'), 0);
});

test('computeLexicalPrecision computes ratio of chunks containing expected hit', () => {
  const items = [
    { content: 'Verify idempotency key' },
    { content: 'Normal charge call' },
    { structuredContext: { rawContent: 'Strict idempotency check' } },
  ];

  const precision = computeLexicalPrecision('idempotency', items);
  // 2 out of 3 contain 'idempotency'
  assert.equal(Math.round(precision * 100) / 100, 0.67);
});

test('computeLexicalPrecision handles empty array safely', () => {
  assert.equal(computeLexicalPrecision('idempotency', []), 0);
});

test('computeRankedMetrics reports Recall@k, MRR, and graded nDCG', () => {
  const evalCase = {
    domain: 'railway-deploy',
    expectedRuleHit: 'health endpoint',
  };
  const metrics = computeRankedMetrics(evalCase, [
    { id: 'noise', domain: 'other', content: 'Quarterly planning notes.' },
    { id: 'partial', domain: 'railway-deploy', content: 'Inspect build logs.' },
    { id: 'relevant', domain: 'railway-deploy', content: 'Verify the health endpoint.' },
  ]);
  assert.equal(metrics.recallAt1, 0);
  assert.equal(metrics.recallAt5, 1);
  assert.equal(metrics.recallAt10, 1);
  assert.equal(metrics.mrrAt10, 1 / 3);
  assert.ok(metrics.ndcgAt10 > 0 && metrics.ndcgAt10 < 1);
});

test('evaluateThresholds fails closed on zero-quality retrieval', () => {
  const gate = evaluateThresholds({
    casesEvaluated: 6,
    avgRecall: 0,
    avgPrecision: 0,
    results: [{ id: 'zero-result', lexicalRecall: 0 }],
  });
  assert.equal(gate.passed, false);
  assert.ok(gate.failures.some((failure) => failure.includes('recall')));
  assert.ok(gate.failures.some((failure) => failure.includes('precision')));
  assert.ok(gate.failures.some((failure) => failure.includes('zero-result')));
});

test('retrieveEvalItems routes only from runtime query inputs, not golden domain labels', () => {
  const unrelated = retrieveEvalItems({
    domain: 'stripe-integration',
    query: 'completely unrelated phrase',
    expectedRuleHit: 'card numbers',
  });
  assert.equal(
    unrelated.some((item) => item.source === 'skill_pack'),
    false,
    'golden domain labels must not inject a skill pack',
  );

  const runtimeMatch = retrieveEvalItems({
    domain: 'untrusted-golden-label',
    query: 'Store customer credit card number',
    expectedRuleHit: 'card numbers',
  });
  assert.equal(runtimeMatch.find((item) => item.source === 'skill_pack')?.domain, 'stripe-integration');
});

test('runRagEval enforces deterministic quality thresholds and writes an isolated report', async () => {
  const reportDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'thumbgate-rag-eval-'));
  const reportPath = path.join(reportDir, 'eval-rag-report.md');

  // Force local fallback to be testable without API key
  const originalKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const outcome = await runRagEval({ reportPath, enableLlmJudge: false });
    assert.equal(outcome.summary.passed, true, outcome.summary.failures.join('; '));
    assert.ok(outcome.summary.avgRecall >= DEFAULT_THRESHOLDS.minRecall);
    assert.ok(outcome.summary.avgPrecision >= DEFAULT_THRESHOLDS.minPrecision);
    assert.ok(outcome.summary.casesEvaluated >= DEFAULT_THRESHOLDS.minCases);
    assert.ok(fs.existsSync(reportPath), 'Markdown report file should exist');

    const content = fs.readFileSync(reportPath, 'utf-8');
    assert.match(content, /# RAG Precision & Evaluation Report/);
    assert.match(content, /Release Gate.*PASS/);
    assert.match(content, /Recall@10/);
    assert.match(content, /MRR@10/);
    assert.match(content, /nDCG@10/);
  } finally {
    if (originalKey) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
});

test('runRagEval rejects a retrieval regression even when the runner itself succeeds', async () => {
  const reportDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'thumbgate-rag-regression-'));
  const reportPath = path.join(reportDir, 'report.md');
  try {
    const outcome = await runRagEval({
      reportPath,
      enableLlmJudge: false,
      retrieveItems: () => [],
    });
    assert.equal(outcome.summary.passed, false);
    assert.equal(outcome.summary.avgRecall, 0);
    assert.equal(outcome.summary.avgPrecision, 0);
    assert.match(fs.readFileSync(reportPath, 'utf8'), /Release Gate.*FAIL/);
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
});
