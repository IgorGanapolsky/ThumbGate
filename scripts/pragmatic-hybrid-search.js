#!/usr/bin/env node
'use strict';

/**
 * Pragmatic multi-stage hybrid retrieval (inspired by turbopuffer + Pragmatic Engineer playbook).
 *
 * We do NOT call turbopuffer SaaS. We steal the architecture patterns:
 *   1) Multi-query first stage: lexical/BM25-ish list ⊕ dense list (when embedder exists)
 *   2) Rank fusion (RRF) — ranks, not raw scores
 *   3) Attribute-aware first-stage boosts (recency Decay, occurrence Saturate)
 *   4) Field-weighted BM25 second-stage rerank
 *   5) Diversification (limit-per domain/tool) so one theme does not monopolize top-K
 *   6) Dual features on candidates (lexicalRank, denseRank, rrfScore, attributeBoost)
 *   7) Continuous recall sampling hook for offline monitoring
 *
 * Application search logic stays here; indexes stay local (JSONL + optional LanceDB).
 *
 * @see https://turbopuffer.com/docs/hybrid
 * @see https://turbopuffer.com/blog/rank-by-attribute
 * @see https://turbopuffer.com/blog/continuous-recall
 */

const path = require('path');
const fs = require('fs');
const crypto = require('node:crypto');

const DEFAULT_RRF_K = 60;
const DEFAULT_POOL = 50;
const DEFAULT_TOP_K = 10;

/**
 * Saturate(x) = x^e / (x^e + midpoint^e) ∈ [0, 1)
 * Used for "higher is better" attributes (occurrence count, engagement).
 */
function saturate(value, midpoint = 3, exponent = 1) {
  const x = Math.max(0, Number(value) || 0);
  const m = Math.max(1e-9, Number(midpoint) || 1);
  const e = Math.max(0.1, Number(exponent) || 1);
  const xe = Math.pow(x, e);
  const me = Math.pow(m, e);
  return xe / (xe + me);
}

/**
 * Decay(x) = midpoint^e / (x^e + midpoint^e) ∈ (0, 1]
 * Used for distances (age in days). Recent → ~1, old → ~0.
 */
function decay(value, midpoint = 30, exponent = 1) {
  const x = Math.max(0, Number(value) || 0);
  const m = Math.max(1e-9, Number(midpoint) || 1);
  const e = Math.max(0.1, Number(exponent) || 1);
  const me = Math.pow(m, e);
  return me / (Math.pow(x, e) + me);
}

function ageDays(timestamp) {
  if (!timestamp) return null;
  const t = new Date(timestamp).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / (1000 * 60 * 60 * 24));
}

/**
 * Attribute boost comparable in scale to a weak BM25 term (~0–1.5).
 * turbopuffer: Sum(BM25, Product(w, Decay/Saturate(attr)))
 */
function attributeBoost(doc, options = {}) {
  const recencyMidpointDays = options.recencyMidpointDays ?? 30;
  const recencyWeight = options.recencyWeight ?? 0.35;
  const occurrenceMidpoint = options.occurrenceMidpoint ?? 3;
  const occurrenceWeight = options.occurrenceWeight ?? 0.25;
  const negativeSignalWeight = options.negativeSignalWeight ?? 0.15;

  let boost = 0;
  const age = ageDays(doc.timestamp || doc.metadata?.timestamp);
  if (age != null) {
    boost += recencyWeight * decay(age, recencyMidpointDays, 1);
  }

  const occurrences = Number(
    doc.metadata?.occurrences
    ?? doc.occurrences
    ?? doc.metadata?.count
    ?? 0,
  );
  if (occurrences > 0) {
    boost += occurrenceWeight * saturate(occurrences, occurrenceMidpoint, 1);
  }

  const signal = String(doc.signal || '').toLowerCase();
  if (signal === 'negative' || signal === 'down' || (doc.tags || []).includes('negative')) {
    boost += negativeSignalWeight;
  }

  return boost;
}

/**
 * RRF over ranked id lists. Optional per-list weights (default 1).
 * score = Σ weight_i / (k + rank_i)
 */
