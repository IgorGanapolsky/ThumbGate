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
  });

  assert.equal(options.workload, 'math-routing');
  assert.equal(options.baselineTokens, 1200);
  assert.equal(options.compressedTokens, 980);
  assert.equal(options.baselineAccuracy, 0.84);
  assert.equal(options.compressedAccuracy, 0.85);
  assert.equal(options.verifier, true);
  assert.equal(options.lowConfidenceSteps, 2);
  assert.equal(options.highConfidenceFailures, 1);
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
