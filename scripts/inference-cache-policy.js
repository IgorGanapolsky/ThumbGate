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

module.exports = {
  buildInferenceCachePolicy,
  evaluateCacheCandidate,
};
