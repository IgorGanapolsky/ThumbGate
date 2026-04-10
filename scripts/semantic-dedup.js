#!/usr/bin/env node
'use strict';

/**
 * Semantic deduplication for feedback entries.
 *
 * Uses character bigram Jaccard similarity to cluster near-duplicate
 * feedback contexts, then picks the longest entry as the representative.
 */

/**
 * Extracts character bigrams from text after normalization.
 * @param {string} text
 * @returns {Set<string>}
 */
function bigrams(text) {
  if (!text) return new Set();
  const normalized = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const result = new Set();
  for (let i = 0; i < normalized.length - 1; i++) {
    result.add(normalized.slice(i, i + 2));
  }
  return result;
}

/**
 * Computes Jaccard similarity between two sets.
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number} 0-1 similarity score
 */
function jaccardSimilarity(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/**
 * Normalizes context strings by stripping volatile data.
 * @param {string} context
 * @returns {string}
 */
function normalizeContext(context) {
  if (!context) return '';
  return context
    .replace(/\/Users\/[^\s/]+/g, '')
    .replace(/\/home\/[^\s/]+/g, '')
    .replace(/:\d+/g, '')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '')
    .replace(/\b[a-f0-9]{8,}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clusters feedback entries by context similarity.
 * @param {Array<{context: string, tags: string[]}>} entries
 * @param {{ threshold?: number }} options
 * @returns {Array<{representative: object, count: number, mergedTags: string[]}>}
 */
function clusterFeedback(entries, options = {}) {
  if (!entries || entries.length === 0) return [];
  const threshold = options.threshold ?? 0.5;
  const clusters = [];
  const assigned = new Set();
  const entryBigrams = entries.map((e) => bigrams(normalizeContext(e.context)));

  for (let i = 0; i < entries.length; i++) {
    if (assigned.has(i)) continue;
    const cluster = [i];
    assigned.add(i);

    for (let j = i + 1; j < entries.length; j++) {
      if (assigned.has(j)) continue;
      const sim = jaccardSimilarity(entryBigrams[i], entryBigrams[j]);
      if (sim >= threshold) {
        cluster.push(j);
        assigned.add(j);
      }
    }

    const clusterEntries = cluster.map((idx) => entries[idx]);
    const representative = clusterEntries.reduce((a, b) =>
      (a.context || '').length >= (b.context || '').length ? a : b
    );
    const mergedTags = [...new Set(clusterEntries.flatMap((e) => e.tags || []))];

    clusters.push({ representative, count: clusterEntries.length, mergedTags });
  }

  return clusters;
}

/**
 * Deduplicates feedback entries, returning unique entries with cluster metadata.
 * @param {Array<{context: string, tags: string[]}>} entries
 * @param {{ threshold?: number }} options
 * @returns {Array<object>}
 */
function deduplicateFeedback(entries, options = {}) {
  if (!entries || entries.length === 0) return [];
  const clusters = clusterFeedback(entries, options);
  return clusters.map((c) => ({
    ...c.representative,
    _clusterCount: c.count,
    _mergedTags: c.mergedTags,
  }));
}

module.exports = { bigrams, jaccardSimilarity, normalizeContext, clusterFeedback, deduplicateFeedback };
