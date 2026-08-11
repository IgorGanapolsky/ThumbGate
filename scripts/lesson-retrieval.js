#!/usr/bin/env node
'use strict';

/**
 * Per-action lesson retrieval.
 * v3: first-stage retrieval → field-aware BM25F reranking
 *
 * Stage 1 (bi-encoder): score all memories independently using token overlap,
 *   bigram Jaccard, tool-name matching, and recency decay.  Retrieve top-50.
 * Stage 2 (BM25F): rerank the top-50 candidates with field-weighted lexical
 *   evidence, then blend with the original retrieval score. This stage is not
 *   a neural cross-encoder; neural/late-interaction/LLM stages live in the
 *   explicit reranking cascade.
 */

const RECENCY_DECAY_DAYS = 30;
const { DEFAULT_HALF_LIFE_MS, applyTemporalDecay } = require('./temporal-decay-weighting');
const RERANK_CANDIDATE_POOL = 50; // bi-encoder retrieves this many; reranker picks topK
const MAX_RETRIEVAL_MEMORY_CHARS = 20000;

// Line cap for reading the memory log during retrieval.
//
// This was 200, which quietly made relevance irrelevant. Retrieval scores memories and keeps
// anything over 0.1, but it only ever SAW the newest 200 entries — so once 200 newer lessons
// existed, the single most relevant lesson in the corpus became unreachable no matter how well
// it matched. Measured on a synthetic corpus where the best-scoring lesson (0.183, threshold
// 0.1) is the oldest entry:
//
//     corpus   150 -> found
//     corpus   201 -> NOT found        <- cliff, purely from recency
//     corpus 2,000 -> NOT found
//
// A firewall that forgets its oldest lessons forgets the ones it learned the hard way.
//
// The cap exists for cost, so it is set from measurement rather than taste. Worst case (every
// entry scoring above threshold, so nothing filters out early):
//
//     200 entries 2.6 ms/call | 5,000 entries 2.6 ms/call | 20,000 entries 4.2 ms/call
//
// 5,000 therefore costs nothing measurable against the old 200 while covering realistic
// corpora with wide headroom. Override with THUMBGATE_RETRIEVAL_MAX_LINES if a machine ever
// grows past it.
const MAX_RETRIEVAL_MEMORY_LINES = Math.max(
  1,
  Number(process.env.THUMBGATE_RETRIEVAL_MAX_LINES) || 5000,
);

function isRetrievableMemory(memory, options = {}) {
  if (!memory || typeof memory !== 'object') return false;
  const { looksLikeTransportBlob } = require('./feedback-sanitizer');
  const title = String(memory.title || '');
  const content = String(memory.content || '');
  const combined = `${title}\n${content}`.trim();
  const maxChars = Number.isFinite(options.maxMemoryChars)
    ? Math.max(1, options.maxMemoryChars)
    : MAX_RETRIEVAL_MEMORY_CHARS;
  if (!combined || combined.length > maxChars) return false;
  return !looksLikeTransportBlob(title)
    && !looksLikeTransportBlob(content)
    && !looksLikeTransportBlob(combined);
}

function selectRetrievalMemories(memories = [], options = {}) {
  let selected = memories.filter((memory) => isRetrievableMemory(memory, options));
  if (options.requireScope && !options.scope) {
    throw new Error('Scoped lesson retrieval requires scope');
  }
  if (options.scope) {
    const { selectRecordsForScope } = require('./memory-scope-readiness');
    selected = selectRecordsForScope(selected, options.scope, {
      includeShared: options.includeShared !== false,
    }).allowed;
  }
  return selected.filter((memory) => matchesMetadataFilters(
    memory,
    options.metadataFilters || options.filters,
  ));
}

function normalizedValues(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
}

function memoryValues(memory, field) {
  if (field === 'toolsUsed') {
    return normalizedValues([
      ...(memory.metadata?.toolsUsed || []),
      ...(memory.structuredRule?.metadata?.toolsUsed || []),
    ]);
  }
  if (field === 'tags') return normalizedValues(memory.tags);
  if (field === 'signal') {
    return normalizedValues([
      memory.signal,
      memory.feedback,
      ...(memory.tags || []),
    ]);
  }
  return normalizedValues(memory.metadata?.[field] ?? memory[field]);
}

