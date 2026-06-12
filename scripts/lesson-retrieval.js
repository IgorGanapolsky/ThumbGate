#!/usr/bin/env node
'use strict';

/**
 * Per-action lesson retrieval.
 * v3: bi-encoder retrieval → cross-encoder reranking
 *
 * Stage 1 (bi-encoder): score all memories independently using token overlap,
 *   bigram Jaccard, tool-name matching, and recency decay.  Retrieve top-50.
 * Stage 2 (cross-encoder): rerank the top-50 candidates by computing a
 *   field-weighted BM25 score that processes (query, lesson) jointly, then
 *   blend with the original bi-encoder score.  Return top-maxResults.
 */

const RECENCY_DECAY_DAYS = 30;
const RERANK_CANDIDATE_POOL = 50; // bi-encoder retrieves this many; reranker picks topK

function retrieveRelevantLessons(toolName, actionContext, options = {}) {
  const { maxResults = 5, feedbackDir } = options;
  const { getFeedbackPaths, readJSONL } = require('./feedback-loop');
  const { rerankLessons } = require('./lesson-reranker');
  const pathMod = require('path');
  const paths = feedbackDir
    ? { MEMORY_LOG_PATH: pathMod.join(feedbackDir, 'memory-log.jsonl') }
    : getFeedbackPaths();

  const memories = readJSONL(paths.MEMORY_LOG_PATH, { maxLines: 200 });
  if (memories.length === 0) return [];

  const actionSig = buildActionSignature(toolName, actionContext);

  // Stage 1 — bi-encoder: score all memories independently, take top-50 candidates
  const candidates = memories
    .map((mem) => ({
      ...mem,
      relevanceScore: scoreRelevance(mem, toolName, actionContext, actionSig),
    }))
    .filter((m) => m.relevanceScore > 0.1)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, RERANK_CANDIDATE_POOL);

  if (candidates.length === 0) return [];

  // Stage 2 — cross-encoder reranker: rerank candidates by joint (query, lesson) score
  const reranked = rerankLessons(actionContext, candidates, {
    topK: maxResults,
    toolName,
  });

  return reranked.map((m) => ({
    id: m.id,
    title: m.title,
    content: m.content,
    signal: m.tags?.includes('negative') ? 'negative' : 'positive',
    rule: m.structuredRule || null,
    relevanceScore: m.rerankedScore ?? m.relevanceScore,
    timestamp: m.timestamp,
  }));
}

/**
 * Reciprocal Rank Fusion — merge several ranked id-lists into one ranking.
 *
 * RRF is scale-free: it fuses on rank position, not raw scores, so the lexical
 * (BM25-ish, 0..~1.5) and dense (cosine, -1..1) rankers combine without any
 * normalization. score(id) = Σ 1/(k + rank), rank starting at 1. k=60 is the
 * value from the original Cormack et al. paper and the de-facto standard.
 *
 * @param {string[][]} rankedLists - each inner array is ids in descending relevance
 * @param {object} [options]
 * @param {number} [options.k=60]
 * @returns {Array<{id:string, score:number}>} fused ids, descending
 */
