#!/usr/bin/env node
'use strict';

/**
 * Multi-Hop Recall — chains related lessons across hops for deeper context.
 *
 * Single-hop: query → top N lessons (current behavior)
 * Multi-hop:  query → hop-1 lessons → extract tags/domains/rootCauses →
 *             hop-2 lessons (related) → deduplicate → ranked chain
 *
 * Inspired by Chroma Context-1's multi-hop retrieval pattern.
 * Pro-only feature — gated via requirePro('multi-hop-recall').
 *
 * @module multi-hop-recall
 */

const { requirePro } = require('./pro-features');

/**
 * Extract expansion terms from a set of lessons for the next hop.
 * Pulls tags, domains, rootCauses, and key phrases from whatToChange.
 */
function extractExpansionTerms(lessons) {
  const terms = new Set();

  for (const lesson of lessons) {
    // Tags
    const tags = Array.isArray(lesson.tags) ? lesson.tags : safeParseTags(lesson.tags);
    for (const tag of tags) {
      if (tag && tag.length > 2) terms.add(tag);
    }

    // Domain
    if (lesson.domain && lesson.domain !== 'general') {
      terms.add(lesson.domain);
    }

    // Root cause category
    if (lesson.rootCause) {
      terms.add(lesson.rootCause);
    }

    // Key phrases from whatToChange (3+ char words, skip stopwords)
    if (lesson.whatToChange) {
      const words = lesson.whatToChange
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 3 && !STOPWORDS.has(w));
      for (const word of words.slice(0, 5)) {
        terms.add(word);
      }
    }
  }

  return Array.from(terms);
}

const STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'been', 'were', 'will',
  'should', 'would', 'could', 'about', 'their', 'there', 'which',
  'when', 'what', 'than', 'then', 'them', 'they', 'into', 'some',
  'also', 'more', 'very', 'just', 'does', 'done', 'make', 'made',
]);

function safeParseTags(tags) {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') {
    try { return JSON.parse(tags); } catch { return []; }
  }
  return [];
}

/**
 * Deduplicate lessons by ID, keeping first occurrence (higher-ranked).
 */
function deduplicateById(lessons) {
  const seen = new Set();
  return lessons.filter((l) => {
    const id = l.id;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Score a lesson's relevance to a set of expansion terms.
 * Higher = more relevant to the chain.
 */
function scoreRelevance(lesson, expansionTerms) {
  let score = 0;
  const termSet = new Set(expansionTerms.map((t) => t.toLowerCase()));

  // Tag overlap: 3 points per matching tag
  const tags = Array.isArray(lesson.tags) ? lesson.tags : safeParseTags(lesson.tags);
  for (const tag of tags) {
    if (termSet.has(tag.toLowerCase())) score += 3;
  }

  // Domain match: 2 points
  if (lesson.domain && termSet.has(lesson.domain.toLowerCase())) score += 2;

  // Root cause match: 2 points
  if (lesson.rootCause && termSet.has(lesson.rootCause.toLowerCase())) score += 2;

  // Content overlap: 1 point per matching word in whatToChange
  if (lesson.whatToChange) {
    const words = lesson.whatToChange.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (word.length > 3 && termSet.has(word)) score += 1;
    }
  }

  return score;
}

/**
 * Perform multi-hop recall over a lesson database.
 *
 * @param {Function} searchFn - Search function: (query, options) => lesson[]
 *   Must accept (query, { limit, signal, domain }) and return lesson rows.
 * @param {string} query - Initial search query
 * @param {object} [options]
 * @param {number} [options.maxHops=2] - Maximum chain depth (1 = single-hop, 2+ = multi-hop)
 * @param {number} [options.hopLimit=10] - Max results per hop
 * @param {number} [options.totalLimit=15] - Max total results across all hops
 * @param {string} [options.signal] - Filter by 'positive' or 'negative'
 * @param {boolean} [options.skipProCheck=false] - Skip Pro license check (for testing)
 * @returns {{ results: object[], hops: object[], totalHops: number, expansionTerms: string[] }}
 */
function multiHopRecall(searchFn, query, options = {}) {
  const {
    maxHops = 2,
    hopLimit = 10,
    totalLimit = 15,
    signal,
    skipProCheck = false,
  } = options;

  // Pro gate (unless testing)
  if (!skipProCheck && !requirePro('multi-hop-recall')) {
    return { results: [], hops: [], totalHops: 0, expansionTerms: [], proRequired: true };
  }

  // Clamp hops to [1, 3] to prevent runaway chains
  const hops = Math.max(1, Math.min(maxHops, 3));
  const allResults = [];
  const hopMetadata = [];
  let expansionTerms = [];

  // Hop 1: direct query search
  const hop1Results = searchFn(query, { limit: hopLimit, signal });
  allResults.push(...hop1Results);
  hopMetadata.push({
    hop: 1,
    query,
    resultsCount: hop1Results.length,
    type: 'direct',
  });

  if (hops < 2 || hop1Results.length === 0) {
    return {
      results: deduplicateById(allResults).slice(0, totalLimit),
      hops: hopMetadata,
      totalHops: 1,
      expansionTerms: [],
    };
  }

  // Extract expansion terms from hop 1
  expansionTerms = extractExpansionTerms(hop1Results);

  if (expansionTerms.length === 0) {
    return {
      results: deduplicateById(allResults).slice(0, totalLimit),
      hops: hopMetadata,
      totalHops: 1,
      expansionTerms: [],
    };
  }

  // Hop 2+: search using expansion terms
  for (let hop = 2; hop <= hops; hop++) {
    // Build expansion query from top terms (limit to 5 to keep FTS manageable)
    const queryTerms = expansionTerms.slice(0, 5).join(' OR ');
    const hopResults = searchFn(queryTerms, { limit: hopLimit, signal });

    // Score and sort by relevance to expansion terms
    const scored = hopResults
      .map((lesson) => ({ ...lesson, _hopScore: scoreRelevance(lesson, expansionTerms) }))
      .filter((l) => l._hopScore > 0)
      .sort((a, b) => b._hopScore - a._hopScore);

    allResults.push(...scored);
    hopMetadata.push({
      hop,
      query: queryTerms,
      resultsCount: scored.length,
      type: 'expansion',
      termsUsed: expansionTerms.slice(0, 5),
    });

    // Extract new terms for next hop (if any)
    if (hop < hops && scored.length > 0) {
      const newTerms = extractExpansionTerms(scored);
      // Only add truly new terms
      const existingSet = new Set(expansionTerms);
      const novel = newTerms.filter((t) => !existingSet.has(t));
      expansionTerms = [...expansionTerms, ...novel];
    }
  }

  // Deduplicate and cap at totalLimit
  const deduplicated = deduplicateById(allResults).slice(0, totalLimit);

  // Tag each result with its hop number
  const hop1Ids = new Set(hop1Results.map((l) => l.id));
  const tagged = deduplicated.map((l) => ({
    ...l,
    _hop: hop1Ids.has(l.id) ? 1 : 2,
  }));

  return {
    results: tagged,
    hops: hopMetadata,
    totalHops: hopMetadata.length,
    expansionTerms,
  };
}

module.exports = {
  multiHopRecall,
  extractExpansionTerms,
  scoreRelevance,
  deduplicateById,
  STOPWORDS,
};
