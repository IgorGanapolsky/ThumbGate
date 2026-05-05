'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  buildDeepSeekV4RuntimeGuardrailsPlan,
  formatDeepSeekV4RuntimeGuardrailsPlan,
  normalizeOptions,
  throughputDropPercent,
} = require('../scripts/deepseek-v4-runtime-guardrails');

const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

test('normalizeOptions extracts DeepSeek-V4 runtime rollout signals', () => {
  const options = normalizeOptions({
    workload: 'long-trace-routing',
    model: 'deepseek-v4-pro',
    'context-tokens': '900000',
    'baseline-throughput': '266',
    'new-throughput': '220',
    'hybrid-attention': true,
    'speculative-decoding': true,
    'accept-length': '1.4',
    training: true,
    'train-inference-drift': '0.08',
    'precision-mode': 'fp8',
  });

  assert.equal(options.workload, 'long-trace-routing');
  assert.equal(options.model, 'deepseek-v4-pro');
  assert.equal(options.contextTokens, 900000);
  assert.equal(options.baselineThroughput, 266);
  assert.equal(options.newThroughput, 220);
  assert.equal(options.hybridAttention, true);
  assert.equal(options.speculativeDecoding, true);
  assert.equal(options.acceptLength, 1.4);
  assert.equal(options.training, true);
  assert.equal(options.trainInferenceDrift, 0.08);
  assert.equal(options.precisionMode, 'fp8');
});

test('throughputDropPercent computes long-context slowdown', () => {
  assert.equal(throughputDropPercent({ baselineThroughput: 266, newThroughput: 220 }), 17.29);
  assert.equal(throughputDropPercent({ baselineThroughput: 0, newThroughput: 220 }), null);
});

test('buildDeepSeekV4RuntimeGuardrailsPlan recommends sparse-attention safety gates', () => {
  const report = buildDeepSeekV4RuntimeGuardrailsPlan({
    'context-tokens': '900000',
    'baseline-throughput': '266',
    'new-throughput': '220',
    'hybrid-attention': true,
    'speculative-decoding': true,
    'accept-length': '1.4',
    training: true,
    'precision-mode': 'fp8',
    'numerical-spikes': true,
  });
  const recommendedIds = report.templates
    .filter((template) => template.recommended)
    .map((template) => template.id);

  assert.equal(report.name, 'thumbgate-deepseek-v4-runtime-guardrails');
  assert.equal(report.status, 'actionable');
  assert.ok(recommendedIds.includes('require-hybrid-prefix-cache-coherence-eval'));
  assert.ok(recommendedIds.includes('checkpoint-speculative-decoding-acceptance'));
  assert.ok(recommendedIds.includes('require-long-context-kv-offload-capacity-plan'));
  assert.ok(recommendedIds.includes('require-rollout-routing-and-indexer-replay'));
  assert.ok(recommendedIds.includes('checkpoint-mixed-precision-determinism'));
  assert.ok(recommendedIds.includes('checkpoint-long-context-throughput-regression'));
});

test('formatDeepSeekV4RuntimeGuardrailsPlan renders operator next actions', () => {
  const report = buildDeepSeekV4RuntimeGuardrailsPlan({
    'context-tokens': '900000',
    'hybrid-attention': true,
  });
  const text = formatDeepSeekV4RuntimeGuardrailsPlan(report);

  assert.match(text, /ThumbGate DeepSeek-V4 Runtime Guardrails/);
  assert.match(text, /cache-coherence/);
  assert.match(text, /Benchmark DeepSeek-V4/);
});

test('deepseek-v4-runtime-guardrails CLI emits machine-readable recommendations', () => {
  const result = spawnSync(process.execPath, [
    CLI,
    'deepseek-v4-runtime-guardrails',
    '--context-tokens=900000',
    '--hybrid-attention',
    '--speculative-decoding',
    '--accept-length=1.4',
    '--precision-mode=fp8',
    '--json',
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-deepseek-v4-runtime-guardrails');
  assert.ok(payload.summary.recommendedTemplateCount >= 3);
  assert.ok(payload.signals.some((signal) => signal.id === 'hybrid_attention_cache'));
});
