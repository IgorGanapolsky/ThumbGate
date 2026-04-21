'use strict';

/**
 * scripts/lesson-canonical.js
 *
 * Cross-session canonical-form hashing for lessons / memory records.
 *
 * Why this exists:
 *   Before this module, deduplication of promoted lessons relied on:
 *     1. `findDuplicateMemory()` — exact `sourceFeedbackId` match (catches
 *        capture-retry races, misses everything else).
 *     2. `findSimilarLesson()` in lesson-synthesis — Jaccard token overlap
 *        with a 0.6 threshold on raw title+content (catches near-twins in
 *        the same session, drifts with rewording).
 *     3. `findDuplicate()` in lesson-db — exact `LOWER(TRIM(whatToChange))`
 *        string match plus tag overlap (breaks the moment punctuation,
 *        pronouns, or articles differ).
 *
 *   All three are first-pass filters. None normalize the text before
 *   hashing, so the same root-cause promoted twice by two different
 *   worktrees (e.g. "Don't force-push main." vs "never force push main!!")
 *   survives as two lessons, inflates occurrences counters, and distorts
 *   the Bayes-optimal gate's base-rate calibration.
 *
 *   This module provides a stable cross-session content signature by:
 *     - Lowercasing and stripping punctuation,
 *     - Removing a small stop-word list,
 *     - Collapsing whitespace,
 *     - Light plural stemming (trailing 's' where safe),
 *     - Hashing a deterministic join of the normalized whatToChange /
 *       content / title fields together with a sorted tag list.
 *
 *   Two lessons that differ only in phrasing collapse to the same hash;
 *   lessons that differ in substance or tags do not.
 *
 * Design notes:
 *   - Pure functions, no IO.
 *   - SHA-256 via node:crypto keeps the signature short and safe to log.
 *   - `findCanonicalDuplicate` is O(N) over the memory log, which is
 *     fine at our scale (hundreds to low thousands of entries).
 */

const crypto = require('node:crypto');

// Small English stop-word list. Intentionally conservative — the goal is
// to defeat trivial wording drift, not to paraphrase every sentence.
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'done', 'doing',
  'have', 'has', 'had',
  'i', 'you', 'we', 'they', 'he', 'she', 'it',
  'my', 'your', 'our', 'their', 'his', 'her', 'its',
  'and', 'or', 'but', 'so', 'if', 'then', 'than', 'because',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'from', 'by',
  'not', 'no',
]);

/**
 * Canonicalize a free-form string to a stable form that survives cosmetic
 * rewrites. Returns a single lowercase token string separated by spaces.
 */
function canonicalizeText(input) {
  if (input === null || input === undefined) return '';
  const raw = String(input);
  // 1. Lowercase + strip punctuation (keep word chars + whitespace).
  const stripped = raw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  // 2. Tokenize on whitespace, drop empties.
  const tokens = stripped.split(/\s+/).filter(Boolean);
  // 3. Drop stop words + trivially short tokens.
  const content = tokens.filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  // 4. Light singularize: drop trailing 's' from >=4-char tokens not ending
  //    in 'ss' (e.g. "rules" → "rule", but "pass" stays "pass").
  const stemmed = content.map((t) => {
    if (t.length >= 4 && t.endsWith('s') && !t.endsWith('ss')) {
      return t.slice(0, -1);
    }
    return t;
  });
  // 5. Sort to make the signature order-invariant for bag-of-words dedup.
  //    Two lessons that discuss the same tokens in different sentence order
  //    must collapse. This loses sequence signal but our target is dedup,
  //    not classification. Explicit localeCompare keeps the sort stable
  //    across Node versions that default to implementation-defined
  //    comparison for non-ASCII tokens (SonarCloud S2871).
  stemmed.sort((a, b) => a.localeCompare(b));
  return stemmed.join(' ');
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(
    tags
      .map((t) => String(t || '').trim().toLowerCase())
      .filter(Boolean),
  )].sort((a, b) => a.localeCompare(b));
}

/**
 * Build a stable content signature for a lesson / memory record.
 *
 * Pulls whichever of the following fields are present:
 *   - whatToChange, whatWentWrong, whatWorked  (feedback-loop schema)
 *   - title, content                           (memory-log.jsonl schema)
 *   - context                                  (capture-feedback schema)
 *
 * All fields are concatenated into one blob and canonicalized once, so a
 * record that stores its content under `whatToChange` hashes identically
 * to one that surfaces the same text under `content`. Cross-schema dedup
 * matters because feedback-loop and capture-feedback write slightly
 * different shapes for the same underlying lesson.
 *
 * The tag list is appended separately so two lessons with identical text
 * but different tags remain distinct.
 */
function lessonCanonicalSignature(lesson) {
  if (!lesson || typeof lesson !== 'object') return '';
  const blob = [
    lesson.whatToChange,
    lesson.whatWentWrong,
    lesson.whatWorked,
    lesson.title,
    lesson.content,
    lesson.context,
  ].filter(Boolean).join(' ');
  const textSig = canonicalizeText(blob);
  const tagSig = normalizeTags(lesson.tags).join(',');
  return textSig ? `${textSig}::${tagSig}` : '';
}

/**
 * Short deterministic hash of a lesson's canonical signature. 16 hex chars
 * (64 bits) is ample for our scale and keeps log lines readable. Returns
 * null when the record carries no normalized content (all fields empty) —
 * hashing an empty string would create a "dedup magnet" that collapses all
 * content-free records together, which is worse than no dedup at all.
 */
function canonicalHash(lesson) {
  const sig = lessonCanonicalSignature(lesson);
  if (!sig) return null;
  return crypto.createHash('sha256').update(sig).digest('hex').slice(0, 16);
}

/**
 * Scan a list of existing lesson records for one whose canonical hash
 * matches `lesson`. Returns the first match or null. The existing record's
 * stored `canonicalHash` field is preferred; absent that, the hash is
 * recomputed on the fly so this works against legacy entries.
 *
 * Signal filter: when `lesson.signal` is present, only matches with the
 * same signal are considered — a positive lesson about "force-push" must
 * not merge with a negative lesson about the same action.
 */
function findCanonicalDuplicate(memoryEntries, lesson) {
  if (!Array.isArray(memoryEntries) || memoryEntries.length === 0) return null;
  const hash = canonicalHash(lesson);
  if (!hash) return null;

  const signalFilter = lesson.signal ? String(lesson.signal).toLowerCase() : null;

  for (const entry of memoryEntries) {
    if (!entry || typeof entry !== 'object') continue;
    const entrySignal = entry.signal ? String(entry.signal).toLowerCase() : null;
    if (signalFilter && entrySignal && entrySignal !== signalFilter) continue;

    const entryHash = entry.canonicalHash || canonicalHash(entry);
    if (entryHash && entryHash === hash) {
      return entry;
    }
  }
  return null;
}

module.exports = {
  canonicalizeText,
  normalizeTags,
  lessonCanonicalSignature,
  canonicalHash,
  findCanonicalDuplicate,
  STOP_WORDS,
};
