'use strict';

function buildAgentAuditSpan(input = {}) {
  return {
    runId: input.runId || null,
    spanId: input.spanId || null,
    parentSpanId: input.parentSpanId || null,
    stage: input.stage || 'unknown',
    promptHash: input.promptHash || null,
    model: input.model || null,
    reasoningSummary: input.reasoningSummary || null,
    dataAccessed: Array.isArray(input.dataAccessed) ? input.dataAccessed : [],
    toolsUsed: Array.isArray(input.toolsUsed) ? input.toolsUsed : [],
    decision: input.decision || null,
    evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds : [],
    safetyEvents: Array.isArray(input.safetyEvents) ? input.safetyEvents : [],
    cost: {
      inputTokens: Number(input.inputTokens || 0),
      outputTokens: Number(input.outputTokens || 0),
      latencyMs: Number(input.latencyMs || 0),
    },
  };
}

function evaluateAgentAuditTrace(trace = {}) {
  const spans = Array.isArray(trace.spans) ? trace.spans : [];
  const issues = [];
  const budgetIssues = [];

  if (!trace.runId) issues.push('missing_run_id');
  if (spans.length === 0) issues.push('missing_spans');
  if (!spans.some((span) => span.stage === 'input')) issues.push('missing_input_span');
  if (!spans.some((span) => span.stage === 'decision')) issues.push('missing_decision_span');
  if (spans.some((span) => !span.promptHash && span.stage === 'input')) issues.push('input_prompt_hash_required');
  if (spans.some((span) => span.toolsUsed?.length && !span.evidenceIds?.length)) issues.push('tool_span_requires_evidence_ids');
  if (spans.some((span) => span.dataAccessed?.length && !span.evidenceIds?.length)) issues.push('data_access_requires_evidence_ids');

  const totalTokens = spans.reduce((sum, span) => sum + (span.cost?.inputTokens || 0) + (span.cost?.outputTokens || 0), 0);
  const totalLatencyMs = spans.reduce((sum, span) => sum + (span.cost?.latencyMs || 0), 0);
  const rootInputTokens = spans
    .filter((span) => span.stage === 'input')
    .reduce((sum, span) => sum + (span.cost?.inputTokens || 0), 0);
  const downstreamTokens = Math.max(0, totalTokens - rootInputTokens);
  const downstreamActions = spans.filter((span) => (
    span.stage === 'tool' || (Array.isArray(span.toolsUsed) && span.toolsUsed.length > 0)
  )).length;
  const tokenAmplificationRatio = rootInputTokens > 0
    ? Number((totalTokens / rootInputTokens).toFixed(4))
    : null;
  const budget = trace.budget && typeof trace.budget === 'object' ? trace.budget : {};

  if (Number.isFinite(Number(budget.maxTotalTokens)) && totalTokens > Number(budget.maxTotalTokens)) {
    budgetIssues.push('max_total_tokens_exceeded');
  }
  if (
    tokenAmplificationRatio !== null
    && Number.isFinite(Number(budget.maxTokenAmplification))
    && tokenAmplificationRatio > Number(budget.maxTokenAmplification)
  ) {
    budgetIssues.push('max_token_amplification_exceeded');
  }
  if (
    Number.isFinite(Number(budget.maxDownstreamActions))
    && downstreamActions > Number(budget.maxDownstreamActions)
  ) {
    budgetIssues.push('max_downstream_actions_exceeded');
  }

  return {
    decision: budgetIssues.length ? 'deny' : issues.length ? 'warn' : 'allow',
    issues: issues.concat(budgetIssues),
    budgetIssues,
    totals: {
      spans: spans.length,
      totalTokens,
      rootInputTokens,
      downstreamTokens,
      downstreamActions,
      tokenAmplificationRatio,
      totalLatencyMs,
      safetyEvents: spans.reduce((sum, span) => sum + (span.safetyEvents?.length || 0), 0),
    },
  };
}

module.exports = {
  buildAgentAuditSpan,
  evaluateAgentAuditTrace,
};
