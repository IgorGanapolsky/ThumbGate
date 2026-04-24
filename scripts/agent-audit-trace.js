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

  if (!trace.runId) issues.push('missing_run_id');
  if (spans.length === 0) issues.push('missing_spans');
  if (!spans.some((span) => span.stage === 'input')) issues.push('missing_input_span');
  if (!spans.some((span) => span.stage === 'decision')) issues.push('missing_decision_span');
  if (spans.some((span) => !span.promptHash && span.stage === 'input')) issues.push('input_prompt_hash_required');
  if (spans.some((span) => span.toolsUsed?.length && !span.evidenceIds?.length)) issues.push('tool_span_requires_evidence_ids');
  if (spans.some((span) => span.dataAccessed?.length && !span.evidenceIds?.length)) issues.push('data_access_requires_evidence_ids');

  const totalTokens = spans.reduce((sum, span) => sum + (span.cost?.inputTokens || 0) + (span.cost?.outputTokens || 0), 0);
  const totalLatencyMs = spans.reduce((sum, span) => sum + (span.cost?.latencyMs || 0), 0);

  return {
    decision: issues.length ? 'warn' : 'allow',
    issues,
    totals: {
      spans: spans.length,
      totalTokens,
      totalLatencyMs,
      safetyEvents: spans.reduce((sum, span) => sum + (span.safetyEvents?.length || 0), 0),
    },
  };
}

module.exports = {
  buildAgentAuditSpan,
  evaluateAgentAuditTrace,
};
