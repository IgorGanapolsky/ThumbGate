#!/usr/bin/env node
'use strict';

/**
 * Structured output for dashboard RAG answers.
 * Schema: { answer, citations[], grounded, confidence, abstain_reason? }
 */

const STRUCTURED_ANSWER_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'citations', 'grounded', 'confidence'],
  properties: {
    answer: { type: 'string' },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          index: { type: 'number' },
        },
      },
    },
    grounded: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    abstain_reason: { type: 'string' },
  },
});

function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  // Strip markdown fences if present.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Validate and normalise a structured RAG answer against retrieved sources.
 */
function validateStructuredAnswer(payload, sources = []) {
  const errors = [];
  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: ['not_an_object'], value: null };
  }

  const answer = typeof payload.answer === 'string' ? payload.answer.trim() : '';
  if (!answer) errors.push('missing_answer');

  const citationsIn = Array.isArray(payload.citations) ? payload.citations : null;
  if (!citationsIn) errors.push('missing_citations');

  const sourceIds = new Set(
    (sources || []).map((s) => String(s.id || s)).filter(Boolean),
  );
  const sourceIndexes = new Set(
    (sources || []).map((_, i) => String(i + 1)),
  );

  if (payload.confidence === undefined || payload.confidence === null) {
    errors.push('missing_confidence');
  }

  const citations = [];
  for (const c of citationsIn || []) {
    if (!c || typeof c !== 'object') {
      errors.push('citation_not_object');
      continue;
    }
    const id = String(c.id || c.sourceId || '').trim();
    const index = c.index != null ? Number(c.index) : null;
    if (!id && !Number.isFinite(index)) {
      errors.push('citation_missing_id');
      continue;
    }
    // Bracket form "[n]" is only valid when n is a real 1-based source index.
    let bracketOk = false;
    const bracketMatch = id && id.match(/^\[(\d+)\]$/);
    if (bracketMatch) {
      const n = Number(bracketMatch[1]);
      bracketOk = Number.isFinite(n) && n >= 1 && n <= sources.length;
    }
    const idOk = Boolean(id && (sourceIds.has(id) || sourceIndexes.has(id) || bracketOk));
    const indexOk = Number.isFinite(index) && index >= 1 && index <= sources.length;
    if (sources.length > 0 && !idOk && !indexOk) {
      errors.push(`citation_unknown:${id || index}`);
      continue; // do not accept citations that point outside the retrieved set
    }
    citations.push({
      id: id || String(index),
      title: typeof c.title === 'string' ? c.title : undefined,
      index: Number.isFinite(index) ? index : (bracketMatch ? Number(bracketMatch[1]) : undefined),
    });
  }

  let grounded = payload.grounded;
  if (typeof grounded !== 'boolean') {
    grounded = citations.length > 0 && sources.length > 0;
    errors.push('grounded_coerced');
  }

  // Consistency: if no sources, grounded must be false.
  if (sources.length === 0 && grounded === true) {
    grounded = false;
    errors.push('grounded_forced_false_empty_sources');
  }
  if (grounded === true && citations.length === 0) {
    grounded = false;
    errors.push('grounded_forced_false_no_valid_citations');
  }

  const confidence = clampConfidence(payload.confidence);
  const abstain_reason = typeof payload.abstain_reason === 'string'
    ? payload.abstain_reason
    : undefined;

  const hardErrors = errors.filter((e) => !e.startsWith('grounded_') && e !== 'grounded_coerced');
  const value = {
    answer,
    citations,
    grounded,
    confidence,
    ...(abstain_reason ? { abstain_reason } : {}),
  };

  return {
    ok: hardErrors.length === 0 && Boolean(answer),
    errors,
    value,
    schema: STRUCTURED_ANSWER_SCHEMA,
  };
}

/**
 * Build a free-text answer into structured form when the model ignored JSON.
 */
