#!/usr/bin/env node
'use strict';

/**
 * Structured output for dashboard RAG answers.
 * Schema: { answer, citations[], grounded, confidence, abstain_reason? }
 */

const STRUCTURED_ANSWER_SCHEMA = Object.freeze({
  type: 'object',
  required: ['answer', 'citations', 'grounded', 'confidence'],
  properties: {
    answer: { type: 'string' },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          index: { type: 'number' },
        },
      },
    },
    grounded: { type: 'boolean' },
    confidence: { type: 'number' },
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
    const idOk = id && (sourceIds.has(id) || sourceIndexes.has(id) || /^\[\d+\]$/.test(id));
    const indexOk = Number.isFinite(index) && index >= 1 && index <= (sources.length || index);
    if (sources.length > 0 && !idOk && !indexOk) {
      errors.push(`citation_unknown:${id || index}`);
    }
    citations.push({
      id: id || String(index),
      title: typeof c.title === 'string' ? c.title : undefined,
      index: Number.isFinite(index) ? index : undefined,
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
  const grounded = citations.length > 0 || (sources.length > 0 && answer.length > 0 && !/do not have|not enough|no relevant|cannot determine/i.test(answer));
  return validateStructuredAnswer({
    answer: answer || 'No answer generated.',
    citations,
    grounded: Boolean(grounded && sources.length > 0),
    confidence: citations.length ? 0.6 : (sources.length ? 0.4 : 0.2),
    abstain_reason: sources.length ? undefined : 'no_sources_retrieved',
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

function parseStrictStructuredAnswer(text, sources = []) {
  const json = extractJsonObject(text);
  if (!json) {
    return {
      ok: false,
      errors: ['invalid_json'],
      value: null,
      mode: 'invalid',
      schema: STRUCTURED_ANSWER_SCHEMA,
    };
  }
  const validated = validateStructuredAnswer(json, sources);
  return {
    ...validated,
    mode: validated.ok ? 'json' : 'json_invalid',
  };
}

function buildStructuredRepairPrompt(text, sources = [], errors = []) {
  const allowedSources = sources.map((source, index) => ({
    id: String(source.id || index + 1),
    index: index + 1,
  }));
  return [
    'Repair the response into valid JSON. Do not add facts or citations.',
    structuredOutputInstruction(),
    `Allowed citation sources: ${JSON.stringify(allowedSources)}.`,
    `Validation errors: ${JSON.stringify(errors)}.`,
    'Response to repair:',
    String(text || '').slice(0, 6000),
  ].join('\n');
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

module.exports = {
  STRUCTURED_ANSWER_SCHEMA,
  extractJsonObject,
  validateStructuredAnswer,
  coerceFreeTextToStructured,
  parseModelStructuredAnswer,
  parseStrictStructuredAnswer,
  buildStructuredRepairPrompt,
  structuredOutputInstruction,
  clampConfidence,
};
