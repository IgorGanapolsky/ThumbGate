#!/usr/bin/env node
'use strict';

/**
 * Classic IR ranking metrics for ThumbGate retrieval evaluation.
 *
 * - Recall@k  — fraction of relevant docs found in top-k
 * - Precision@k — fraction of top-k that are relevant
 * - MRR       — mean reciprocal rank of first relevant hit
 * - nDCG@k    — normalized discounted cumulative gain (graded relevance)
 *
 * Relevance: qrels map docId → grade (0 = non-relevant, ≥1 relevant).
 * Binary metrics treat grade ≥ minGrade (default 1) as relevant.
 */

function toId(item) {
  if (item == null) return '';
  if (typeof item === 'string' || typeof item === 'number') return String(item);
  return String(item.id || item.docId || item.memoryId || '');
}

function rankedIds(rankedList = []) {
  return rankedList.map(toId).filter(Boolean);
}

function relevantIds(qrels = {}, minGrade = 1) {
  return Object.entries(qrels || {})
    .filter(([, grade]) => Number(grade) >= minGrade)
    .map(([id]) => String(id));
}

/**
 * Recall@k = |relevant ∩ topk| / |relevant|
 * Returns 0 when there are no relevant docs (undefined qrel set).
 */
function recallAtK(rankedList, qrels, k = 5, options = {}) {
  const minGrade = options.minGrade == null ? 1 : options.minGrade;
  const rel = new Set(relevantIds(qrels, minGrade));
  if (rel.size === 0) return 0;
  const top = rankedIds(rankedList).slice(0, Math.max(1, k));
  let hits = 0;
  for (const id of top) {
    if (rel.has(id)) hits += 1;
  }
  return hits / rel.size;
}

/**
 * Precision@k = |relevant ∩ topk| / k
 * (uses fixed k even if list is shorter — standard IR padding)
 */
function precisionAtK(rankedList, qrels, k = 5, options = {}) {
  const minGrade = options.minGrade == null ? 1 : options.minGrade;
  const rel = new Set(relevantIds(qrels, minGrade));
  const kk = Math.max(1, k);
  const top = rankedIds(rankedList).slice(0, kk);
  if (top.length === 0) return 0;
  let hits = 0;
  for (const id of top) {
    if (rel.has(id)) hits += 1;
  }
  return hits / kk;
}

/**
 * Reciprocal rank of the first doc with grade ≥ minGrade. 0 if none in list.
 * MRR is the mean of these over queries (see meanMetric).
 */
function reciprocalRank(rankedList, qrels, options = {}) {
  const minGrade = options.minGrade == null ? 1 : options.minGrade;
  const rel = new Set(relevantIds(qrels, minGrade));
  if (rel.size === 0) return 0;
  const ids = rankedIds(rankedList);
  for (let i = 0; i < ids.length; i++) {
    if (rel.has(ids[i])) return 1 / (i + 1);
  }
  return 0;
}

function mrrAtK(rankedList, qrels, k = 10, options = {}) {
  const top = rankedIds(rankedList).slice(0, Math.max(1, k));
  return reciprocalRank(top, qrels, options);
}

function dcgAtK(grades, k) {
  let dcg = 0;
  const limit = Math.min(k, grades.length);
  for (let i = 0; i < limit; i++) {
    const gain = Math.pow(2, Number(grades[i]) || 0) - 1;
    // rank i+1 → log2(i+2)
    dcg += gain / Math.log2(i + 2);
  }
  return dcg;
}

/**
 * nDCG@k with graded qrels. Ideal ordering = grades sorted descending.
 */
function ndcgAtK(rankedList, qrels, k = 5) {
  const kk = Math.max(1, k);
  const ids = rankedIds(rankedList).slice(0, kk);
  const grades = ids.map((id) => Number(qrels[id]) || 0);
  const dcg = dcgAtK(grades, kk);

  const idealGrades = Object.values(qrels || {})
    .map((g) => Number(g) || 0)
    .filter((g) => g > 0)
    .sort((a, b) => b - a);
  const idcg = dcgAtK(idealGrades, kk);
  if (idcg <= 0) return 0;
  return dcg / idcg;
}

function mean(values) {
  const nums = (values || []).map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Score one query: ranked list + qrels → metric bag.
 */
function scoreRanking(rankedList, qrels, options = {}) {
  const kValues = options.kValues || [1, 5, 10];
  const minGrade = options.minGrade == null ? 1 : options.minGrade;
  const out = {
    mrr: reciprocalRank(rankedList, qrels, { minGrade }),
    relevantCount: relevantIds(qrels, minGrade).length,
    retrievedCount: rankedIds(rankedList).length,
  };
  for (const k of kValues) {
    out[`recall@${k}`] = recallAtK(rankedList, qrels, k, { minGrade });
    out[`precision@${k}`] = precisionAtK(rankedList, qrels, k, { minGrade });
    out[`mrr@${k}`] = mrrAtK(rankedList, qrels, k, { minGrade });
    out[`ndcg@${k}`] = ndcgAtK(rankedList, qrels, k);
  }
  return out;
}

/**
 * Aggregate per-query metric bags into means.
 */
function aggregateRankingScores(perQueryScores = [], options = {}) {
  const kValues = options.kValues || [1, 5, 10];
  const keys = ['mrr'];
  for (const k of kValues) {
    keys.push(`recall@${k}`, `precision@${k}`, `mrr@${k}`, `ndcg@${k}`);
  }
  const summary = { queries: perQueryScores.length };
  for (const key of keys) {
    summary[key] = mean(perQueryScores.map((s) => s[key]));
  }
  return summary;
}

module.exports = {
  toId,
  rankedIds,
  relevantIds,
  recallAtK,
  precisionAtK,
  reciprocalRank,
  mrrAtK,
  ndcgAtK,
  dcgAtK,
  mean,
  scoreRanking,
  aggregateRankingScores,
};
