'use strict';

/**
 * A+ multi-stage rerank pipeline for ThumbGate.
 *
 * Stages (always local-first; LLM optional and last):
 *   1) Field-weighted BM25F pair scoring (lesson-reranker)
 *   2) ColBERT-style MaxSim late interaction (colbert-style-maxsim)
 *   3) Heuristic joint pair scorer (cross-encoder-reranker.heuristicCrossEncode)
 *   4) Optional listwise LLM rerank on the final shortlist (useLLM / env)
 *
 * Honesty contract:
 *   - Stage 3 is a *heuristic* cross-encoder, not a neural CE checkpoint
 *   - Stage 2 is ColBERT-*style* MaxSim over hashed multi-vectors unless
 *     a tokenEmbedder is supplied
 *   - LLM stage is off by default; enable with useLLM:true or THUMBGATE_RERANK_LLM=1
 *
 * Pipeline version is exported so evals and statuslines can pin provenance.
 */

const PIPELINE_VERSION = '2026-07-31.a-plus.1';

const { rerankLessons } = require('./lesson-reranker');
const { rerankWithMaxSim, scoreLateInteraction } = require('./colbert-style-maxsim');
const { heuristicCrossEncode, llmCrossEncode } = require('./cross-encoder-reranker');

/**
 * @typedef {object} RerankPipelineOptions
 * @property {number} [topK=5]
 * @property {string} [toolName]
 * @property {boolean} [useLLM=false]
 * @property {boolean} [useMaxSim=true]
 * @property {boolean} [useHeuristicCe=true]
 * @property {number} [bm25Pool=50] candidates to keep after BM25 before MaxSim
 * @property {number} [llmShortlist=8] max docs sent to LLM listwise scorer
 * @property {number} [wBm25=0.30]
 * @property {number} [wMaxSim=0.35]
 * @property {number} [wHeuristic=0.25]
 * @property {number} [wOriginal=0.10]
 * @property {(c: object) => string} [textOf]
 */

function defaultTextOf(c) {
  if (!c || typeof c !== 'object') return String(c || '');
  return [
    c.title,
    c.whatWentWrong,
    c.whatToChange,
    c.howToAvoid,
    c.summary,
    c.content,
    c.context,
    Array.isArray(c.tags) ? c.tags.join(' ') : '',
  ].filter(Boolean).join(' ');
}

function envFlag(name) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Fuse multi-stage scores into a final ranking.
 * @param {string} query
 * @param {Array<object>} candidates
 * @param {RerankPipelineOptions} [options]
 * @returns {Promise<{ results: Array<object>, meta: object }>}
 */
