'use strict';

function buildInferenceCachePolicy(options = {}) {
  return {
    policyId: 'llm_inference_cache',
    layers: [
      {
        id: 'kv_cache',
        owner: 'model_runtime',
        enabled: true,
        action: 'no app changes; rely on inference runtime',
      },
      {
        id: 'prefix_cache',
        owner: 'agent_harness',
        enabled: options.prefixCache !== false,
        action: 'place stable system prompt, docs, and examples before dynamic fields',
      },
      {
        id: 'semantic_cache',
        owner: 'application',
        enabled: Boolean(options.semanticCache),
        action: 'cache complete input/output pairs when paraphrased repeat volume is high',
      },
    ],
    promptRules: [
      'static content first',
      'dynamic user/session/date fields last',
      'deterministic JSON key order',
      'no generated timestamps inside cached prefix',
      'version cache keys with prompt and policy versions',
    ],
    invalidation: {
      prefix: ['system_prompt_version', 'doc_version', 'tool_policy_version'],
      semantic: ['answer_ttl', 'source_doc_version', 'safety_policy_version'],
    },
  };
}

function evaluateCacheCandidate(candidate = {}) {
  const issues = [];
  const repeatedPrefixTokens = Number(candidate.repeatedPrefixTokens || 0);
  const requestsPerDay = Number(candidate.requestsPerDay || 0);
  const semanticRepeatRate = Number(candidate.semanticRepeatRate || 0);

  if (candidate.dynamicFieldsBeforeStatic) issues.push('dynamic_fields_break_prefix_cache');
  if (!candidate.deterministicSerialization) issues.push('deterministic_serialization_required');
  if (repeatedPrefixTokens >= 1024 && requestsPerDay >= 10 && !candidate.prefixCacheEnabled) {
    issues.push('prefix_cache_high_roi_not_enabled');
  }
  if (candidate.semanticCacheEnabled && semanticRepeatRate < 0.15) {
    issues.push('semantic_cache_overhead_not_justified');
  }
  if (candidate.semanticCacheEnabled && !candidate.ttl) {
    issues.push('semantic_cache_ttl_required');
  }

  return {
    decision: issues.length ? 'warn' : 'allow',
    issues,
    recommendedLayers: [
      'kv_cache',
      repeatedPrefixTokens >= 1024 && requestsPerDay >= 10 ? 'prefix_cache' : null,
      semanticRepeatRate >= 0.15 ? 'semantic_cache' : null,
    ].filter(Boolean),
  };
}

function planDepthWiseKvSharing(options = {}) {
  const layerCount = Number(options.layerCount || 0);
  const cacheBudgetRatio = Number(options.cacheBudgetRatio || 1);
  const trainingAdapted = Boolean(options.trainingAdapted || options.randomCrossLayerAttention);
  const latencySensitive = Boolean(options.latencySensitive);
  const unknownHardware = Boolean(options.unknownHardware);
  const dataConstrained = Boolean(options.dataConstrained);
  const issues = [];

  if (layerCount < 12) issues.push('model_too_shallow_for_depth_sharing_roi');
  if (!trainingAdapted) issues.push('requires_training_or_finetune_adaptation');
  if (cacheBudgetRatio >= 0.9) issues.push('kv_memory_budget_not_constrained');
  if (latencySensitive && !trainingAdapted) issues.push('avoid_runtime_only_cross_layer_sharing_for_ttfb');

  const targetSharedLayerRatio = cacheBudgetRatio <= 0.5 ? 0.5 : cacheBudgetRatio <= 0.75 ? 0.25 : 0;
  const estimatedKvMemoryReduction = Number((targetSharedLayerRatio * 0.9).toFixed(2));
  const deploymentModes = [
    'full-kv-cache',
    targetSharedLayerRatio >= 0.25 ? 'share-every-fourth-layer' : null,
    targetSharedLayerRatio >= 0.5 ? 'share-every-other-layer' : null,
  ].filter(Boolean);

  return {
    decision: issues.some((issue) => issue !== 'kv_memory_budget_not_constrained') ? 'research' : 'pilot',
    issues,
    technique: 'stochastic-kv-routing-depth-wise-cache-sharing',
    targetSharedLayerRatio,
    estimatedKvMemoryReduction,
    deploymentModes,
    recommendedWorkload: unknownHardware || dataConstrained ? 'adaptive-serving-pilot' : 'benchmark-before-rollout',
    gates: [
      'compare quality against full-cache baseline',
      'measure time-to-first-token and tokens/sec',
      'block rollout if golden eval pass rate regresses',
    ],
  };
}

module.exports = {
  buildInferenceCachePolicy,
  evaluateCacheCandidate,
  planDepthWiseKvSharing,
};
