#!/usr/bin/env node
'use strict';

const { listGateTemplates } = require('./gate-templates');
const {
  theoreticalSpeedup,
  optimalDraftLengthForAttention,
  isTileAligned,
} = require('./nvidia-specdecode-al-doctor');

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
    draftLength: toNumber(options['draft-length'] || options['spec-draft-length'] || options.d),
    draftDepthRatio: toNumber(options['draft-depth-ratio'] || options.rho),
    claimedSpeedup: toNumber(options['claimed-speedup'] || options.speedup),
    queryHeadsPerKvHead: toNumber(options['query-heads-per-kv'] || options.g || options.G),
    attentionDominated: normalizeBoolean(options['attention-dominated'] || options.attention),
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
    if (!options.speculativeDecoding) return false;
    if (options.acceptLength === null || options.acceptLength < 2 || !options.cacheCoherenceEval) return true;
    if (options.draftLength !== null && options.acceptLength > (1 + options.draftLength)) return true;
    const rho = options.draftDepthRatio === null ? 0 : options.draftDepthRatio;
    if (
      options.claimedSpeedup !== null
      && options.acceptLength !== null
      && options.draftLength !== null
    ) {
      const theory = theoreticalSpeedup(options.acceptLength, options.draftLength, rho);
      if (theory !== null && options.claimedSpeedup > theory) return true;
    }
    if (
      options.attentionDominated
      && options.queryHeadsPerKvHead !== null
      && options.draftLength !== null
    ) {
      const optimal = optimalDraftLengthForAttention(options.queryHeadsPerKvHead);
      if (
        optimal !== null
        && options.draftLength > optimal
        && !isTileAligned(options.queryHeadsPerKvHead, options.draftLength)
      ) {
        return true;
      }
    }
    return false;
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
  const drop = throughputDropPercent(options);
  return [
    hybridAttentionSignal(options),
    speculativeDecodingSignal(options),
    longContextSignal(options, drop),
    verifiedReplaySignal(options),
    mixedPrecisionSignal(options),
  ].filter(Boolean);
}

function hybridAttentionSignal(options) {
  if (!(options.hybridAttention || isLongContext(options) || options.prefixCache)) return null;
  return {
    id: 'hybrid_attention_cache',
    label: 'Hybrid attention prefix cache',
    values: [
      options.hybridAttention ? 'hybrid attention' : null,
      options.prefixCache ? 'prefix cache enabled' : 'prefix cache missing',
      options.cacheCoherenceEval ? 'coherence eval present' : 'missing coherence eval',
      options.contextTokens !== null ? `${options.contextTokens} context tokens` : null,
    ].filter(Boolean),
    risk: 'SWA, compressed KV, and compression-state pools can drift unless cache lifetime and reuse are verified.',
  };
}

function speculativeDecodingSignal(options) {
  if (!(options.speculativeDecoding || options.acceptLength !== null || options.draftLength !== null)) {
    return null;
  }
  const rho = options.draftDepthRatio === null ? 0 : options.draftDepthRatio;
  const theory = (
    options.acceptLength !== null && options.draftLength !== null
  )
    ? theoreticalSpeedup(options.acceptLength, options.draftLength, rho)
    : null;
  return {
    id: 'speculative_decoding',
    label: 'Speculative decoding rollout',
    values: [
      options.speculativeDecoding ? 'speculative decoding enabled' : 'speculative decoding not declared',
      options.acceptLength !== null ? `${options.acceptLength} accept length (AL)` : 'accept length missing',
      options.draftLength !== null ? `${options.draftLength} draft length (D)` : null,
      options.draftDepthRatio !== null ? `ρ=${options.draftDepthRatio}` : null,
      theory !== null ? `theory ${theory}x = AL/(1+ρD)` : null,
      options.claimedSpeedup !== null ? `claimed ${options.claimedSpeedup}x` : null,
    ].filter(Boolean),
    risk: 'Draft-token metadata and rollback paths can make throughput claims look good while correctness or acceptance collapses. Reject claims above AL/(1+ρD).',
  };
}

function longContextSignal(options, drop) {
  if (!isLongContext(options)) return null;
  return {
    id: 'long_context_capacity',
    label: 'Long-context capacity plan',
    values: [
      `${options.contextTokens || options.targetContextTokens} token context target`,
      options.kvOffload ? 'KV offload present' : 'KV offload missing',
      drop !== null ? `${drop}% throughput drop` : null,
    ].filter(Boolean),
    risk: 'Long-context serving can hit memory ceilings or hidden throughput regressions without capacity and benchmark gates.',
  };
}

function verifiedReplaySignal(options) {
  if (!options.training) return null;
  return {
    id: 'verified_rl_replay',
    label: 'Verified RL replay safety',
    values: [
      options.rolloutReplay ? 'rollout replay present' : 'rollout replay missing',
      options.indexerReplay ? 'indexer replay present' : 'indexer replay missing',
      options.trainInferenceDrift !== null ? `${options.trainInferenceDrift} train-inference drift` : null,
    ].filter(Boolean),
    risk: 'Sparse routing and indexer decisions must be replayed or training can optimize against a different path than rollout served.',
  };
}

function mixedPrecisionSignal(options) {
  if (!(usesMixedPrecision(options) || options.numericalSpikes)) return null;
  return {
    id: 'mixed_precision_determinism',
    label: 'Mixed precision determinism',
    values: [
      options.precisionMode || 'precision mode unspecified',
      options.deterministic ? 'determinism enabled' : 'determinism missing',
      options.numericalSpikes ? 'numerical spikes observed' : null,
    ].filter(Boolean),
    risk: 'FP4/FP8 rollout and training can introduce silent numerical drift without deterministic and FP32-sensitive-path checks.',
  };
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
      draftLength: options.draftLength,
      draftDepthRatio: options.draftDepthRatio,
      claimedSpeedup: options.claimedSpeedup,
      theoreticalSpeedup: (
        options.acceptLength !== null && options.draftLength !== null
      )
        ? theoreticalSpeedup(
          options.acceptLength,
          options.draftLength,
          options.draftDepthRatio === null ? 0 : options.draftDepthRatio
        )
        : null,
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
      'Measure AL and D; reject speedup claims above AL/(1+ρD) via nvidia-specdecode-al-doctor.',
      'Keep long-context memory and throughput budgets explicit before raising context windows.',
      'For RL or fine-tuning, require rollout-routing replay, indexer replay, and train-inference drift checks.',
      'Treat FP4/FP8 or mixed-precision paths as gated rollouts until deterministic and sensitive-FP32 checks pass.',
    ],
    exampleCommand: 'npx thumbgate deepseek-v4-runtime-guardrails --context-tokens=900000 --hybrid-attention --speculative-decoding --accept-length=1.4 --draft-length=7 --draft-depth-ratio=0.05 --claimed-speedup=3 --precision-mode=fp8 --training --json',
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
  if (report.metrics.draftLength !== null) lines.push(`Spec draft length: ${report.metrics.draftLength}`);
  if (report.metrics.theoreticalSpeedup !== null) {
    lines.push(`Spec theory speedup: ${report.metrics.theoreticalSpeedup}x (AL/(1+ρD))`);
  }
  if (report.metrics.claimedSpeedup !== null) lines.push(`Spec claimed speedup: ${report.metrics.claimedSpeedup}x`);
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
