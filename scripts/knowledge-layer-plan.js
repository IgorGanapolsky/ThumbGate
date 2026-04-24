'use strict';

function buildKnowledgeLayerPlan(options = {}) {
  const domain = options.domain || 'agent_reliability';
  const graph = options.graph || 'neo4j';

  return {
    domain,
    graph,
    memoryTiers: [
      {
        id: 'short_term',
        purpose: 'Current session context so the agent does not re-ask answered questions.',
        ttl: 'session',
      },
      {
        id: 'long_term',
        purpose: 'Durable user, product, workflow, and feedback profile facts.',
        ttl: 'durable',
      },
      {
        id: 'reasoning_memory',
        purpose: 'Reusable decision paths that avoid recomputing expensive traversals.',
        ttl: 'versioned',
      },
    ],
    nodeTypes: [
      'User',
      'Agent',
      'Workflow',
      'Feedback',
      'Gate',
      'Decision',
      'Evidence',
      'Recommendation',
      'Outcome',
    ],
    relationshipTypes: [
      'GAVE_FEEDBACK',
      'TRIGGERED_GATE',
      'USED_EVIDENCE',
      'RECOMMENDED_ACTION',
      'PRODUCED_OUTCOME',
      'SIMILAR_TO',
      'REUSES_REASONING',
    ],
    highRoiUseCases: [
      'conversion recommendations with explainable evidence paths',
      'compute savings from reasoning-memory cache hits',
      'compliance audit trail for why an agent recommended or blocked an action',
      'closed-loop profile updates from every feedback, purchase, or outcome event',
    ],
    gates: [
      'do not recommend without an evidence path',
      'do not reuse reasoning memory when source facts changed',
      'write audit node for every recommendation and blocked action',
      'record outcome feedback to update profile and graph edges',
    ],
  };
}

function buildRecommendationEvidencePath(input = {}) {
  const userId = input.userId || 'unknown_user';
  const recommendationId = input.recommendationId || 'rec_pending';
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const similarProfiles = Array.isArray(input.similarProfiles) ? input.similarProfiles : [];

  return {
    recommendationId,
    path: [
      { type: 'User', id: userId },
      ...similarProfiles.map((id) => ({ type: 'SimilarProfile', id })),
      ...evidence.map((item, index) => ({
        type: item.type || 'Evidence',
        id: item.id || `evidence_${index + 1}`,
        quote: item.quote || null,
      })),
      { type: 'Recommendation', id: recommendationId },
    ],
    explainable: evidence.length > 0,
  };
}

function evaluateKnowledgeLayerRun(run = {}) {
  const issues = [];
  if (!run.userId) issues.push('missing_user_id');
  if (!run.recommendationId) issues.push('missing_recommendation_id');
  if (!run.evidencePath || !run.evidencePath.explainable) issues.push('missing_explainable_evidence_path');
  if (!run.auditNodeId) issues.push('missing_audit_node_id');
  if (run.reusedReasoning && !run.reasoningVersion) issues.push('missing_reasoning_version');
  if (run.profileUpdate && !run.outcomeEventId) issues.push('missing_outcome_event_id');

  return {
    decision: issues.length ? 'warn' : 'allow',
    issues,
    roiSignals: [
      run.reusedReasoning ? 'lower_graph_query_and_token_cost' : null,
      run.profileUpdate ? 'closed_loop_personalization' : null,
      run.auditNodeId ? 'compliance_trace_available' : null,
    ].filter(Boolean),
  };
}

module.exports = {
  buildKnowledgeLayerPlan,
  buildRecommendationEvidencePath,
  evaluateKnowledgeLayerRun,
};
