'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  buildRagPrecisionGuardrailsPlan,
  formatRagPrecisionGuardrailsPlan,
  normalizeOptions,
  recallDropPercent,
} = require('../scripts/rag-precision-guardrails');

const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

test('normalizeOptions extracts RAG precision and agentic pipeline signals', () => {
  const options = normalizeOptions({
    'rag-tool': 'redis-rag',
    'baseline-recall': '0.86',
    'new-recall': '0.72',
    'baseline-precision': '0.74',
    'new-precision': '0.81',
    'top-k': '20',
    'threshold-change': true,
    agentic: 'true',
    'structural-near-misses': 'yes',
    'latency-ms': '440',
    'latency-budget-ms': '300',
  });

  assert.equal(options.ragTool, 'redis-rag');
  assert.equal(options.baselineRecall, 0.86);
  assert.equal(options.newRecall, 0.72);
  assert.equal(options.baselinePrecision, 0.74);
  assert.equal(options.newPrecision, 0.81);
  assert.equal(options.topK, 20);
  assert.equal(options.thresholdChanged, true);
  assert.equal(options.agenticPipeline, true);
  assert.equal(options.structuralNearMisses, true);
  assert.equal(options.latencyMs, 440);
  assert.equal(options.latencyBudgetMs, 300);
});

test('recallDropPercent computes retrieval regression percentage', () => {
  assert.equal(recallDropPercent({ baselineRecall: 0.86, newRecall: 0.72 }), 16.28);
  assert.equal(recallDropPercent({ baselineRecall: null, newRecall: 0.72 }), null);
});

test('buildRagPrecisionGuardrailsPlan recommends precision tuning gates', () => {
  const report = buildRagPrecisionGuardrailsPlan({
    'baseline-recall': '0.86',
    'new-recall': '0.72',
    'threshold-change': true,
    agentic: true,
    'structural-near-misses': true,
    verifier: true,
    'latency-ms': '440',
    'latency-budget-ms': '300',
  });

  const recommendedIds = report.templates
    .filter((template) => template.recommended)
    .map((template) => template.id);

  assert.equal(report.name, 'thumbgate-rag-precision-guardrails');
  assert.equal(report.status, 'actionable');
  assert.equal(report.metrics.recallDropPercent, 16.28);
  assert.deepEqual(recommendedIds, [
    'require-rag-baseline-before-precision-tuning',
    'require-two-stage-rag-verifier-for-structural-near-misses',
    'checkpoint-rag-latency-precision-tradeoff',
  ]);
});

test('formatRagPrecisionGuardrailsPlan renders operator next actions', () => {
  const report = buildRagPrecisionGuardrailsPlan({
    'baseline-recall': '0.86',
    'new-recall': '0.72',
    'threshold-change': true,
    agentic: true,
  });
  const text = formatRagPrecisionGuardrailsPlan(report);

  assert.match(text, /ThumbGate RAG Precision Guardrails/);
  assert.match(text, /Recall drop: 16\.28%/);
  assert.match(text, /Save baseline recall@k/);
  assert.match(text, /npx thumbgate rag-precision-guardrails/);
});

test('rag-precision-guardrails CLI emits machine-readable recommendations', () => {
  const result = spawnSync(process.execPath, [
    CLI,
    'rag-precision-guardrails',
    '--baseline-recall=0.86',
    '--new-recall=0.72',
    '--threshold-change',
    '--agentic',
    '--structural-near-misses',
    '--json',
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-rag-precision-guardrails');
  assert.equal(payload.summary.recommendedTemplateCount, 2);
  assert.ok(payload.signals.some((signal) => signal.id === 'precision_tuning'));
});
