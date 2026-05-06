'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  accuracyDelta,
  buildReasoningEfficiencyGuardrailsPlan,
  formatReasoningEfficiencyGuardrailsPlan,
  normalizeOptions,
  tokenReductionPercent,
} = require('../scripts/reasoning-efficiency-guardrails');

const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

test('normalizeOptions extracts reasoning compression signals', () => {
  const options = normalizeOptions({
    workload: 'math-routing',
    'baseline-tokens': '1200',
    'compressed-tokens': '980',
    'baseline-accuracy': '0.84',
    'compressed-accuracy': '0.85',
    verifier: true,
    'low-confidence-steps': '2',
    'high-confidence-failures': '1',
    'prompt-tokens': '120000',
    'output-tokens': '800',
    'ttft-ms': '1800',
    'tokens-per-second': '42',
    'kv-cache': 'false',
    'kv-cache-hit-rate': '0.41',
    quantized: true,
    'quality-delta': '-0.03',
    'prefill-budget-ms': '800',
    'decode-budget-tps': '60',
  });

  assert.equal(options.workload, 'math-routing');
  assert.equal(options.baselineTokens, 1200);
  assert.equal(options.compressedTokens, 980);
  assert.equal(options.baselineAccuracy, 0.84);
  assert.equal(options.compressedAccuracy, 0.85);
  assert.equal(options.verifier, true);
  assert.equal(options.lowConfidenceSteps, 2);
  assert.equal(options.highConfidenceFailures, 1);
  assert.equal(options.promptTokens, 120000);
  assert.equal(options.outputTokens, 800);
  assert.equal(options.ttftMs, 1800);
  assert.equal(options.tokensPerSecond, 42);
  assert.equal(options.kvCache, false);
  assert.equal(options.kvCacheHitRate, 0.41);
  assert.equal(options.quantized, true);
  assert.equal(options.qualityDelta, -0.03);
  assert.equal(options.prefillBudgetMs, 800);
  assert.equal(options.decodeBudgetTps, 60);
});

test('reasoning efficiency metric helpers compute token and accuracy deltas', () => {
  const options = { baselineTokens: 1200, compressedTokens: 980, baselineAccuracy: 0.84, compressedAccuracy: 0.85 };
  assert.equal(tokenReductionPercent(options), 18.33);
  assert.equal(accuracyDelta(options), 0.01);
});

test('buildReasoningEfficiencyGuardrailsPlan recommends step-level safety gates', () => {
  const report = buildReasoningEfficiencyGuardrailsPlan({
    'baseline-tokens': '1200',
    'compressed-tokens': '980',
    'baseline-accuracy': '0.84',
    'compressed-accuracy': '0.82',
    'low-confidence-steps': '2',
    'high-confidence-failures': '1',
  });
  const recommendedIds = report.templates
    .filter((template) => template.recommended)
    .map((template) => template.id);

  assert.equal(report.name, 'thumbgate-reasoning-efficiency-guardrails');
  assert.equal(report.status, 'actionable');
  assert.deepEqual(recommendedIds, [
    'require-verifier-before-reasoning-compression',
    'checkpoint-low-confidence-reasoning-steps',
    'checkpoint-high-confidence-failed-rollout',
  ]);
});

test('formatReasoningEfficiencyGuardrailsPlan renders operator next actions', () => {
  const report = buildReasoningEfficiencyGuardrailsPlan({
    'baseline-tokens': '1200',
    'compressed-tokens': '980',
    'baseline-accuracy': '0.84',
    'compressed-accuracy': '0.85',
    verifier: true,
  });
  const text = formatReasoningEfficiencyGuardrailsPlan(report);

  assert.match(text, /ThumbGate Reasoning Efficiency Guardrails/);
  assert.match(text, /Token reduction: 18\.33%/);
  assert.match(text, /Keep a verifier and pass@1 baseline/);
});

test('reasoning-efficiency-guardrails CLI emits machine-readable recommendations', () => {
  const result = spawnSync(process.execPath, [
    CLI,
    'reasoning-efficiency-guardrails',
    '--baseline-tokens=1200',
    '--compressed-tokens=980',
    '--baseline-accuracy=0.84',
    '--compressed-accuracy=0.82',
    '--low-confidence-steps=2',
    '--json',
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-reasoning-efficiency-guardrails');
  assert.ok(payload.summary.recommendedTemplateCount >= 2);
  assert.ok(payload.signals.some((signal) => signal.id === 'reasoning_compression'));
});

test('buildReasoningEfficiencyGuardrailsPlan flags inference runtime economics', () => {
  const report = buildReasoningEfficiencyGuardrailsPlan({
    'prompt-tokens': '120000',
    'ttft-ms': '1800',
    'prefill-budget-ms': '800',
    'tokens-per-second': '42',
    'decode-budget-tps': '60',
    'kv-cache': 'false',
    'kv-cache-hit-rate': '0.41',
    quantized: true,
    'quality-delta': '-0.03',
  });

  assert.equal(report.metrics.promptTokens, 120000);
  assert.equal(report.metrics.kvCache, false);
  assert.ok(report.signals.some((signal) => signal.id === 'prefill_decode_split'));
  assert.ok(report.signals.some((signal) => signal.id === 'kv_cache_policy'));
  assert.ok(report.signals.some((signal) => signal.id === 'quantization_rollout'));
});