async function rerankPipeline(query, candidates, options = {}) {
  const topK = options.topK ?? 5;
  const toolName = options.toolName || '';
  const useMaxSim = options.useMaxSim !== false;
  const useHeuristicCe = options.useHeuristicCe !== false;
  const useLLM = options.useLLM === true || envFlag('THUMBGATE_RERANK_LLM');
  const bm25Pool = Math.max(topK, options.bm25Pool ?? 50);
  const llmShortlist = Math.max(topK, options.llmShortlist ?? 8);
  const textOf = options.textOf || defaultTextOf;
  const wBm25 = options.wBm25 ?? 0.30;
  const wMaxSim = options.wMaxSim ?? 0.35;
  const wHeuristic = options.wHeuristic ?? 0.25;
  const wOriginal = options.wOriginal ?? 0.10;

  const meta = {
    pipelineVersion: PIPELINE_VERSION,
    stages: [],
    useLLM,
    useMaxSim,
    useHeuristicCe,
    inputCount: candidates?.length || 0,
  };

  if (!candidates || candidates.length === 0) {
    return { results: [], meta: { ...meta, stages: ['empty'] } };
  }

  // --- Stage 1: BM25F ---
  let pool = rerankLessons(query, candidates, {
    topK: Math.min(bm25Pool, candidates.length),
    toolName,
    blendWeight: 0.7,
  });
  meta.stages.push('bm25f');

  // Capture BM25 scores before MaxSim overwrites rerankedScore
  pool = pool.map((c) => ({
    ...c,
    bm25Score: Number(c.rerankedScore ?? 0),
    originalScore: Number(c.relevanceScore ?? c.score ?? 0),
  }));

  // --- Stage 2: ColBERT-style MaxSim ---
  if (useMaxSim && pool.length > 1) {
    pool = rerankWithMaxSim(query, pool, {
      topK: pool.length,
      textOf,
      blendWeight: 1, // pure MaxSim into maxSimScore; we fuse ourselves
      dim: options.dim,
      ngram: options.ngram,
      maxTokens: options.maxTokens,
      tokenEmbedder: options.tokenEmbedder,
    }).map((c) => ({
      ...c,
      // restore bm25 from previous map (rerankWithMaxSim spreads candidate)
      bm25Score: c.bm25Score,
      maxSimScore: Number(c.maxSimScore ?? 0),
    }));
    meta.stages.push('colbert-style-maxsim');
  } else {
    pool = pool.map((c) => ({ ...c, maxSimScore: 0 }));
  }

  // --- Stage 3: Heuristic joint pair scorer ---
  if (useHeuristicCe) {
    pool = pool.map((c) => {
      const he = heuristicCrossEncode(
        `${toolName} ${query}`.trim(),
        textOf(c),
      );
      return { ...c, heuristicCeScore: he };
    });
    meta.stages.push('heuristic-pair-ce');
  } else {
    pool = pool.map((c) => ({ ...c, heuristicCeScore: 0 }));
  }

  // --- Fuse ---
  // Normalize bm25 within pool for fair blend
  const maxBm25 = Math.max(...pool.map((c) => c.bm25Score || 0), 1e-9);
  pool = pool.map((c) => {
    const nBm25 = (c.bm25Score || 0) / maxBm25;
    const nOrig = Math.max(0, Math.min(1, c.originalScore || 0));
    const nMs = Math.max(0, Math.min(1, c.maxSimScore || 0));
    const nHe = Math.max(0, Math.min(1, c.heuristicCeScore || 0));
    const fused =
      wBm25 * nBm25 +
      wMaxSim * nMs +
      wHeuristic * nHe +
      wOriginal * nOrig;
    return {
      ...c,
      fusedScore: Number(fused.toFixed(6)),
      rerankedScore: Number(fused.toFixed(6)),
      crossEncoderScore: nHe,
      combinedScore: Number(fused.toFixed(6)),
    };
  }).sort((a, b) => b.fusedScore - a.fusedScore);

  meta.stages.push('score-fusion');

  // --- Stage 4: optional LLM listwise on shortlist ---
  let shortlist = pool.slice(0, Math.min(llmShortlist, pool.length));
  if (useLLM && shortlist.length > 1) {
    const llmScores = await llmCrossEncode(
      `${toolName} ${query}`.trim(),
      shortlist.map((c) => ({
        title: c.title || '',
        content: textOf(c).slice(0, 400),
      })),
    );
    if (llmScores) {
      shortlist = shortlist.map((c, i) => {
        const llm = Math.max(0, Math.min(1, Number(llmScores[i]) || 0));
        // Blend LLM lightly so a bad model cannot erase local signal
        const final = 0.55 * llm + 0.45 * (c.fusedScore || 0);
        return {
          ...c,
          llmRerankScore: llm,
          fusedScore: Number(final.toFixed(6)),
          rerankedScore: Number(final.toFixed(6)),
          combinedScore: Number(final.toFixed(6)),
        };
      }).sort((a, b) => b.fusedScore - a.fusedScore);
      meta.stages.push('llm-listwise');
      meta.llmApplied = true;
    } else {
      meta.llmApplied = false;
      meta.stages.push('llm-fallback');
    }
  } else {
    meta.llmApplied = false;
  }

  const results = shortlist.slice(0, topK).map((c) => ({
    ...c,
    rerankPipelineVersion: PIPELINE_VERSION,
  }));

  meta.outputCount = results.length;
  meta.rankDelta = computeRankDelta(candidates, results);

  return { results, meta };
}

/**
 * Sync path for PreToolUse hooks (no LLM).
 */
function rerankPipelineSync(query, candidates, options = {}) {
  return rerankPipelineSyncImpl(query, candidates, options);
}

