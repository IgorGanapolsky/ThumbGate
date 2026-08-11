#!/usr/bin/env node
'use strict';

/**
 * Near-duplicate clustering for promoted memory records (memory-log.jsonl).
 *
 * Capture-time synthesis merges near-dupes only over a recent window, so older
 * paraphrases of the same lesson accumulate as separate records — a July 2026
 * audit measured ~86% of promoted lessons as near-duplicates. Split records
 * fragment occurrence counts (distorting shouldAutoPromote >= 3 and
 * prevention-rule scoring) and crowd retrieval candidate pools.
 *
 * Pure module — no IO. scripts/compact-memory-store.js is the CLI that applies
 * it to the store.
 */

const { canonicalHash } = require('./lesson-canonical');
const { textBigrams, bigramJaccard } = require('./lesson-retrieval');

// Same "same topic" cutoff as dedupeSupersededLessons in lesson-retrieval.js.
const DEFAULT_SIMILARITY_THRESHOLD = 0.82;

const IMPORTANCE_PRIORITY = { critical: 4, high: 3, medium: 2, low: 1 };

function signalOf(record) {
  if (record.signal) return record.signal;
  return Array.isArray(record.tags) && record.tags.includes('negative') ? 'negative' : 'positive';
}

function timeOf(record) {
  const t = new Date(record.lastUpdated || record.timestamp || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

// Mirror dedupeSupersededLessons' topicSignature: a structured rule's trigger
// condition is the strong topic signal, so records carrying distinct
// enforcement rules never merge even when their prose is near-identical.
function ruleConditionOf(record) {
  const rule = record.structuredRule;
  const cond = rule && (rule.trigger?.condition || rule.if);
  return cond && String(cond).trim().length >= 3 ? String(cond).trim().toLowerCase() : null;
}

function topicOf(record) {
  const cond = ruleConditionOf(record);
  if (cond) return cond;
  return `${record.title || ''} ${record.content || ''}`.trim().toLowerCase();
}

function occurrencesOf(record) {
  const n = Number(record.occurrences);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Merge a cluster into its newest record. Occurrences sum so recurrence counts
 * stay honest across formerly-split records; feedback ids and tags union;
 * importance takes the max. No new schema fields are invented.
 */
function mergeCluster(members) {
  const sorted = [...members].sort((a, b) => timeOf(b) - timeOf(a));
  const representative = { ...sorted[0] };
  const feedbackIds = new Set();
  const tags = new Set();
  let occurrences = 0;
  let importance = representative.importance;
  for (const member of members) {
    occurrences += occurrencesOf(member);
    for (const id of Array.isArray(member.mergedFeedbackIds) ? member.mergedFeedbackIds : []) {
      feedbackIds.add(id);
    }
    if (member.sourceFeedbackId) feedbackIds.add(member.sourceFeedbackId);
    for (const tag of Array.isArray(member.tags) ? member.tags : []) tags.add(tag);
    if ((IMPORTANCE_PRIORITY[member.importance] || 0) > (IMPORTANCE_PRIORITY[importance] || 0)) {
      importance = member.importance;
    }
  }
  representative.occurrences = occurrences;
  if (feedbackIds.size > 0) representative.mergedFeedbackIds = [...feedbackIds];
  if (tags.size > 0) representative.tags = [...tags];
  if (importance) representative.importance = importance;
  return representative;
}

/**
 * Cluster near-duplicate memory records. Two records cluster when they share a
 * same-signal canonical hash, or when their title+content bigram-Jaccard
 * similarity meets the threshold. Opposite-signal records NEVER merge (a
 * positive and a negative lesson on the same action are both signal, not
 * duplicates). Records with no topic text are kept as-is so empty records
 * never become a dedupe magnet.
 *
 * @param {Array<object>} records - memory records, oldest-first order preserved
 * @param {object} [options]
 * @param {number} [options.similarityThreshold=0.82]
 * @returns {{records: Array<object>, stats: {input: number, output: number, merged: number}}}
 */
function clusterNearDupeMemories(records, options = {}) {
  const threshold = Number.isFinite(options.similarityThreshold)
    ? options.similarityThreshold
    : DEFAULT_SIMILARITY_THRESHOLD;
  const clusters = [];
  const clusterSignals = [];
  const clusterTopics = [];
  const clusterGrams = [];
  const byHash = new Map();
  let input = 0;

  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object') continue;
    input += 1;
    const signal = signalOf(record);
    let hash = record.canonicalHash;
    if (!hash) {
      try {
        hash = canonicalHash(record);
      } catch {
        hash = null;
      }
    }
    // The canonical signature ignores structuredRule, so fold the rule
    // condition into the hash key — otherwise the hash path would merge
    // records whose prose matches but whose enforcement rules differ.
    const hashKey = hash ? `${signal}:${hash}:${ruleConditionOf(record) || ''}` : null;

    let clusterIdx = hashKey != null && byHash.has(hashKey) ? byHash.get(hashKey) : -1;
    if (clusterIdx === -1) {
      const topic = topicOf(record);
      if (topic) {
        const grams = textBigrams(topic);
        for (let i = 0; i < clusters.length; i++) {
          if (clusterSignals[i] !== signal || !clusterTopics[i]) continue;
          if (clusterTopics[i] === topic || bigramJaccard(grams, clusterGrams[i]) >= threshold) {
            clusterIdx = i;
            break;
          }
        }
        if (clusterIdx === -1) {
          clusters.push([record]);
          clusterSignals.push(signal);
          clusterTopics.push(topic);
          clusterGrams.push(grams);
          if (hashKey != null) byHash.set(hashKey, clusters.length - 1);
          continue;
        }
      } else {
        clusters.push([record]);
        clusterSignals.push(signal);
        clusterTopics.push('');
        clusterGrams.push(null);
        if (hashKey != null) byHash.set(hashKey, clusters.length - 1);
        continue;
      }
    }
    clusters[clusterIdx].push(record);
    if (hashKey != null && !byHash.has(hashKey)) byHash.set(hashKey, clusterIdx);
  }

  const out = clusters.map((members) => (members.length === 1 ? members[0] : mergeCluster(members)));
  return {
    records: out,
    stats: { input, output: out.length, merged: input - out.length },
  };
}

module.exports = {
  clusterNearDupeMemories,
  mergeCluster,
  DEFAULT_SIMILARITY_THRESHOLD,
};