function matchesMetadataFilters(memory, filters = {}) {
  if (!filters || typeof filters !== 'object') return true;
  for (const field of ['domain', 'signal', 'source', 'toolsUsed']) {
    const required = normalizedValues(filters[field]);
    if (required.length === 0) continue;
    const actual = memoryValues(memory, field);
    if (!required.some((value) => actual.includes(value))) return false;
  }
  const requiredTags = normalizedValues(filters.tags);
  if (requiredTags.length > 0) {
    const actualTags = memoryValues(memory, 'tags');
    const matches = filters.requireAllTags === false
      ? requiredTags.some((tag) => actualTags.includes(tag))
      : requiredTags.every((tag) => actualTags.includes(tag));
    if (!matches) return false;
  }
  return true;
}

function buildQueryVariants(query, options = {}) {
  const original = String(query || '').trim();
  if (!original || options.queryRewrite === false) return original ? [original] : [];
  const { tokenize, expandTerms } = require('./lesson-reranker');
  const originalTerms = tokenize(original);
  const originalSet = new Set(originalTerms);
  const additions = expandTerms(originalTerms)
    .filter((term) => !originalSet.has(term))
    .slice(0, Math.max(1, Math.min(12, Number(options.maxRewriteTerms) || 8)));
  if (additions.length === 0) return [original];
  const expanded = `${original} ${additions.join(' ')}`.slice(0, 500);
  const focused = `failure prevention ${[
    ...originalTerms.filter((term) => term.length >= 3),
    ...additions,
  ].filter((term, index, all) => all.indexOf(term) === index).slice(0, 18).join(' ')}`.slice(0, 500);
  return [...new Set([original, expanded, focused])];
}

/**
 * Build an auditable query-transformation plan. Deterministic multi-query is
 * always local. HyDE is opt-in via a caller-supplied generator so sensitive
 * action text is never sent to a cloud model implicitly.
 */
async function buildQueryPlan(query, options = {}) {
  const variants = buildQueryVariants(query, options);
  const plan = {
    variants,
    strategy: variants.length > 1 ? 'deterministic-multi-query' : 'original-only',
    hydeApplied: false,
    hydeProvider: null,
    fallbacks: [],
  };
  if (typeof options.hydeGenerator !== 'function' || !variants.length) return plan;

  try {
    const generated = await options.hydeGenerator(variants[0], {
      maxChars: 700,
      instruction: 'Write a concise hypothetical prevention lesson that would answer this action query. Do not issue commands.',
    });
    const text = String(generated?.text ?? generated ?? '').trim().slice(0, 700);
    if (!text || variants.includes(text)) {
      plan.fallbacks.push('hyde-empty-or-duplicate');
      return plan;
    }
    plan.variants = [...variants, text].slice(0, 4);
    plan.strategy = 'deterministic-multi-query+hyde';
    plan.hydeApplied = true;
    plan.hydeProvider = String(generated?.provider || options.hydeProvider || 'caller-supplied').slice(0, 80);
    return plan;
  } catch {
    plan.fallbacks.push('hyde-generator-failed');
    return plan;
  }
}