function rerankPipelineSyncImpl(query, candidates, options = {}) {
  const topK = options.topK ?? 5;
  const toolName = options.toolName || '';
  const useMaxSim = options.useMaxSim !== false;
  const useHeuristicCe = options.useHeuristicCe !== false;
  const bm25Pool = Math.max(topK, options.bm25Pool ?? 50);
  const textOf = options.textOf || defaultTextOf;
  const wBm25 = options.wBm25 ?? 0.30;
  const wMaxSim = options.wMaxSim ?? 0.35;
  const wHeuristic = options.wHeuristic ?? 0.25;
  const wOriginal = options.wOriginal ?? 0.10;

  const meta = {
    pipelineVersion: PIPELINE_VERSION,
    stages: [],
    useLLM: false,
    useMaxSim,
    useHeuristicCe,
    inputCount: candidates?.length || 0,
    llmApplied: false,
  };

  if (!candidates || candidates.length === 0) {
    return { results: [], meta: { ...meta, stages: ['empty'] } };
  }

  let pool = rerankLessons(query, candidates, {
    topK: Math.min(bm25Pool, candidates.length),
    toolName,
    blendWeight: 0.7,
  }).map((c) => ({
    ...c,
    bm25Score: Number(c.rerankedScore ?? 0),
    originalScore: Number(c.relevanceScore ?? c.score ?? 0),
  }));
  meta.stages.push('bm25f');

  if (useMaxSim && pool.length > 1) {
    pool = rerankWithMaxSim(query, pool, {
      topK: pool.length,
      textOf,
      blendWeight: 1,
    }).map((c) => ({
      ...c,
      bm25Score: c.bm25Score,
      maxSimScore: Number(c.maxSimScore ?? 0),
    }));
    meta.stages.push('colbert-style-maxsim');
  } else {
    pool = pool.map((c) => ({ ...c, maxSimScore: 0 }));
  }

  if (useHeuristicCe) {
    pool = pool.map((c) => ({
      ...c,
      heuristicCeScore: heuristicCrossEncode(`${toolName} ${query}`.trim(), textOf(c)),
    }));
    meta.stages.push('heuristic-pair-ce');
  } else {
    pool = pool.map((c) => ({ ...c, heuristicCeScore: 0 }));
  }

  const maxBm25 = Math.max(...pool.map((c) => c.bm25Score || 0), 1e-9);
  pool = pool.map((c) => {
    const nBm25 = (c.bm25Score || 0) / maxBm25;
    const nOrig = Math.max(0, Math.min(1, c.originalScore || 0));
    const nMs = Math.max(0, Math.min(1, c.maxSimScore || 0));
    const nHe = Math.max(0, Math.min(1, c.heuristicCeScore || 0));
    const fused =
      wBm25 * nBm25 + wMaxSim * nMs + wHeuristic * nHe + wOriginal * nOrig;
    return {
      ...c,
      fusedScore: Number(fused.toFixed(6)),
      rerankedScore: Number(fused.toFixed(6)),
      crossEncoderScore: nHe,
      combinedScore: Number(fused.toFixed(6)),
      rerankPipelineVersion: PIPELINE_VERSION,
    };
  }).sort((a, b) => b.fusedScore - a.fusedScore);

  meta.stages.push('score-fusion');
  const results = pool.slice(0, topK);
  meta.outputCount = results.length;
  meta.rankDelta = computeRankDelta(candidates, results);
  return { results, meta };
}

/**
 * Whether top-1 id changed vs original order (rank-delta signal).
 * @param {Array<object>} original
 * @param {Array<object>} reranked
 * @returns {{ flipped: boolean, originalTopId: string|null, rerankedTopId: string|null }}
 */
function computeRankDelta(original, reranked) {
  const idOf = (c) => c?.id || c?.lessonId || c?.title || null;
  const originalTopId = original?.[0] ? idOf(original[0]) : null;
  const rerankedTopId = reranked?.[0] ? idOf(reranked[0]) : null;
  return {
    flipped: Boolean(originalTopId && rerankedTopId && originalTopId !== rerankedTopId),
    originalTopId,
    rerankedTopId,
  };
}

/**
 * Pair-level scores for diagnostics / evals.
 */
function scorePair(query, document, opts = {}) {
  const late = scoreLateInteraction(query, document, opts);
  const he = heuristicCrossEncode(query, document);
  return {
    maxSim: late.score,
    heuristicCe: he,
    mode: late.mode,
    pipelineVersion: PIPELINE_VERSION,
  };
}

module.exports = {
  PIPELINE_VERSION,
  rerankPipeline,
  rerankPipelineSync,
  computeRankDelta,
  scorePair,
  defaultTextOf,
};
