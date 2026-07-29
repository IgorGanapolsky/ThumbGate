#!/usr/bin/env node
'use strict';

/**
 * Lesson hygiene — keep raw hook transport payloads out of the lesson RAG.
 *
 * Raw PreToolUse stdin envelopes (JSON blobs carrying session_id /
 * transcript_path / hookEventName) were captured verbatim as feedback docs.
 * Because the retrieval query used to be JSON-shaped too, those junk docs
 * lexically outranked real lessons. This module is the shared junk detector
 * for both the ingestion gate (quarantine at write time) and the retrieval
 * post-filter (drop at render time).
 *
 * Dependency-free by design: it must be requireable from the PreToolUse hot
 * path and from ingestion without pulling in any other module.
 */

const RAW_PAYLOAD_MARKER = /"session_id"|"hookEventName"|transcript_path/;

// A doc that quotes a payload while explaining it is a real lesson. We only
// call it junk when the text OUTSIDE JSON-looking spans carries less than
// this much prose.
const MIN_PROSE_CHARS = 100;

/**
 * Remove JSON-looking spans (balanced or dangling {...} / [...] regions) and
 * return the remaining prose. A dangling opener (truncated payload) swallows
 * the rest of the string — a cut-off envelope has no prose after the brace.
 */
function stripJsonSpans(text) {
  const s = String(text || '');
  let out = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '{' || ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === '}' || ch === ']') {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (depth === 0) out += ch;
  }
  return out;
}

/**
 * True when `text` is a raw hook transport payload rather than a lesson:
 * it carries a transport marker AND has fewer than MIN_PROSE_CHARS of prose
 * outside JSON-looking spans.
 */
function isRawHookPayload(text) {
  const raw = String(text || '');
  if (!raw.trim()) return false;
  if (!RAW_PAYLOAD_MARKER.test(raw)) return false;
  const prose = stripJsonSpans(raw).replace(/\s+/g, ' ').trim();
  return prose.length < MIN_PROSE_CHARS;
}

function defaultTextOf(item) {
  if (!item || typeof item !== 'object') return '';
  return item.text || item.content || item.whatWentWrong || '';
}

/**
 * Drop retrieved items whose primary text is a raw payload. Order preserved;
 * never throws (a bad item is treated as junk-free only if its text is clean).
 */
function filterRetrievedLessons(items, textOf) {
  if (!Array.isArray(items)) return [];
  const extract = typeof textOf === 'function' ? textOf : defaultTextOf;
  return items.filter((item) => {
    try {
      return !isRawHookPayload(extract(item));
    } catch {
      return true;
    }
  });
}

module.exports = {
  isRawHookPayload,
  filterRetrievedLessons,
  stripJsonSpans,
  MIN_PROSE_CHARS,
};
