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

const ENVELOPE_VERSION = '2026-07-31.p0.1';

function newTraceId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `tr_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * @param {object} [seed]
 * @returns {object}
 */
function createRequestEnvelope(seed = {}) {
  const startedAt = Number.isFinite(seed.startedAt) ? seed.startedAt : Date.now();
  return {
    envelopeVersion: ENVELOPE_VERSION,
    traceId: seed.traceId || newTraceId(),
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
  return {
    ...envelope,
    ...patch,
    endedAt,
    latencyMs: Math.max(0, endedAt - startedAt),
    outcome: patch.outcome || envelope?.outcome || 'ok',
  };
}

/**
 * Compact retrieval summary for the envelope (no lesson bodies).
 * @param {Array<object>} rows
 * @param {object} [meta]
 */
function summarizeRetrieval(rows = [], meta = {}) {
  const top = (rows || []).slice(0, 8).map((r, i) => ({
    rank: i + 1,
    id: r.id || r.memoryId || null,
    score: Number(r.relevanceScore ?? r.rerankedScore ?? r.score ?? null),
    signal: r.signal || null,
  }));
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
  createRequestEnvelope,
  finalizeRequestEnvelope,
  summarizeRetrieval,
  estimateTokensFromText,
  estimateCostCents,
};
