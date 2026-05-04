#!/usr/bin/env node
'use strict';

const { listGateTemplates } = require('./gate-templates');

const CATEGORY = 'Sparse Attention Runtime Safety';

function normalizeBoolean(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeOptions(options = {}) {
  const training = normalizeBoolean(options.training || options.rl || options['verified-rl']);
  const kvOffload = normalizeBoolean(options['kv-offload'] || options['cpu-kv-offload'] || options.hisparse);
  return {
    workload: String(options.workload || options.name || 'deepseek-v4-runtime').trim() || 'deepseek-v4-runtime',
    model: String(options.model || 'deepseek-v4-flash').trim() || 'deepseek-v4-flash',
    engine: String(options.engine || 'sglang').trim() || 'sglang',
    contextTokens: toNumber(options['context-tokens'] || options.context),
    targetContextTokens: toNumber(options['target-context-tokens'] || options.target) || 1000000,
    baselineThroughput: toNumber(options['baseline-throughput'] || options['baseline-tps']),
    newThroughput: toNumber(options['new-throughput'] || options['new-tps']),
    hybridAttention: normalizeBoolean(options['hybrid-attention'] || options.hybrid),
    prefixCache: normalizeBoolean(options['prefix-cache'] || options.shadowradix),
    cacheCoherenceEval: normalizeBoolean(options['cache-coherence-eval'] || options['cache-eval']),
    speculativeDecoding: normalizeBoolean(options['speculative-decoding'] || options.speculative || options.mtp || options.eagle),
    acceptLength: toNumber(options['accept-length'] || options['spec-accept-length']),
    kvOffload,
    training,
    rolloutReplay: normalizeBoolean(options['rollout-replay'] || options.r3),
    indexerReplay: normalizeBoolean(options['indexer-replay']),
    trainInferenceDrift: toNumber(options['train-inference-drift'] || options.drift),
    precisionMode: String(options['precision-mode'] || options.precision || '').trim().toLowerCase(),
    deterministic: normalizeBoolean(options.deterministic || options['deterministic-kernels']),
    numericalSpikes: normalizeBoolean(options['numerical-spikes'] || options['kl-spikes']),
  };
}

function throughputDropPercent(options) {
  if (options.baselineThroughput === null || options.newThroughput === null || options.baselineThroughput <= 0) return null;
  return Number((((options.baselineThroughput - options.newThroughput) / options.baselineThroughput) * 100).toFixed(2));
}

function isLongContext(options) {
  const context = options.contextTokens || options.targetContextTokens;
  return context >= 128000;
}

function usesMixedPrecision(options) {
  return /fp4|fp8|mxfp|mixed/.test(options.precisionMode);
}

function templateApplicability(template, options) {
  const drop = throughputDropPercent(options);
  if (template.id === 'require-hybrid-prefix-cache-coherence-eval') {
    return (options.hybridAttention || isLongContext(options)) && (!options.prefixCache || !options.cacheCoherenceEval);
  }
  if (template.id === 'checkpoint-speculative-decoding-acceptance') {
    return options.speculativeDecoding && (options.acceptLength === null || options.acceptLength < 2 || !options.cacheCoherenceEval);
  }
  if (template.id === 'require-long-context-kv-offload-capacity-plan') {
    return isLongContext(options) && !options.kvOffload;
  }
  if (template.id === 'require-rollout-routing-and-indexer-replay') {
    return options.training && (!options.rolloutReplay || !options.indexerReplay || (options.trainInferenceDrift !== null && options.trainInferenceDrift > 0.05));
  }
  if (template.id === 'checkpoint-mixed-precision-determinism') {
    return (usesMixedPrecision(options) || options.numericalSpikes) && !options.deterministic;
  }
  if (template.id === 'checkpoint-long-context-throughput-regression') {
    return drop !== null && drop > 10;
  }
  return false;
}

function buildSignals(options) {
  const signals = [];
  const drop = throughputDropPercent(options);
  if (options.hybridAttention || isLongContext(options) || options.prefixCache) {
    signals.push({
      id: 'hybrid_attention_cache',
      label: 'Hybrid attention prefix cache',
      values: [
        options.hybridAttention ? 'hybrid attention' : null,
        options.prefixCache ? 'prefix cache enabled' : 'prefix cache missing',
        options.cacheCoherenceEval ? 'coherence eval present' : 'missing coherence eval',
        options.contextTokens !== null ? `${options.contextTokens} context tokens` : null,
      ].filter(Boolean),
      risk: 'SWA, compressed KV, and compression-state pools can drift unless cache lifetime and reuse are verified.',
    });
  }
  if (options.speculativeDecoding || options.acceptLength !== null) {
    signals.push({
      id: 'speculative_decoding',
      label: 'Speculative decoding rollout',
      values: [
        options.speculativeDecoding ? 'speculative decoding enabled' : 'speculative decoding not declared',
        options.acceptLength !== null ? `${options.acceptLength} accept length` : 'accept length missing',
      ],
      risk: 'Draft-token metadata and rollback paths can make throughput claims look good while correctness or acceptance collapses.',
    });
  }
  if (isLongContext(options)) {
    signals.push({
      id: 'long_context_capacity',
      label: 'Long-context capacity plan',
      values: [
        `${options.contextTokens || options.targetContextTokens} token context target`,
        options.kvOffload ? 'KV offload present' : 'KV offload missing',
        drop !== null ? `${drop}% throughput drop` : null,
      ].filter(Boolean),
      risk: 'Long-context serving can hit memory ceilings or hidden throughput regressions without capacity and benchmark gates.',
    });
  }
  if (options.training) {
    signals.push({
      id: 'verified_rl_replay',
      label: 'Verified RL replay safety',
      values: [
        options.rolloutReplay ? 'rollout replay present' : 'rollout replay missing',
        options.indexerReplay ? 'indexer replay present' : 'indexer replay missing',
        options.trainInferenceDrift !== null ? `${options.trainInferenceDrift} train-inference drift` : null,
      ].filter(Boolean),
      risk: 'Sparse routing and indexer decisions must be replayed or training can optimize against a different path than rollout served.',
    });
  }
  if (usesMixedPrecision(options) || options.numericalSpikes) {
    signals.push({
      id: 'mixed_precision_determinism',
      label: 'Mixed precision determinism',
      values: [
        options.precisionMode || 'precision mode unspecified',
        options.deterministic ? 'determinism enabled' : 'determinism missing',
        options.numericalSpikes ? 'numerical spikes observed' : null,
      ].filter(Boolean),
      risk: 'FP4/FP8 rollout and training can introduce silent numerical drift without deterministic and FP32-sensitive-path checks.',
    });
  }
  return signals;
}

function buildDeepSeekV4RuntimeGuardrailsPlan(rawOptions = {}, templatesPath) {
  const options = normalizeOptions(rawOptions);
  const templates = listGateTemplates(templatesPath)
    .filter((template) => template.category === CATEGORY)
    .map((template) => ({
      ...template,
      recommended: templateApplicability(template, options),
    }));
  const signals = buildSignals(options);
  const recommendedTemplates = templates.filter((template) => template.recommended);

  return {
    name: 'thumbgate-deepseek-v4-runtime-guardrails',
    status: recommendedTemplates.length > 0 ? 'actionable' : 'ready',
    workload: options.workload,
    model: options.model,
    engine: options.engine,
    metrics: {
      contextTokens: options.contextTokens,
      targetContextTokens: options.targetContextTokens,
      baselineThroughput: options.baselineThroughput,
      newThroughput: options.newThroughput,
      throughputDropPercent: throughputDropPercent(options),
      acceptLength: options.acceptLength,
      trainInferenceDrift: options.trainInferenceDrift,
    },
    summary: {
      signalCount: signals.length,
      templateCount: templates.length,
      recommendedTemplateCount: recommendedTemplates.length,
    },
    signals,
    templates,
    nextActions: [
      'Benchmark DeepSeek-V4 behind the same ThumbGate eval harness before changing routing defaults.',
      'Require cache-coherence and rollback evidence before enabling hybrid prefix caching or speculative decoding.',
      'Keep long-context memory and throughput budgets explicit before raising context windows.',
      'For RL or fine-tuning, require rollout-routing replay, indexer replay, and train-inference drift checks.',
      'Treat FP4/FP8 or mixed-precision paths as gated rollouts until deterministic and sensitive-FP32 checks pass.',
    ],
    exampleCommand: 'npx thumbgate deepseek-v4-runtime-guardrails --context-tokens=900000 --hybrid-attention --speculative-decoding --accept-length=1.4 --precision-mode=fp8 --training --json',
  };
}

function formatDeepSeekV4RuntimeGuardrailsPlan(report) {
  const lines = [
    '',
    'ThumbGate DeepSeek-V4 Runtime Guardrails',
    '-'.repeat(43),
    `Status  : ${report.status}`,
    `Workload: ${report.workload}`,
    `Model   : ${report.model}`,
    `Engine  : ${report.engine}`,
    `Signals : ${report.summary.signalCount}`,
    `Templates: ${report.summary.recommendedTemplateCount}/${report.summary.templateCount} recommended`,
  ];
  if (report.metrics.contextTokens !== null) lines.push(`Context tokens: ${report.metrics.contextTokens}`);
  if (report.metrics.throughputDropPercent !== null) lines.push(`Throughput drop: ${report.metrics.throughputDropPercent}%`);
  if (report.metrics.acceptLength !== null) lines.push(`Spec accept length: ${report.metrics.acceptLength}`);
  if (report.metrics.trainInferenceDrift !== null) lines.push(`Train/inference drift: ${report.metrics.trainInferenceDrift}`);

  if (report.signals.length > 0) {
    lines.push('', 'Detected runtime signals:');
    for (const signal of report.signals) {
      lines.push(`  - ${signal.label}: ${signal.values.join(', ')}`);
      lines.push(`    Risk: ${signal.risk}`);
    }
  }

  lines.push('', 'Recommended templates:');
  const recommended = report.templates.filter((template) => template.recommended);
  if (recommended.length === 0) lines.push('  - No sparse-attention runtime risks were passed.');
  for (const template of recommended) {
    lines.push(`  - ${template.id} [${template.defaultAction}]`);
    lines.push(`    ${template.roi}`);
  }

  lines.push('', 'Next actions:');
  for (const action of report.nextActions) lines.push(`  - ${action}`);
  lines.push('', `Example: ${report.exampleCommand}`, '');
  return `${lines.join('\n')}\n`;
}

module.exports = {
  buildDeepSeekV4RuntimeGuardrailsPlan,
  formatDeepSeekV4RuntimeGuardrailsPlan,
  normalizeOptions,
  throughputDropPercent,
};