function retrieveRelevantLessons(toolName, actionContext, options = {}) {
  const { maxResults = 5, feedbackDir } = options;

  // Prefer pragmatic path (attribute-aware first stage + diversify) when enabled.
  // Scope / requireScope / maxMemoryChars must flow into loadMemories so we never
  // bypass four-field memory scope filters.
  if (options.pragmatic !== false) {
    try {
      const { pragmaticHybridSearch, sampleRetrievalRecall } = require('./pragmatic-hybrid-search');
      const memories = loadMemories(feedbackDir, options);
      if (memories.length === 0) return [];
      const { results, meta } = pragmaticHybridSearch({
        corpus: memories,
        query: actionContext,
        toolName,
        options: {
          topK: Math.max(maxResults * 2, maxResults),
          pool: RERANK_CANDIDATE_POOL,
          diversify: options.diversify !== false,
          perLimit: options.perLimit || 3,
          attribute: options.attribute,
        },
      });
      sampleRetrievalRecall({
        toolName,
        queryPreview: String(actionContext || '').slice(0, 200),
        strategy: meta.strategy,
        topIds: results.slice(0, maxResults).map((r) => r.id),
        mode: 'sync',
      }, { feedbackDir });
      return filterTopP(
        dedupeSupersededLessons(results),
        resolveTopP(options),
        { minKeep: options.minKeep },
      ).slice(0, maxResults).map(shapeLesson);
    } catch {
      // fall through to classic path
    }
  }

  const { getFeedbackPaths, readJSONL } = require('./feedback-loop');
  const { rerankLessons } = require('./lesson-reranker');
  const pathMod = require('path');
  const paths = feedbackDir
    ? { MEMORY_LOG_PATH: pathMod.join(feedbackDir, 'memory-log.jsonl') }
    : getFeedbackPaths();

  const memories = selectRetrievalMemories(
    readJSONL(paths.MEMORY_LOG_PATH, { maxLines: MAX_RETRIEVAL_MEMORY_LINES }),
    options,
  );
  if (memories.length === 0) return [];

  const actionSig = buildActionSignature(toolName, actionContext);

  // Stage 1 — local first-stage score, then a dedupe-aware pool cut. Collapsing
  // near-duplicate clusters BEFORE the top-50 cut keeps a dense cluster from
  // crowding genuinely distinct lessons out of the reranker's candidate pool.
  const scored = memories
    .map((mem) => ({
      ...mem,
      relevanceScore: scoreRelevance(mem, toolName, actionContext, actionSig),
    }))
    .filter((m) => m.relevanceScore > 0.1)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
  const candidates = dedupeCandidatePool(scored);

  if (candidates.length === 0) return [];

  // Stage 2 — field-aware BM25F reranker (not a neural cross-encoder). Over-fetch
  // 2× so a post-rerank dedupe collapse backfills from ranked survivors instead of
  // under-filling the caller's slot budget (mirrors the pragmatic path's topK).
  const reranked = rerankLessons(actionContext, candidates, {
    topK: Math.max(maxResults * 2, maxResults),
    toolName,
  });

  // Stage 3 (opt-in) — Memora-style nucleus stop: trim the low-mass tail so a
  // dominant lesson isn't padded out to maxResults. No-op unless topP < 1.
  const deduped = dedupeSupersededLessons(reranked);
  const selected = filterTopP(deduped, resolveTopP(options), { minKeep: options.minKeep });

  const shaped = selected.slice(0, maxResults).map((m) => ({
    id: m.id,
    title: m.title,
    content: m.content,
    signal: m.tags?.includes('negative') ? 'negative' : 'positive',
    rule: m.structuredRule || null,
    relevanceScore: m.rerankedScore ?? m.relevanceScore,
    timestamp: m.timestamp,
  }));

  // Attach retrieval quality tier once (non-enumerable-ish via property on array)
  try {
    const { probeEmbeddingQuality } = require('./retrieval-quality-tier');
    const quality = probeEmbeddingQuality({
      indexUpdatedAtMs: options.indexUpdatedAtMs ?? null,
    });
    Object.defineProperty(shaped, 'retrievalMeta', {
      value: {
        strategy: 'lexical+bm25',
        qualityTier: quality.qualityTier,
        semanticClaimsAllowed: quality.semanticClaimsAllowed,
        degradedReasons: quality.degradedReasons,
        count: shaped.length,
      },
      enumerable: false,
      configurable: true,
    });
  } catch {
    // optional
  }
  return shaped;
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
  const weights = Array.isArray(options.weights) ? options.weights : [];
  const scores = new Map();
  for (let listIndex = 0; listIndex < rankedLists.length; listIndex += 1) {
    const list = rankedLists[listIndex];
    if (!Array.isArray(list)) continue;
    const weight = Number(weights[listIndex]) || 1;
    list.forEach((id, index) => {
      if (id === undefined || id === null) return;
      const rank = index + 1;
      scores.set(id, (scores.get(id) || 0) + weight / (k + rank));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

function loadMemories(feedbackDir, options = {}) {
  const { getFeedbackPaths, readJSONL } = require('./feedback-loop');
  const pathMod = require('path');
  const paths = feedbackDir
    ? { MEMORY_LOG_PATH: pathMod.join(feedbackDir, 'memory-log.jsonl') }
    : getFeedbackPaths();
  return selectRetrievalMemories(
    readJSONL(paths.MEMORY_LOG_PATH, { maxLines: MAX_RETRIEVAL_MEMORY_LINES }),
    options,
  );
}

function shapeLesson(m, retrieval = null) {
  const shaped = {
    id: m.id,
    title: m.title,
    content: m.content,
    signal: m.tags?.includes('negative') ? 'negative' : 'positive',
    rule: m.structuredRule || null,
    relevanceScore: m.rerankedScore ?? m.relevanceScore,
    timestamp: m.timestamp,
  };
  if (retrieval) shaped.retrieval = retrieval;
  return shaped;
}

/** Attach non-enumerable retrieval quality meta onto a result array. */
function attachArrayRetrievalMeta(rows, options = {}) {
  if (!Array.isArray(rows)) return rows;
  try {
    const { probeEmbeddingQuality } = require('./retrieval-quality-tier');
    const quality = probeEmbeddingQuality({
      indexUpdatedAtMs: options.indexUpdatedAtMs ?? null,
    });
    Object.defineProperty(rows, 'retrievalMeta', {
      value: {
        strategy: options.strategy || 'hybrid',
        qualityTier: quality.qualityTier,
        semanticClaimsAllowed: quality.semanticClaimsAllowed,
        degradedReasons: quality.degradedReasons,
        count: rows.length,
      },
      enumerable: false,
      configurable: true,
    });
  } catch {
    // optional
  }
  return rows;
}

/**
 * Hybrid (dense + sparse) per-action lesson retrieval — the async counterpart of
 * retrieveRelevantLessons. Used by the async gate path (gates-engine runAsync).
 *
 * Pipeline: lexical ranking ⊕ dense (embedding) ranking → Reciprocal Rank Fusion
 * → BM25F rerank → top-K. Dense recall surfaces past mistakes that share
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

  const memories = loadMemories(feedbackDir, options);
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
    const reranked = rerankLessons(actionContext, dedupeCandidatePool(lexicalScored), { topK: Math.max(maxResults * 2, maxResults), toolName });
    return filterTopP(dedupeSupersededLessons(reranked), resolveTopP(options), { minKeep: options.minKeep })
      .slice(0, maxResults)
      .map(shapeLesson);
  }

  const queryPlan = lexicalScored[0]?.relevanceScore >= (options.rewriteBelowScore ?? 0.6)
    ? {
      variants: [String(actionContext || '')],
      strategy: 'original-only-conclusive-lexical',
      hydeApplied: false,
      hydeProvider: null,
      fallbacks: [],
    }
    : await buildQueryPlan(actionContext, options);
  const queryVariants = queryPlan.variants;

  // WHERE-clause pruning: filter memories before vector search to only include
  // memories relevant to the current toolName or context.
  const prunedMemories = memories.filter((mem) => {
    // 1. If lexical score is non-trivial, keep it.
    const score = scoreRelevance(mem, toolName, actionContext, actionSig);
    if (score > 0.1) return true;

    // 2. Tool compatibility is opt-in. A lesson learned through Bash can still
    // matter while a Read/agent tool diagnoses the same incident. Callers that
    // need a hard WHERE clause can use strictToolFilter or metadataFilters.
    if (options.strictToolFilter === true) {
      const memTools = mem.metadata?.toolsUsed || [];
      if (memTools.length > 0 && !memTools.some(t => t.toLowerCase() === toolName.toLowerCase())) {
        return false;
      }
      const ruleTools = mem.structuredRule?.metadata?.toolsUsed || [];
      if (ruleTools.length > 0 && !ruleTools.some(t => t.toLowerCase() === toolName.toLowerCase())) {
        return false;
      }
    }
    return true;
  });

  // Dense: rank the pruned corpus by embedding similarity (cached vectors).
  let semanticRanked = [];
  if (prunedMemories.length > 0) {
    try {
      const denseLists = [];
      for (const variant of queryVariants) {
        const dense = await embeddingIndex.semanticRank(variant, prunedMemories, {
          feedbackDir,
          embedder: options.embedder,
          embedderId: options.embedderId,
          strictToolFilter: options.strictToolFilter,
        });
        const topScore = dense[0]?.score ?? 0;
        const minimum = Math.max(
          Number(options.minSemanticScore) || 0.15,
          topScore - (Number(options.semanticScoreWindow) || 0.2),
        );
        denseLists.push(
          dense
            .filter((entry) => entry.score >= minimum)
            .slice(0, RERANK_CANDIDATE_POOL)
            .map((entry) => entry.id),
        );
      }
      semanticRanked = reciprocalRankFusion(denseLists)
        .slice(0, RERANK_CANDIDATE_POOL)
        .map((entry) => entry.id);
    } catch {
      // Embedding failed at runtime → fall back to pure lexical.
      return retrieveRelevantLessons(toolName, actionContext, options);
    }
  }

  // Pragmatic multi-stage path (turbopuffer hybrid playbook, local-only):
  // multi-query (lexical ⊕ dense) → RRF → attribute-aware BM25 rerank → diversify.
  // Falls back to legacy fuse+rerank if pragmatic module is unavailable.
  try {
    const { pragmaticHybridSearch, sampleRetrievalRecall } = require('./pragmatic-hybrid-search');
    const { results, meta } = pragmaticHybridSearch({
      corpus: memories,
      query: actionContext,
      toolName,
      options: {
        topK: Math.max(maxResults * 2, maxResults),
        pool: RERANK_CANDIDATE_POOL,
        denseRankedIds: semanticRanked,
        queryVariants,
        denseWeight: options.denseWeight,
        fusionWeight: options.fusionWeight,
        diversify: options.diversify !== false,
        perLimit: options.perLimit || 3,
        attribute: options.attribute,
      },
    });
    sampleRetrievalRecall({
      toolName,
      queryPreview: String(actionContext || '').slice(0, 200),
      strategy: meta.strategy,
      topIds: results.slice(0, maxResults).map((r) => r.id),
      densePool: meta.densePool,
      lexicalPool: meta.lexicalPool,
    }, { feedbackDir });
    const cut = filterTopP(
      dedupeSupersededLessons(results),
      resolveTopP(options),
      { minKeep: options.minKeep },
    ).slice(0, maxResults);
    const retrieval = options.includeRetrievalMeta ? {
      ...meta,
      queryVariants,
      queryTransformation: queryPlan,
      semanticProvider: options.embedderId || 'configured',
    } : null;
    return cut.map((lesson) => shapeLesson(lesson, retrieval));
  } catch {
    // Legacy fuse path below
  }

  // Fuse. Candidate pool is the union — dense can introduce lessons lexical missed.
  const fused = reciprocalRankFusion([lexicalRanked, semanticRanked]);
  if (fused.length === 0) return [];

  const byId = new Map(memories.map((m) => [m.id, m]));
  const lexById = new Map(lexicalScored.map((m) => [m.id, m.relevanceScore]));
  const topFusedScore = fused[0].score || 1;

  const candidates = dedupeCandidatePool(fused
    .slice(0, RERANK_CANDIDATE_POOL * 2)
    .map((entry) => {
      const mem = byId.get(entry.id);
      if (!mem) return null;
      // Carry a relevanceScore the BM25F reranker can blend against. Prefer the
      // lexical score when present; otherwise use the normalized fusion score so
      // dense-only candidates still rank sensibly.
      const relevanceScore = lexById.has(entry.id)
        ? lexById.get(entry.id)
        : entry.score / topFusedScore;
      return { ...mem, relevanceScore };
    })
    .filter(Boolean));

  if (candidates.length === 0) return [];

  const { rerankLessons } = require('./lesson-reranker');
  const reranked = rerankLessons(actionContext, candidates, { topK: Math.max(maxResults * 2, maxResults), toolName });
  const rows = filterTopP(dedupeSupersededLessons(reranked), resolveTopP(options), { minKeep: options.minKeep })
    .slice(0, maxResults)
    .map(shapeLesson);
  return attachArrayRetrievalMeta(rows, {
    strategy: 'hybrid-rrf+bm25',
    indexUpdatedAtMs: options.indexUpdatedAtMs ?? null,
  });
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

  if (memory.timestamp || memory.receivedAt || memory.created_at) {
    // Half-life temporal decay (scripts/temporal-decay-weighting.js). Falls back
    // to the legacy linear window only when the half-life path cannot run.
    const stamp = memory.timestamp || memory.receivedAt || memory.created_at;
    const halfLifeMs =
      Number.isFinite(Number(process.env.THUMBGATE_RETRIEVAL_HALF_LIFE_MS)) &&
      Number(process.env.THUMBGATE_RETRIEVAL_HALF_LIFE_MS) > 0
        ? Number(process.env.THUMBGATE_RETRIEVAL_HALF_LIFE_MS)
        : DEFAULT_HALF_LIFE_MS;
    const activeMode = process.env.THUMBGATE_RETRIEVAL_ACTIVE_MODE === '1';
    try {
      score = applyTemporalDecay(score, stamp, halfLifeMs, activeMode);
    } catch {
      const ageMs = Date.now() - new Date(stamp).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const decay = Math.max(0, 1 - ageDays / RECENCY_DECAY_DAYS);
      score *= 0.5 + 0.5 * decay;
    }
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

/**
 * Resolve the nucleus (top-P) cutoff for a retrieval call. Precedence:
 *   options.topP (finite, 0 < p <= 1)  →  env THUMBGATE_RETRIEVAL_TOP_P  →  1.0 (off).
 * 1.0 is a no-op (returns the full reranked top-K), so retrieval behaviour is
 * unchanged unless an operator explicitly opts in.
 */
function resolveTopP(options = {}) {
  const fromOption = Number(options && options.topP);
  if (Number.isFinite(fromOption) && fromOption > 0 && fromOption <= 1) return fromOption;
  const fromEnv = Number(process.env.THUMBGATE_RETRIEVAL_TOP_P);
  if (Number.isFinite(fromEnv) && fromEnv > 0 && fromEnv <= 1) return fromEnv;
  return 1.0;
}

/**
 * Nucleus (top-P) filter over a ranked lesson list — the lightweight realization of
 * Memora's "policy-guided retriever decides when to stop" (ICML 2026). Instead of a
 * fixed top-K, keep the smallest prefix whose NORMALIZED relevance mass covers `topP`.
 *
 * Scores are normalized into a probability distribution first, so the cutoff is
 * scale-free: it behaves the same on raw bi-encoder scores (0..~1.5) and on blended
 * rerank scores. When one or two lessons dominate the distribution, fewer lessons are
 * returned (less context stuffed into the prompt, fewer tokens); when relevance is
 * spread out, more are kept.
 *
 * Guarantees:
 *   - never returns more lessons than the input (purely subtractive);
 *   - always returns at least `minKeep` (default 1) when the input is non-empty;
 *   - topP >= 1 (or non-positive/NaN) is a no-op: returns the input, order preserved.
 *
 * @param {Array<object>} lessons - ranked lessons (each with rerankedScore or relevanceScore)
 * @param {number} [topP=1.0] - cumulative normalized mass to cover, in (0, 1]
 * @param {object} [options]
 * @param {number} [options.minKeep=1] - hard floor on lessons returned
 * @returns {Array<object>} the retained prefix, highest score first
 */
function filterTopP(lessons, topP = 1.0, options = {}) {
  if (!Array.isArray(lessons) || lessons.length === 0) return [];
  const minKeep = Math.max(1, Math.floor(options && options.minKeep) || 1);
  if (!(topP > 0) || topP >= 1) return lessons.slice();

  const scoreOf = (l) => {
    const s = l && (l.rerankedScore ?? l.relevanceScore);
    return Number.isFinite(s) && s > 0 ? s : 0;
  };
  const sorted = [...lessons].sort((a, b) => scoreOf(b) - scoreOf(a));
  const total = sorted.reduce((sum, l) => sum + scoreOf(l), 0);
  if (total <= 0) return sorted.slice(0, Math.min(minKeep, sorted.length));

  let cumulative = 0;
  const kept = [];
  for (const lesson of sorted) {
    kept.push(lesson);
    cumulative += scoreOf(lesson) / total;
    if (kept.length >= minKeep && cumulative >= topP) break;
  }
  return kept;
}

/**
 * Drop superseded / contradictory lessons before final selection.
 *
 * Retrieval can surface two lessons on the SAME topic at near-equal relevance —
 * a stale one and a newer correction. Handing an agent contradictory guidance
 * ("never force-push" AND "force-push is fine") poisons its decision and wastes
 * tokens — the "context poisoning" failure mode. This collapses same-topic
 * lessons on the reranked list:
 *   - same topic + SAME signal     → duplicate: keep the higher-ranked, drop rest
 *   - same topic + OPPOSITE signal → contradiction: keep the most RECENT (it
 *                                    supersedes), drop the older
 *
 * "Same topic" = identical/near-identical structured-rule trigger (the strong
 * signal), else high character-bigram similarity of title+content. Conservative
 * by design: distinct lessons are never merged, and survivor order is preserved.
 * Affects only lesson RETRIEVAL — never the hard gate rules.
 *
 * @param {Array<object>} lessons - reranked lessons/memories, best-first
 * @param {object} [options]
 * @param {number} [options.similarityThreshold=0.82] - bigram-Jaccard cutoff for "same topic"
 * @returns {Array<object>} deduped list, order preserved
 */
function dedupeSupersededLessons(lessons, options = {}) {
  if (!Array.isArray(lessons) || lessons.length <= 1) {
    return Array.isArray(lessons) ? lessons.slice() : [];
  }
  const threshold = Number.isFinite(options.similarityThreshold) ? options.similarityThreshold : 0.82;
  const signalOf = (x) => x.signal || (x.tags?.includes('negative') ? 'negative' : 'positive');
  const topicSignature = (x) => {
    const rule = x.rule || x.structuredRule;
    const cond = rule && (rule.trigger?.condition || rule.if);
    if (cond && String(cond).trim().length >= 3) return String(cond).toLowerCase().trim();
    return `${x.title || ''} ${x.content || ''}`.toLowerCase().trim();
  };
  const timeOf = (x) => {
    const t = x.timestamp ? new Date(x.timestamp).getTime() : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };
  const sigs = lessons.map(topicSignature);
  const grams = sigs.map((s) => textBigrams(s));
  const sameTopic = (i, j) => {
    if (!sigs[i] || !sigs[j]) return false;
    if (sigs[i] === sigs[j]) return true;
    return bigramJaccard(grams[i], grams[j]) >= threshold;
  };

  const kept = []; // indices into `lessons`, best-first
  for (let i = 0; i < lessons.length; i++) {
    let collapsed = false;
    for (let k = 0; k < kept.length; k++) {
      const j = kept[k];
      if (!sameTopic(i, j)) continue;
      if (signalOf(lessons[i]) === signalOf(lessons[j])) {
        collapsed = true; // duplicate → keep the already-kept (higher-ranked)
      } else if (timeOf(lessons[i]) > timeOf(lessons[j])) {
        kept[k] = i; // contradiction → newer supersedes, take the slot
        collapsed = true;
      } else {
        collapsed = true; // contradiction, incoming is older → drop it
      }
      break;
    }
    if (!collapsed) kept.push(i);
  }
  return kept.map((idx) => lessons[idx]);
}

/**
 * Dedupe-aware candidate-pool cut. dedupeSupersededLessons() historically ran only
 * AFTER the RERANK_CANDIDATE_POOL cut, so a dense cluster of near-duplicate lessons
 * could fill the pool and crowd genuinely distinct lessons out before dedupe ever
 * saw them. Collapse duplicates over a bounded window (pool × 2, keeping the O(n²)
 * bigram pass cheap in the hook's hot path) BEFORE cutting to pool size. Clusters
 * larger than the window can still crowd; store compaction is the durable fix.
 *
 * @param {Array<object>} scored - candidates sorted best-first
 * @param {number} [pool=RERANK_CANDIDATE_POOL] - final pool size
 * @returns {Array<object>} deduped best-first list, at most `pool` long
 */
function dedupeCandidatePool(scored, pool = RERANK_CANDIDATE_POOL) {
  if (!Array.isArray(scored) || scored.length === 0) return [];
  const bound = Math.max(1, Math.floor(pool));
  return dedupeSupersededLessons(scored.slice(0, bound * 2)).slice(0, bound);
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

module.exports = {
  retrieveRelevantLessons,
  retrieveRelevantLessonsAsync,
  reciprocalRankFusion,
  scoreRelevance,
  buildActionSignature,
  textBigrams,
  bigramJaccard,
  calculateRetrievalEntropy,
  filterTopP,
  resolveTopP,
  dedupeSupersededLessons,
  dedupeCandidatePool,
  isRetrievableMemory,
  selectRetrievalMemories,
  matchesMetadataFilters,
  buildQueryVariants,
  buildQueryPlan,
  attachArrayRetrievalMeta,
  MAX_RETRIEVAL_MEMORY_CHARS,
  MAX_RETRIEVAL_MEMORY_LINES,
};
