'use strict';

/**
 * Cross-encoder reranker for lesson retrieval.
 *
 * Unlike the bi-encoders already in use (Jaccard + bigram Jaccard), a
 * cross-encoder processes the (query, lesson) pair jointly — so it can
 * catch relevance signals that independent scoring misses:
 *
 *   - Field-weighted BM25: a query term in `whatWentWrong` is worth more
 *     than the same term in `tags`
 *   - Synonym/alias expansion: "force-push" ↔ "push --force", "deploy" ↔
 *     "deployment", etc.
 *   - Signal coherence: failure-sounding queries boost negative-signal lessons
 *   - Tool name joint scoring: query toolName × lesson toolsUsed
 *   - Score blending: reranked score is blended with the original retrieval
 *     score so we never fully discard the bi-encoder's signal
 *
 * Usage:
 *   const { rerankLessons } = require('./lesson-reranker');
 *   const reranked = rerankLessons(query, candidates, { topK: 5, toolName });
 */

// BM25 hyper-parameters
const BM25_K1 = 1.5;   // term saturation
const BM25_B  = 0.75;  // length normalisation

// Weight given to each lesson field when scoring a (query, lesson) pair.
// Higher weight = query terms appearing in that field contribute more to score.
const FIELD_WEIGHTS = {
  whatWentWrong:  3.0,
  whatToChange:   2.5,
  howToAvoid:     2.0,
  whatWorked:     2.0,
  summary:        1.5,
  content:        1.5,
  context:        1.2,
  title:          1.0,
  rootCause:      1.0,
  reasoning:      0.8,
  tags:           0.5,
  category:       0.4,
};

// Synonym clusters: any term in a group matches all others.
const SYNONYM_GROUPS = [
  ['force-push', 'force push', 'push --force', 'git push --force', 'force_push'],
  ['main', 'main branch', 'master', 'trunk', 'protected branch'],
  ['env', '.env', 'environment variable', 'env var', 'dotenv', 'secret'],
  ['deploy', 'deployment', 'ship', 'release', 'publish', 'rollout'],
  ['db', 'database', 'sqlite', 'postgres', 'postgresql', 'migration', 'migrate'],
  ['test', 'tests', 'test suite', 'spec', 'failing test', 'test failure'],
  ['ci', 'ci/cd', 'pipeline', 'github actions', 'workflow', 'build'],
  ['lint', 'linter', 'eslint', 'prettier', 'format'],
  ['auth', 'authentication', 'authorization', 'token', 'api key', 'credential'],
  ['delete', 'remove', 'rm', 'drop', 'destroy', 'wipe'],
  ['merge', 'pull request', 'pr', 'rebase', 'squash'],
];

// Regex patterns that indicate the query is about a failure/mistake.
const FAILURE_PATTERN = /fail|error|wrong|broken|mistake|bad|incorrect|problem|issue|bug|crash|broke|exception/i;

/**
 * Tokenise text into lowercase word-like tokens of length >= 2.
 * Hyphens and underscores are treated as delimiters so "force-push"
 * becomes ["force", "push"].
 * Exported so tests can verify expansion behaviour.
 */
function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')   // replace all non-word, non-space chars (incl. hyphens, dots) with space
    .split(/[\s_]+/)             // split on whitespace and underscores
    .filter((t) => t.length >= 2);
}

/**
 * Expand a set of query tokens with synonyms from SYNONYM_GROUPS.
 * Returns a deduplicated array of all terms (originals + expansions).
 */
function expandTerms(terms) {
  const expanded = new Set(terms);
  for (const term of terms) {
    for (const group of SYNONYM_GROUPS) {
      if (group.some((syn) => syn.split(/\s+/).some((w) => w === term || term.includes(w)))) {
        group.forEach((syn) => tokenize(syn).forEach((t) => expanded.add(t)));
      }
    }
  }
  return [...expanded];
}

/**
 * Extract the text value of a named field from a lesson candidate.
 * Handles both the flat structure from lesson-retrieval.js and the nested
 * { lesson: { whatWentWrong, ... } } structure from lesson-search.js.
 */
function getField(candidate, field) {
  const nested = candidate.lesson;
  const val = (nested && nested[field]) || candidate[field] || '';
  if (Array.isArray(val)) return val.join(' ');
  return String(val);
}

/**
 * Compute field-weighted BM25 scores for a list of candidates (BM25F variant).
 *
 * BM25F processes the (query, lesson) pair jointly: query terms are weighted
 * differently depending on which lesson field they appear in (via FIELD_WEIGHTS).
 * IDF is computed at document level (how many docs contain the term across any
 * field) so it stays positive regardless of field weights.
 *
 * Returns an array of { candidate, bm25Score } objects in the same order
 * as the input.
 */