function coerceFreeTextToStructured(text, sources = []) {
  const answer = String(text || '').trim();
  const citeMatches = [...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const citations = [];
  for (const idx of new Set(citeMatches)) {
    const src = sources[idx - 1];
    if (src) {
      citations.push({ id: String(src.id || idx), title: src.title, index: idx });
    } else {
      citations.push({ id: String(idx), index: idx });
    }
  }
  const grounded = citations.length > 0;
  return validateStructuredAnswer({
    answer: answer || 'No answer generated.',
    citations,
    grounded: Boolean(grounded && sources.length > 0),
    confidence: citations.length ? 0.6 : (sources.length ? 0.4 : 0.2),
    abstain_reason: sources.length
      ? (citations.length ? undefined : 'model_output_missing_valid_citation')
      : 'no_sources_retrieved',
  }, sources);
}

/**
 * Parse model text into structured answer (JSON preferred, free-text fallback).
 */
function parseModelStructuredAnswer(text, sources = []) {
  const json = extractJsonObject(text);
  if (json) {
    const validated = validateStructuredAnswer(json, sources);
    if (validated.ok) return { ...validated, mode: 'json' };
    // Partial JSON — still return validated value with mode
    if (validated.value?.answer) return { ...validated, mode: 'json_partial' };
  }
  const coerced = coerceFreeTextToStructured(text, sources);
  return { ...coerced, mode: 'free_text_coerced' };
}

function structuredOutputInstruction() {
  return [
    'Respond with ONLY valid JSON (no markdown fences) matching this schema:',
    '{"answer": string, "citations": [{"id": string, "index"?: number, "title"?: string}],',
    '"grounded": boolean, "confidence": number (0-1), "abstain_reason"?: string}.',
    'citations[].index is the 1-based lesson number from the context block.',
    'If the context is insufficient, set grounded=false, confidence low, and explain in answer.',
  ].join(' ');
}

// ---------------------------------------------------------------------------
// Deterministic answer-quality proxies for RAG regression gates.
// ---------------------------------------------------------------------------

const ANSWER_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'before', 'by', 'for', 'from',
  'has', 'have', 'how', 'i', 'in', 'is', 'it', 'of', 'on', 'or', 'our',
  'should', 'that', 'the', 'their', 'this', 'to', 'was', 'we', 'what', 'when',
  'where', 'which', 'with', 'you', 'your',
]);

const ANSWER_NEGATION_PATTERN = /\b(?:no|not|never|avoid|without|cannot|can't|don't|do not|mustn't|prohibited|blocked)\b/i;

function roundMetric(value) {
  return Number(Number(value || 0).toFixed(6));
}

function answerTokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\[[a-z0-9:_-]+\]/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !ANSWER_STOP_WORDS.has(token));
}

function answerTokenSet(text) {
  return new Set(answerTokens(text));
}

