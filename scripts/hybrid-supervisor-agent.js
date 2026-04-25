'use strict';

function buildHybridSupervisorPlan(options = {}) {
  const sources = options.sources || [
    { id: 'feedback_log', type: 'jsonl', description: 'User thumbs-up/down and correction events.' },
    { id: 'gate_metrics', type: 'sql', description: 'Gate blocks, warnings, pass rates, and timestamps.' },
    { id: 'docs', type: 'vector', description: 'Public docs and operational guides.' },
  ];

  return {
    pattern: 'multi_step_hybrid_supervisor',
    sources,
    sourceCount: sources.length,
    steps: [
      'classify query into structured, unstructured, graph, or mixed',
      'decompose mixed queries into native-source subqueries',
      'run complementary SQL, graph, and vector searches in parallel',
      'join or reconcile result sets',
      'self-correct with a different query path when overlap is empty',
      'verify final answer against source-specific evidence',
    ],
    gates: [
      'prefer native source queries over flattening everything into embeddings',
      'limit initial deployments to 5-10 curated complementary sources',
      'require plain-language source descriptions at ingestion',
      'block final answers when structured and unstructured evidence conflict',
    ],
  };
}

function classifyHybridQuery(query = '') {
  const text = String(query).toLowerCase();
  const needsStructured = /\b(count|sum|trend|declin|increase|revenue|sales|rate|over time|sql|table)\b/.test(text);
  const needsUnstructured = /\b(reviews?|feedback|reason|complaints?|docs?|semantic|why|quote|citation)\b/.test(text);
  const needsGraph = /\b(similar|related|path|relationship|because|profile|like you)\b/.test(text);
  if ([needsStructured, needsUnstructured, needsGraph].filter(Boolean).length >= 2) return 'hybrid';
  if (needsStructured) return 'structured';
  if (needsGraph) return 'graph';
  if (needsUnstructured) return 'unstructured';
  return 'general';
}

function evaluateHybridSupervisorRun(run = {}) {
  const issues = [];
  const queryType = classifyHybridQuery(run.query || '');
  if (queryType === 'hybrid' && !run.decomposed) issues.push('hybrid_query_not_decomposed');
  if (queryType === 'hybrid' && !run.parallelNativeQueries) issues.push('parallel_native_queries_required');
  if (!run.sourceDescriptionsPresent) issues.push('missing_source_descriptions');
  if ((run.sourceCount || 0) > 10 && !run.incrementalRollout) issues.push('too_many_sources_without_incremental_rollout');
  if (run.emptyOverlap && !run.selfCorrected) issues.push('self_correction_required');
  if (run.evidenceConflict && !run.escalated) issues.push('conflicting_evidence_requires_escalation');

  return {
    decision: issues.length ? 'warn' : 'allow',
    issues,
    queryType,
  };
}

module.exports = {
  buildHybridSupervisorPlan,
  classifyHybridQuery,
  evaluateHybridSupervisorRun,
};