function fieldWeightedBM25(queryTerms, candidates) {
  const N = candidates.length;
  if (N === 0) return [];

  const fieldEntries = Object.entries(FIELD_WEIGHTS);
  const fieldKeys = Object.keys(FIELD_WEIGHTS);

  // Precompute per-document, per-field token arrays (avoid re-tokenising)
  const docFieldTokens = candidates.map((candidate) => {
    const fieldMap = {};
    for (const field of fieldKeys) {
      fieldMap[field] = tokenize(getField(candidate, field));
    }
    return fieldMap;
  });

  // Per-field average token lengths across all documents
  const avgFieldLen = {};
  for (const field of fieldKeys) {
    const total = docFieldTokens.reduce((sum, d) => sum + d[field].length, 0);
    avgFieldLen[field] = total / N || 1;   // fallback to 1 to avoid /0
  }

  // Document-level df: count of documents that contain each term (any field).
  // Keeping df as a plain count (not field-weighted) ensures IDF is always positive.
  const df = new Map();
  for (let i = 0; i < N; i++) {
    const seenInDoc = new Set();
    for (const field of fieldKeys) {
      for (const tok of docFieldTokens[i][field]) {
        if (!seenInDoc.has(tok)) {
          df.set(tok, (df.get(tok) || 0) + 1);
          seenInDoc.add(tok);
        }
      }
    }
  }

  return candidates.map((candidate, i) => {
    let score = 0;

    for (const qTerm of queryTerms) {
      const termDf = df.get(qTerm) || 0;
      if (termDf === 0) continue;

      // IDF is always positive because df ≤ N
      const idf = Math.log((N - termDf + 0.5) / (termDf + 0.5) + 1);
      if (idf <= 0) continue;

      // BM25F: compute weighted sum of per-field normalised TF, then scale by IDF
      let weightedTF = 0;
      for (const [field, fieldWeight] of fieldEntries) {
        const tokens = docFieldTokens[i][field];
        const fieldLen = tokens.length;
        if (fieldLen === 0) continue;

        let tf = 0;
        for (const t of tokens) {
          if (t === qTerm) tf++;
        }
        if (tf === 0) continue;

        const avgLen = avgFieldLen[field];
        const normTF = tf / (tf + BM25_K1 * (1 - BM25_B + BM25_B * fieldLen / avgLen));
        weightedTF += fieldWeight * normTF;
      }

      score += idf * weightedTF;
    }

    return { candidate, bm25Score: score };
  });
}

/**
 * Rerank a list of lesson candidates using a cross-encoder approach.
 *
 * @param {string} query          - The original retrieval query / action context
 * @param {Array}  candidates     - Lesson objects from the bi-encoder stage
 * @param {object} options
 * @param {number} [options.topK=5]         - How many results to return
 * @param {string} [options.toolName]       - Tool name from the triggering hook call
 * @param {number} [options.blendWeight=0.7] - Weight given to BM25 score vs original
 *                                            retrieval score (0 = all original, 1 = all BM25)
 * @returns {Array} Reranked candidates with `rerankedScore` field added
 */
function rerankLessons(query, candidates, options = {}) {
  const {
    topK        = 5,
    toolName    = '',
    blendWeight = 0.7,
  } = options;

  if (!candidates || candidates.length === 0) return [];
  if (candidates.length === 1) return candidates.slice(0, topK);

  // Build expanded query term set
  const rawTerms = tokenize((query || '') + (toolName ? ' ' + toolName : ''));
  const queryTerms = expandTerms(rawTerms);

  const isFailureQuery = FAILURE_PATTERN.test(query || '');

  // Compute BM25 scores for all candidates
  const bm25Results = fieldWeightedBM25(queryTerms, candidates);

  // Normalise BM25 scores to [0, 1]
  const maxBm25 = Math.max(...bm25Results.map((r) => r.bm25Score), 1e-9);

  const reranked = bm25Results.map(({ candidate, bm25Score }) => {
    const normBm25 = bm25Score / maxBm25;

    // Original bi-encoder score (field name differs between retrieval paths)
    const origScore = candidate.relevanceScore ?? candidate.score ?? 0;

    // Blend BM25 with original score
    let finalScore = blendWeight * normBm25 + (1 - blendWeight) * origScore;

    // Signal coherence bonus: failure queries → negative lessons rank higher
    const candidateSignal =
      candidate.signal ||
      (candidate.tags && candidate.tags.includes('negative') ? 'negative' : null);
    if (isFailureQuery && candidateSignal === 'negative') {
      finalScore *= 1.2;
    }

    // Tool name joint bonus: exact tool match between query context and lesson
    if (toolName) {
      const lessonTools = [
        ...(candidate.metadata?.toolsUsed || []),
        getField(candidate, 'toolUsed'),
        getField(candidate, 'toolName'),
      ].map((t) => (t || '').toLowerCase());

      if (lessonTools.some((t) => t && t.includes(toolName.toLowerCase()))) {
        finalScore *= 1.3;
      }
    }

    return { ...candidate, rerankedScore: Number(finalScore.toFixed(6)) };
  });

  return reranked
    .sort((a, b) => b.rerankedScore - a.rerankedScore)
    .slice(0, topK);
}

module.exports = { rerankLessons, fieldWeightedBM25, tokenize, expandTerms };