function tokenF1(left, right) {
  const a = answerTokenSet(left);
  const b = answerTokenSet(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  if (!overlap) return 0;
  const precision = overlap / a.size;
  const recall = overlap / b.size;
  return (2 * precision * recall) / (precision + recall);
}

function queryCoverage(query, answer) {
  const queryTokens = answerTokenSet(query);
  const answerSet = answerTokenSet(answer);
  if (!queryTokens.size) return 0;
  let covered = 0;
  for (const token of queryTokens) if (answerSet.has(token)) covered += 1;
  return covered / queryTokens.size;
}

function splitAnswerClaims(answer) {
  return String(answer || '')
    .split(/(?:\n+|(?<=[.!?])\s+)/)
    .map((claim) => claim.replace(/^[-*]\s*/, '').trim())
    .filter((claim) => answerTokens(claim).length > 0);
}

function normalizeAnswerContexts(contexts = []) {
  return (Array.isArray(contexts) ? contexts : [])
    .map((context, index) => ({
      id: String(context?.id || context?.sourceId || context?.documentId || `context-${index}`),
      text: String(context?.text || context?.content || context?.rawContent || ''),
    }))
    .filter((context) => context.text.trim());
}

function numericTokens(text) {
  return String(text || '')
    .replace(/\[[a-z0-9:_-]+\]/gi, ' ')
    .match(/\b\d+(?:\.\d+)?%?\b/g) || [];
}

function claimSupportScore(claim, contextText) {
  const claimText = String(claim || '').trim();
  const evidenceText = String(contextText || '').trim();
  if (!claimText || !evidenceText) return 0;

  const claimNumbers = numericTokens(claimText);
  if (claimNumbers.some((number) => !numericTokens(evidenceText).includes(number))) return 0;

  let score = tokenF1(claimText, evidenceText);
  const normalizedClaim = claimText.toLowerCase().replace(/\s+/g, ' ');
  const normalizedEvidence = evidenceText.toLowerCase().replace(/\s+/g, ' ');
  if (normalizedEvidence.includes(normalizedClaim)) score = 1;

  const claimNegated = ANSWER_NEGATION_PATTERN.test(claimText);
  const evidenceNegated = ANSWER_NEGATION_PATTERN.test(evidenceText);
  if (claimNegated !== evidenceNegated && score >= 0.35) score *= 0.2;
  return roundMetric(Math.max(0, Math.min(1, score)));
}

function extractCitationIds(answer, citations = []) {
  const ids = [];
  for (const citation of Array.isArray(citations) ? citations : []) {
    const id = typeof citation === 'string'
      ? citation
      : citation?.id || citation?.sourceId || citation?.documentId;
    if (id) ids.push(String(id));
  }
  const pattern = /\[([a-z0-9:_-]+)\]/gi;
  let match;
  while ((match = pattern.exec(String(answer || ''))) !== null) ids.push(match[1]);
  return [...new Set(ids)];
}

function evaluateAnswerQuality(sample = {}, options = {}) {
  const answer = String(sample.answer || sample.response || '');
  const query = String(sample.query || sample.question || '');
  const contexts = normalizeAnswerContexts(sample.contexts || sample.sources);
  const claims = splitAnswerClaims(answer);
  const supportThreshold = Number(options.supportThreshold ?? 0.4);

  const claimResults = claims.map((claim) => {
    const scored = contexts
      .map((context) => ({
        contextId: context.id,
        score: claimSupportScore(claim, context.text),
      }))
      .sort((left, right) => right.score - left.score);
    const best = scored[0] || { contextId: null, score: 0 };
    return {
      claim,
      supported: best.score >= supportThreshold,
      supportScore: best.score,
      contextId: best.contextId,
    };
  });

  const faithfulness = claims.length
    ? claimResults.filter((claim) => claim.supported).length / claims.length
    : 0;
  const citationIds = extractCitationIds(answer, sample.citations);
  const knownIds = new Set(contexts.map((context) => context.id));
  const validCitationIds = citationIds.filter((id) => knownIds.has(id));
  const citationPrecision = citationIds.length ? validCitationIds.length / citationIds.length : 0;
  const groundedness = faithfulness * (0.7 + 0.3 * citationPrecision);
  const referenceScore = sample.referenceAnswer
    ? tokenF1(answer, sample.referenceAnswer)
    : null;
  const answerRelevance = referenceScore === null
    ? queryCoverage(query, answer)
    : (0.3 * queryCoverage(query, answer)) + (0.7 * referenceScore);

  const thresholds = {
    minFaithfulness: Number(options.minFaithfulness ?? 0.8),
    minGroundedness: Number(options.minGroundedness ?? 0.75),
    minAnswerRelevance: Number(options.minAnswerRelevance ?? 0.3),
  };
  const failures = [];
  if (faithfulness < thresholds.minFaithfulness) failures.push('faithfulness');
  if (groundedness < thresholds.minGroundedness) failures.push('groundedness');
  if (answerRelevance < thresholds.minAnswerRelevance) failures.push('answer_relevance');

  return {
    mode: 'deterministic-lexical-proxy',
    limitations: [
      'Lexical support is not semantic entailment.',
      'A calibrated judge or human holdout is still required for nuanced claims.',
    ],
    metrics: {
      faithfulness: roundMetric(faithfulness),
      groundedness: roundMetric(groundedness),
      answerRelevance: roundMetric(answerRelevance),
      citationPrecision: roundMetric(citationPrecision),
    },
    claims: claimResults,
    citations: {
      cited: citationIds,
      valid: validCitationIds,
      invalid: citationIds.filter((id) => !knownIds.has(id)),
    },
    thresholds,
    failures,
    passed: failures.length === 0,
  };
}

function normalizeJudgeDiagnostic(result) {
  const source = result?.metrics || result;
  if (!source || typeof source !== 'object') return null;
  const metrics = {
    faithfulness: Number(source.faithfulness),
    groundedness: Number(source.groundedness),
    answerRelevance: Number(source.answerRelevance ?? source.answer_relevance),
  };
  if (Object.values(metrics).some((value) => !Number.isFinite(value) || value < 0 || value > 1)) return null;
  return { metrics, rationale: String(result.rationale || '').slice(0, 500) };
}

async function evaluateAnswerQualityWithJudge(sample = {}, options = {}) {
  const deterministic = evaluateAnswerQuality(sample, options);
  if (typeof options.judge !== 'function') {
    return { ...deterministic, judgeDiagnostic: null };
  }
  try {
    const judgeDiagnostic = normalizeJudgeDiagnostic(await options.judge(sample));
    return { ...deterministic, judgeDiagnostic };
  } catch {
    return { ...deterministic, judgeDiagnostic: null };
  }
}

module.exports = {
  STRUCTURED_ANSWER_SCHEMA,
  extractJsonObject,
  validateStructuredAnswer,
  coerceFreeTextToStructured,
  parseModelStructuredAnswer,
  structuredOutputInstruction,
  clampConfidence,
  answerTokens,
  tokenF1,
  queryCoverage,
  splitAnswerClaims,
  claimSupportScore,
  extractCitationIds,
  evaluateAnswerQuality,
  evaluateAnswerQualityWithJudge,
  normalizeJudgeDiagnostic,
};