function reciprocalRankFusion(rankedLists = [], options = {}) {
  const k = Number.isFinite(options.k) ? options.k : 60;
  const scores = new Map();
  for (const list of rankedLists) {
    if (!Array.isArray(list)) continue;
    list.forEach((id, index) => {
      if (id === undefined || id === null) return;
      const rank = index + 1;
      scores.set(id, (scores.get(id) || 0) + 1 / (k + rank));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

function loadMemories(feedbackDir) {
  const { getFeedbackPaths, readJSONL } = require('./feedback-loop');
  const pathMod = require('path');
  const paths = feedbackDir
    ? { MEMORY_LOG_PATH: pathMod.join(feedbackDir, 'memory-log.jsonl') }
    : getFeedbackPaths();
  return readJSONL(paths.MEMORY_LOG_PATH, { maxLines: 200 });
}

function shapeLesson(m) {
  return {
    id: m.id,
    title: m.title,
    content: m.content,
    signal: m.tags?.includes('negative') ? 'negative' : 'positive',
    rule: m.structuredRule || null,
    relevanceScore: m.rerankedScore ?? m.relevanceScore,
    timestamp: m.timestamp,
  };
}

/**
 * Hybrid (dense + sparse) per-action lesson retrieval — the async counterpart of
 * retrieveRelevantLessons. Used by the async gate path (gates-engine runAsync).
 *
 * Pipeline: lexical ranking ⊕ dense (embedding) ranking → Reciprocal Rank Fusion
 * → cross-encoder rerank → top-K. Dense recall surfaces past mistakes that share
 * no keywords with the action (paraphrase/synonym) — the value lexical alone misses.
 *
 * HONEST DEGRADATION: if no real embedder is available, or embedding errors, this
 * returns the pure-lexical result (identical to retrieveRelevantLessons). Never
 * fabricates semantics.
 */
async function retrieveRelevantLessonsAsync(toolName, actionContext, options = {}) {
  const { maxResults = 5, feedbackDir } = options;

  let embeddingIndex;
  try {
    embeddingIndex = require('./lesson-embedding-index');
  } catch {
    return retrieveRelevantLessons(toolName, actionContext, options);
  }

  // No real embedder → degrade to lexical (no fake vectors, no regression).
  if (!options.embedder && !embeddingIndex.isEmbedderAvailable()) {
    return retrieveRelevantLessons(toolName, actionContext, options);
  }

  const memories = loadMemories(feedbackDir);
  if (memories.length === 0) return [];

  const actionSig = buildActionSignature(toolName, actionContext);

  // Sparse: score every memory, keep those with any lexical signal.
  const lexicalScored = memories
    .map((mem) => ({ ...mem, relevanceScore: scoreRelevance(mem, toolName, actionContext, actionSig) }))
    .filter((m) => m.relevanceScore > 0.1)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
  const lexicalRanked = lexicalScored.slice(0, RERANK_CANDIDATE_POOL).map((m) => m.id);

  // Check if any lexical match is conclusive (exact/regex match on structured rule or high relevance)
  let conclusive = false;
  for (const candidate of lexicalScored) {
    if (candidate.relevanceScore >= 0.85) {
      conclusive = true;
      break;
    }
    const rule = candidate.structuredRule;
    if (rule) {
      const cond = String(rule.trigger?.condition || rule.if || '').trim().toLowerCase();
      if (cond.length >= 3) {
        if (actionContext.toLowerCase().includes(cond)) {
          conclusive = true;
          break;
        }
        try {
          const regex = new RegExp(cond, 'i');
          if (regex.test(actionContext)) {
            conclusive = true;
            break;
          }
        } catch {}
      }
    }
  }

  if (conclusive) {
    // Short-circuit: skip embedding/dense search completely
    const { rerankLessons } = require('./lesson-reranker');
    const reranked = rerankLessons(actionContext, lexicalScored.slice(0, RERANK_CANDIDATE_POOL), { topK: maxResults, toolName });
    return reranked.map(shapeLesson);
  }

  // WHERE-clause pruning: filter memories before vector search to only include
  // memories relevant to the current toolName or context.
  const prunedMemories = memories.filter((mem) => {
    // 1. If lexical score is non-trivial, keep it.
    const score = scoreRelevance(mem, toolName, actionContext, actionSig);
    if (score > 0.1) return true;

    // 2. Otherwise, check tool compatibility: if toolsUsed is specified, it must contain our tool
    const memTools = mem.metadata?.toolsUsed || [];
    if (memTools.length > 0 && !memTools.some(t => t.toLowerCase() === toolName.toLowerCase())) {
      return false;
    }
    const ruleTools = mem.structuredRule?.metadata?.toolsUsed || [];
    if (ruleTools.length > 0 && !ruleTools.some(t => t.toLowerCase() === toolName.toLowerCase())) {
      return false;
    }
    return true;
  });

  // Dense: rank the pruned corpus by embedding similarity (cached vectors).
  let semanticRanked = [];
  if (prunedMemories.length > 0) {
    try {
      const dense = await embeddingIndex.semanticRank(actionContext, prunedMemories, {
        feedbackDir,
        embedder: options.embedder,
      });
      semanticRanked = dense.slice(0, RERANK_CANDIDATE_POOL).map((d) => d.id);
    } catch {
      // Embedding failed at runtime → fall back to pure lexical.
      return retrieveRelevantLessons(toolName, actionContext, options);
    }
  }

  // Fuse. Candidate pool is the union — dense can introduce lessons lexical missed.
  const fused = reciprocalRankFusion([lexicalRanked, semanticRanked]);
  if (fused.length === 0) return [];

  const byId = new Map(memories.map((m) => [m.id, m]));
  const lexById = new Map(lexicalScored.map((m) => [m.id, m.relevanceScore]));
  const topFusedScore = fused[0].score || 1;

  const candidates = fused
    .slice(0, RERANK_CANDIDATE_POOL)
    .map((entry) => {
      const mem = byId.get(entry.id);
      if (!mem) return null;
      // Carry a relevanceScore the cross-encoder can blend against. Prefer the
      // lexical score when present; otherwise use the normalized fusion score so
      // dense-only candidates still rank sensibly.
      const relevanceScore = lexById.has(entry.id)
        ? lexById.get(entry.id)
        : entry.score / topFusedScore;
      return { ...mem, relevanceScore };
    })
    .filter(Boolean);

  if (candidates.length === 0) return [];

  const { rerankLessons } = require('./lesson-reranker');
  const reranked = rerankLessons(actionContext, candidates, { topK: maxResults, toolName });
  return reranked.map(shapeLesson);
}

function buildActionSignature(toolName, actionContext) {
  const toolLower = (toolName || '').toLowerCase();
  const contextLower = (actionContext || '').toLowerCase();
  const sigPaths = extractPaths(actionContext);
  const tokens = tokenize(contextLower);
  const ngramSet = textBigrams(contextLower);
  return { toolLower, contextLower, paths: sigPaths, tokens, ngramSet };
}

function textBigrams(text) {
  const normalized = (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const set = new Set();
  for (let i = 0; i < normalized.length - 1; i++) {
    set.add(normalized.slice(i, i + 2));
  }
  return set;
}

function bigramJaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function scoreRelevance(memory, toolName, actionContext, actionSig) {
  const sig = actionSig || buildActionSignature(toolName, actionContext);
  let score = 0;

  const memText = ((memory.title || '') + ' ' + (memory.content || '') + ' ' + (memory.tags || []).join(' ')).toLowerCase();

  if (memory.metadata?.toolsUsed?.some((t) => t.toLowerCase() === sig.toolLower)) score += 0.4;
  if (memText.includes(sig.toolLower)) score += 0.2;

  const memPaths = memory.metadata?.filesInvolved || extractPaths(memText);
  const pathOverlap = sig.paths.filter((p) =>
    memPaths.some((mp) => mp.includes(p) || p.includes(mp)),
  );
  if (pathOverlap.length > 0) score += 0.3;

  const memTokens = tokenize(memText);
  const overlap = sig.tokens.filter((t) => memTokens.includes(t));
  score += Math.min(overlap.length * 0.05, 0.3);

  // Fuzzy n-gram matching (only when there is already signal)
  if (score > 0) {
    const memBigrams = textBigrams(memText);
    const fuzzyScore = bigramJaccard(sig.ngramSet, memBigrams);
    score += fuzzyScore * 0.2;
  }

  if (memory.tags?.includes('negative')) score += 0.1;

  if (memory.timestamp) {
    const ageMs = Date.now() - new Date(memory.timestamp).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const decay = Math.max(0, 1 - ageDays / RECENCY_DECAY_DAYS);
    score *= 0.5 + 0.5 * decay;
  }

  if (memory.structuredRule) score += 0.15;

  return score;
}

function extractPaths(text) {
  return [...new Set((text || '').match(/(?:src\/|scripts\/|tests\/)[^\s,)'"<>]+/g) || [])];
}

function tokenize(text) {
  return (text || '').split(/[\s.,;:!?()\[\]{}"'`]+/).filter((t) => t.length > 3);
}

function calculateRetrievalEntropy(lessons) {
  if (!Array.isArray(lessons) || lessons.length === 0) return 0;
  let pW = 0, nW = 0, tW = 0;
  for (const l of lessons) {
    const w = l.relevanceScore || 0.1;
    if (l.signal === "positive") pW += w; else nW += w;
    tW += w;
  }
  if (tW === 0) return 0;
  const pPos = pW / tW, pNeg = nW / tW;
  const entropy = (pPos > 0 ? -pPos * Math.log2(pPos) : 0) + (pNeg > 0 ? -pNeg * Math.log2(pNeg) : 0);
  return Number(entropy.toFixed(4));
}


/**
 * Filter lessons using Top-P (nucleus) sampling logic.
 * Keeps lessons that contribute to the top cumulative relevance mass.
 */
function filterTopP(lessons, topP = 0.9) {
  if (!Array.isArray(lessons) || lessons.length === 0) return [];
  if (topP >= 1.0) return lessons;
  const sorted = [...lessons].sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  let cumulative = 0;
  const filtered = [];
  for (const l of sorted) {
    filtered.push(l);
    cumulative += (l.relevanceScore || 0);
    if (cumulative >= topP) break;
  }
  return filtered;
}

function calculateRetrievalEntropy(lessons) {
  if (!Array.isArray(lessons) || lessons.length === 0) return 0;
  let pW = 0, nW = 0, tW = 0;
  for (const l of lessons) {
    const w = l.relevanceScore || 0.1;
    if (l.signal === "positive") pW += w; else nW += w;
    tW += w;
  }
  if (tW === 0) return 0;
  const pPos = pW / tW, pNeg = nW / tW;
  const entropy = (pPos > 0 ? -pPos * Math.log2(pPos) : 0) + (pNeg > 0 ? -pNeg * Math.log2(pNeg) : 0);
  return Number(entropy.toFixed(4));
}

module.exports = { calculateRetrievalEntropy, filterTopP,  calculateRetrievalEntropy, 
  retrieveRelevantLessons,
  retrieveRelevantLessonsAsync,
  reciprocalRankFusion,
  scoreRelevance,
  buildActionSignature,
  textBigrams,
  bigramJaccard,
};