function reciprocalRankFusion(rankedLists, options = {}) {
  const k = Math.max(1, Number(options.k) || DEFAULT_RRF_K);
  const weights = options.weights || rankedLists.map(() => 1);
  const scores = new Map();

  rankedLists.forEach((list, listIndex) => {
    const w = Number(weights[listIndex]) || 1;
    const ids = (list || []).map((item) => (typeof item === 'string' ? item : item.id)).filter(Boolean);
    ids.forEach((id, rank) => {
      const add = w / (k + rank + 1);
      scores.set(id, (scores.get(id) || 0) + add);
    });
  });

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Diversify top-K: at most `perLimit` docs share the same key (domain or primary tool).
 * turbopuffer limit.per pattern.
 */
function diversifyByAttribute(rankedDocs, options = {}) {
  const total = options.total || DEFAULT_TOP_K;
  const perLimit = options.perLimit || 3;
  const keyFn = options.keyFn || ((doc) => {
    const domain = doc.metadata?.domain || doc.tags?.[0] || 'general';
    const tool = (doc.metadata?.toolsUsed || [])[0] || 'any';
    return `${domain}::${tool}`;
  });

  const counts = new Map();
  const out = [];
  for (const doc of rankedDocs || []) {
    const key = keyFn(doc);
    const n = counts.get(key) || 0;
    if (n >= perLimit) continue;
    counts.set(key, n + 1);
    out.push(doc);
    if (out.length >= total) break;
  }
  // If diversification emptied the list too aggressively, pad with remainder
  if (out.length < total) {
    const seen = new Set(out.map((d) => d.id));
    for (const doc of rankedDocs || []) {
      if (seen.has(doc.id)) continue;
      out.push(doc);
      if (out.length >= total) break;
    }
  }
  return out;
}

/**
 * Build multi-query lists + fuse + attribute boost + BM25 rerank.
 *
 * @param {object} params
 * @param {Array<object>} params.corpus - memory-shaped docs with id
 * @param {string} params.query
 * @param {string} [params.toolName]
 * @param {object} [params.options]
 */
function pragmaticHybridSearch(params = {}) {
  const {
    corpus = [],
    query = '',
    toolName = 'Bash',
    options = {},
  } = params;

  const {
    scoreRelevance,
    buildActionSignature,
    reciprocalRankFusion: rrfFromLesson,
  } = require('./lesson-retrieval');
  const { rerankLessons } = require('./lesson-reranker');

  const topK = options.topK || DEFAULT_TOP_K;
  const pool = options.pool || DEFAULT_POOL;
  const rrfK = options.rrfK || DEFAULT_RRF_K;
  const diversify = options.diversify !== false;
  const denseRankedIds = options.denseRankedIds || []; // precomputed dense order (optional)
  const queryVariants = [...new Set(
    [query, ...(options.queryVariants || [])]
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )].slice(0, 4);

  // --- Query 1: lexical / sparse (always) ---
  // Attribute boost reorders candidates that already have lexical signal (or will
  // enter via dense multi-query). It must NOT alone promote zero-overlap docs —
  // that would break the lexical-vs-hybrid paraphrase contract and flood top-K
  // with recent-but-unrelated mistakes (turbopuffer: attr is another clause, not
  // a substitute for matching).
  const denseIdSet = new Set((denseRankedIds || []).slice(0, pool));
  const lexicalLists = [];
  const bestLexicalById = new Map();
  for (const variant of queryVariants) {
    const actionSig = buildActionSignature(toolName, variant);
    const scoredForVariant = corpus.map((mem) => {
      const base = scoreRelevance(mem, toolName, variant, actionSig);
      const attr = attributeBoost(mem, options.attribute);
      const inDense = denseIdSet.has(mem.id);
      const relevanceScore = (base > 0.1 || inDense) ? (base + attr) : 0;
      return {
        ...mem,
        lexicalScore: base,
        attributeBoost: attr,
        relevanceScore,
      };
    })
      .filter((memory) => memory.relevanceScore > 0.05)
      .sort((left, right) => right.relevanceScore - left.relevanceScore);
    lexicalLists.push(scoredForVariant.slice(0, pool).map((memory) => memory.id));
    for (const memory of scoredForVariant) {
      const previous = bestLexicalById.get(memory.id);
      if (!previous || memory.relevanceScore > previous.relevanceScore) {
        bestLexicalById.set(memory.id, memory);
      }
    }
  }

  const lexicalScored = [...bestLexicalById.values()]
    .sort((left, right) => right.relevanceScore - left.relevanceScore);
  /*
   * The best score carries candidate metadata; each query variant keeps its
   * own ranked list for RRF so expansion cannot overwrite the original query.
   */
  const lexicalRanked = lexicalLists[0] || [];

  // --- Query 2: dense (optional; caller supplies ids when embedder ran) ---
  const denseRanked = (denseRankedIds || []).slice(0, pool);
  const denseWeight = Math.max(0.1, Number(options.denseWeight) || 1.5);

  // --- Fuse multi-query ranks (RRF) ---
  const lists = denseRanked.length > 0
    ? [...lexicalLists, denseRanked]
    : lexicalLists;
  const weights = denseRanked.length > 0
    ? [...lexicalLists.map(() => 1), denseWeight]
    : lexicalLists.map(() => 1);
  const fuse = typeof rrfFromLesson === 'function'
    ? rrfFromLesson(lists, { k: rrfK, weights })
    : reciprocalRankFusion(lists, { k: rrfK, weights });

  const byId = new Map(corpus.map((m) => [m.id, m]));
  const lexMeta = new Map(lexicalScored.map((m, i) => [m.id, {
    lexicalRank: i + 1,
    lexicalScore: m.lexicalScore,
    attributeBoost: m.attributeBoost,
    relevanceScore: m.relevanceScore,
  }]));
  const denseRankMap = new Map(denseRanked.map((id, i) => [id, i + 1]));

  const maxFusionScore = fuse[0]?.score || 1;
  const candidates = fuse.slice(0, pool).map((entry) => {
    const mem = byId.get(entry.id);
    if (!mem) return null;
    const meta = lexMeta.get(entry.id) || {};
    return {
      ...mem,
      relevanceScore: meta.relevanceScore ?? entry.score,
      rrfScore: entry.score,
      lexicalRank: meta.lexicalRank || null,
      denseRank: denseRankMap.get(entry.id) || null,
      fusionScoreNormalized: entry.score / maxFusionScore,
      lexicalScore: meta.lexicalScore ?? 0,
      attributeBoost: meta.attributeBoost ?? 0,
      hybridFeatures: {
        rrfScore: entry.score,
        lexicalRank: meta.lexicalRank || null,
        denseRank: denseRankMap.get(entry.id) || null,
        attributeBoost: meta.attributeBoost ?? 0,
        fusionScoreNormalized: entry.score / maxFusionScore,
      },
    };
  }).filter(Boolean);

  if (candidates.length === 0) {
    return {
      results: [],
      meta: {
        strategy: denseRanked.length ? 'hybrid-rrf' : 'lexical-attribute',
        lexicalPool: lexicalRanked.length,
        densePool: denseRanked.length,
        fused: 0,
        rerankApplied: false,
        queryVariants,
      },
    };
  }

  // --- Second stage: field-weighted BM25F rerank ---
  let reranked = rerankLessons(query, candidates, { topK: pool, toolName });

  // Light blend of attribute boost into reranked score (keeps recency after BM25)
  reranked = reranked.map((doc) => {
    const attr = doc.attributeBoost ?? attributeBoost(doc, options.attribute);
    const base = doc.rerankedScore ?? doc.relevanceScore ?? 0;
    const fusionWeight = denseRanked.length > 0
      ? Math.max(0, Math.min(1, Number(options.fusionWeight) || 0.7))
      : 0;
    return {
      ...doc,
      attributeBoost: attr,
      rerankedScore: (
        (1 - fusionWeight) * base
        + fusionWeight * (doc.fusionScoreNormalized || 0)
        + 0.05 * attr
      ),
    };
  }).sort((a, b) => (b.rerankedScore || 0) - (a.rerankedScore || 0));

  const diversified = diversify
    ? diversifyByAttribute(reranked, {
      total: topK,
      perLimit: options.perLimit || 3,
    })
    : reranked.slice(0, topK);

  return {
    results: diversified,
    meta: {
      strategy: denseRanked.length ? 'hybrid-rrf+attr+rerank' : 'lexical-attr+rerank',
      lexicalPool: lexicalRanked.length,
      densePool: denseRanked.length,
      fused: fuse.length,
      diversified: diversify,
      rrfK,
      denseWeight,
      queryVariants,
      rerankApplied: true,
    },
  };
}

/**
 * Continuous recall sampling (turbopuffer spirit): append a sample of retrieval
 * outcomes for offline monitoring. Never throws; never blocks the hot path.
 */
function sampleRetrievalRecall(event, options = {}) {
  try {
    if (options.enabled === false) return { sampled: false };
    const rate = Number(options.sampleRate ?? process.env.THUMBGATE_RETRIEVAL_RECALL_SAMPLE_RATE ?? 0.02);
    // crypto PRNG — not security-critical sampling, but avoid Math.random for Sonar S2245
    const roll = crypto.randomInt(0, 1_000_000) / 1_000_000;
    if (!(rate > 0) || roll > rate) return { sampled: false };

    const feedbackDir = options.feedbackDir
      || process.env.THUMBGATE_FEEDBACK_DIR
      || path.join(process.cwd(), '.thumbgate');
    const outDir = path.join(feedbackDir, 'retrieval-recall-samples');
    fs.mkdirSync(outDir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...event,
    });
    fs.appendFileSync(path.join(outDir, 'samples.jsonl'), `${line}\n`, 'utf8');
    return { sampled: true };
  } catch {
    return { sampled: false, error: true };
  }
}

module.exports = {
  saturate,
  decay,
  ageDays,
  attributeBoost,
  reciprocalRankFusion,
  diversifyByAttribute,
  pragmaticHybridSearch,
  sampleRetrievalRecall,
  DEFAULT_RRF_K,
  DEFAULT_POOL,
  DEFAULT_TOP_K,
};
