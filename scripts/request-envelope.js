'use strict';

/**
 * Production request envelope — one schema for LLM + retrieval observability.
 *
 * Every dashboard chat / routed generation path should create an envelope at
 * start and finalize it before return so latency, cost, retrieval, and
 * structured-output status are greppable from one object.
 *
 * Privacy: never store full prompts/tool payloads here; use redacted previews only.
 */

const crypto = require('node:crypto');
const {
  buildAgentAuditSpan,
  evaluateAgentAuditTrace,
} = require('./agent-audit-trace');

const ENVELOPE_VERSION = '2026-07-31.p0.1';

function newTraceId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `tr_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function hashSensitiveText(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

/**
 * @param {object} [seed]
 * @returns {object}
 */
function createRequestEnvelope(seed = {}) {
  const startedAt = Number.isFinite(seed.startedAt) ? seed.startedAt : Date.now();
  const traceId = seed.traceId || newTraceId();
  const auditTrace = seed.promptHash
    ? {
      runId: traceId,
      spans: [buildAgentAuditSpan({
        runId: traceId,
        spanId: `${traceId}:input`,
        stage: 'input',
        promptHash: seed.promptHash,
        model: seed.model || null,
      })],
    }
    : null;
  return {
    envelopeVersion: ENVELOPE_VERSION,
    traceId,
    startedAt,
    endedAt: null,
    latencyMs: null,
    surface: seed.surface || 'unknown',
    model: seed.model || null,
    tier: seed.tier || null,
    provider: seed.provider || null,
    inputTokens: seed.inputTokens ?? null,
    outputTokens: seed.outputTokens ?? null,
    estimatedCostCents: seed.estimatedCostCents ?? null,
    budget: seed.budget || null,
    retrieval: seed.retrieval || null,
    structured: seed.structured || null,
    qualityTier: seed.qualityTier || null,
    outcome: seed.outcome || 'pending',
    error: seed.error || null,
    auditTrace,
  };
}

/**
 * Finalize timing + optional fields. Pure-ish: returns a new object.
 * @param {object} envelope
 * @param {object} [patch]
 */
function finalizeRequestEnvelope(envelope, patch = {}) {
  const endedAt = Number.isFinite(patch.endedAt) ? patch.endedAt : Date.now();
  const startedAt = Number(envelope?.startedAt) || endedAt;
  const finalized = {
    ...envelope,
    ...patch,
    endedAt,
    latencyMs: Math.max(0, endedAt - startedAt),
    outcome: patch.outcome || envelope?.outcome || 'ok',
  };

  if (envelope?.auditTrace?.runId && Array.isArray(envelope.auditTrace.spans)) {
    const evidenceIds = (patch.retrieval?.top || [])
      .map((row) => row?.id)
      .filter(Boolean);
    const priorSpans = envelope.auditTrace.spans
      .filter((span) => span?.stage !== 'decision');
    const decisionSpan = buildAgentAuditSpan({
      runId: envelope.auditTrace.runId,
      spanId: `${envelope.auditTrace.runId}:decision`,
      parentSpanId: priorSpans[0]?.spanId || null,
      stage: 'decision',
      model: finalized.model,
      decision: finalized.outcome,
      dataAccessed: evidenceIds.length ? ['retrieved_lessons'] : [],
      evidenceIds,
      safetyEvents: finalized.error ? [finalized.error] : [],
      inputTokens: finalized.inputTokens,
      outputTokens: finalized.outputTokens,
      latencyMs: finalized.latencyMs,
    });
    const auditTrace = {
      runId: envelope.auditTrace.runId,
      spans: [...priorSpans, decisionSpan],
    };
    finalized.auditTrace = {
      ...auditTrace,
      evaluation: evaluateAgentAuditTrace(auditTrace),
    };
  }

  return finalized;
}

/**
 * Compact retrieval summary for the envelope (no lesson bodies).
 * @param {Array<object>} rows
 * @param {object} [meta]
 */
function summarizeRetrieval(rows = [], meta = {}) {
  const top = (rows || []).slice(0, 8).map((r, i) => {
    const rawScore = r.rerankedScore ?? r.relevanceScore ?? r.score;
    const numericScore = Number(rawScore);
    return {
      rank: i + 1,
      id: r.id || r.memoryId || null,
      score: rawScore == null || !Number.isFinite(numericScore) ? null : numericScore,
      signal: r.signal || null,
    };
  });
  return {
    strategy: meta.strategy || meta.retrievalStrategy || null,
    count: Array.isArray(rows) ? rows.length : 0,
    qualityTier: meta.qualityTier || null,
    degradedReasons: meta.degradedReasons || [],
    top,
  };
}

/**
 * Estimate tokens from text length (rough, offline-safe).
 * @param {string} text
 */
function estimateTokensFromText(text) {
  const s = String(text || '');
  if (!s) return 0;
  return Math.max(1, Math.ceil(s.length / 4));
}

/**
 * Rough USD cents from token counts using Sonnet-ish defaults (conservative).
 * @param {{ inputTokens?: number, outputTokens?: number, inputPerM?: number, outputPerM?: number }} opts
 */
function estimateCostCents(opts = {}) {
  const input = Number(opts.inputTokens) || 0;
  const output = Number(opts.outputTokens) || 0;
  const inputPerM = Number(opts.inputPerM) || 3;
  const outputPerM = Number(opts.outputPerM) || 15;
  const usd = (input / 1e6) * inputPerM + (output / 1e6) * outputPerM;
  return Number((usd * 100).toFixed(4));
}

module.exports = {
  ENVELOPE_VERSION,
  newTraceId,
  hashSensitiveText,
  createRequestEnvelope,
  finalizeRequestEnvelope,
  summarizeRetrieval,
  estimateTokensFromText,
  estimateCostCents,
};
