#!/usr/bin/env node
'use strict';

/**
 * RAG embedding identity — fail-closed model/dim/provider contract.
 *
 * Research source (2026-08-12): Super Data Science #1017 with Pete Johnson
 * (MongoDB Field CTO of AI) — "The RAG Mistake Almost Every Team Is Making"
 * https://www.youtube.com/watch?v=jAPGTVlNoD4
 *
 * Claim translated into enforcement:
 *   - Embedding model choice is the underrated ROI lever (not just the LLM).
 *   - Mixing embedding models / dimensions silently destroys retrieval quality.
 *   - Matryoshka progressive disclosure (coarse → fine) is a valid cost/quality
 *     tradeoff only when truncation is from a single compatible base model.
 */

const {
  normalizeToMatryoshkaDimension,
  buildMatryoshkaConfig,
  EMBEDDING_QUALITY_THRESHOLDS,
} = require('./matryoshka-embedding');

function parseEmbeddingIdentity(fingerprint, dimensionHint) {
  const raw = String(fingerprint || 'unknown').trim() || 'unknown';
  const parts = raw.split(':').map((p) => p.trim()).filter(Boolean);
  const dimensionFromParts = parts
    .map((p) => Number(p))
    .find((n) => Number.isFinite(n) && n > 0);
  const dimension = Number.isFinite(Number(dimensionHint)) && Number(dimensionHint) > 0
    ? Number(dimensionHint)
    : dimensionFromParts || null;
  const model = parts.find((p) => /embed|gemini|text-|qwen|openai|voyage|bge|e5|mini/i.test(p)) || parts[1] || null;
  const source = parts[0] || raw;
  return {
    fingerprint: raw,
    source,
    model,
    dimension,
    identityKey: [source, model || 'unspecified', dimension || 'na'].join('|'),
  };
}

function assertCompatibleEmbeddings({
  queryProvider,
  queryDimension,
  documentProvider,
  documentDimension,
  allowUnknown = false,
} = {}) {
  const query = parseEmbeddingIdentity(queryProvider, queryDimension);
  const document = parseEmbeddingIdentity(documentProvider, documentDimension);
  const issues = [];

  if (!allowUnknown && (query.fingerprint === 'unknown' || document.fingerprint === 'unknown')) {
    issues.push({
      code: 'unknown_embedding_identity',
      severity: 'high',
      message: 'Embedding provider fingerprint is unknown; refuse silent semantic ranking.',
    });
  }

  if (
    query.fingerprint
    && document.fingerprint
    && query.fingerprint !== 'unknown'
    && document.fingerprint !== 'unknown'
    && query.fingerprint !== document.fingerprint
  ) {
    // Same provider family with only dim suffix mismatch is handled below.
    const queryBase = query.fingerprint.replace(/:\d+$/, '');
    const docBase = document.fingerprint.replace(/:\d+$/, '');
    if (queryBase !== docBase) {
      issues.push({
        code: 'embedding_provider_mismatch',
        severity: 'high',
        message: `Query provider ${query.fingerprint} is incompatible with document provider ${document.fingerprint}.`,
      });
    }
  }

  if (
    Number.isFinite(query.dimension)
    && Number.isFinite(document.dimension)
    && query.dimension !== document.dimension
  ) {
    issues.push({
      code: 'embedding_dimension_mismatch',
      severity: 'high',
      message: `Query dim ${query.dimension} != document dim ${document.dimension}. Use Matryoshka truncation from one base vector, not mixed spaces.`,
    });
  }

  return {
    ok: issues.length === 0,
    query,
    document,
    issues,
    failClosed: issues.some((i) => i.severity === 'high'),
  };
}

/**
 * Progressive Matryoshka plan (coarse filter → fine re-rank).
 * Pete Johnson framing: cheaper dims for funnel; full dims for precision.
 */
function buildProgressiveRetrievalPlan(options = {}) {
  const config = buildMatryoshkaConfig(options);
  const baseDim = config.baseDimension;
  const coarseDim = normalizeToMatryoshkaDimension(
    Math.min(256, baseDim)
  );
  const midDim = normalizeToMatryoshkaDimension(
    Math.min(768, baseDim)
  );
  return {
    strategy: 'progressive_matryoshka',
    researchSource: {
      episode: 'Super Data Science #1017',
      guest: 'Pete Johnson (MongoDB Field CTO of AI)',
      url: 'https://www.youtube.com/watch?v=jAPGTVlNoD4',
      thesis: 'Embedding model choice + compatible dimensions dominate RAG ROI.',
    },
    baseDimension: baseDim,
    stages: [
      {
        stage: 1,
        name: 'coarse_filter',
        dimension: coarseDim,
        topKMultiplier: 4,
        purpose: 'cheap semantic funnel over full corpus',
      },
      {
        stage: 2,
        name: 'fine_rerank',
        dimension: midDim < baseDim ? midDim : baseDim,
        topKMultiplier: 1,
        purpose: 'precision re-rank of coarse survivors',
      },
    ],
    qualityThresholds: EMBEDDING_QUALITY_THRESHOLDS,
    embeddingModel: config.embeddingModel,
    provider: config.provider,
    rules: [
      'Never cosine-compare vectors from two different embedding models.',
      'Truncate Matryoshka vectors only from a single full base embedding.',
      'Re-embed the whole corpus when provider or base model changes.',
      'Prefer hybrid lexical+dense until embedding identity is proven stable.',
    ],
  };
}

function scoreEmbeddingRoiReadiness({
  providerPinned = false,
  modelPinned = false,
  dimensionPinned = false,
  hybridEnabled = false,
  goldenRecall = null,
  goldenPrecision = null,
  mixedProviderCorpus = false,
} = {}) {
  const issues = [];
  if (mixedProviderCorpus) {
    issues.push('mixed_provider_corpus');
  }
  if (!providerPinned) issues.push('provider_unpinned');
  if (!modelPinned) issues.push('model_unpinned');
  if (!dimensionPinned) issues.push('dimension_unpinned');
  if (!hybridEnabled) issues.push('hybrid_disabled');
  if (!Number.isFinite(goldenRecall) || goldenRecall < EMBEDDING_QUALITY_THRESHOLDS.recall) {
    issues.push('golden_recall_below_bar');
  }
  if (!Number.isFinite(goldenPrecision) || goldenPrecision < EMBEDDING_QUALITY_THRESHOLDS.precision) {
    issues.push('golden_precision_below_bar');
  }

  // ROI framing from episode: committees+metrics without embedding discipline = no ROI.
  const score = Math.max(0, 100 - issues.length * 12);
  return {
    score,
    ready: issues.length === 0,
    issues,
    recommendation: issues.includes('mixed_provider_corpus')
      ? 'Rebuild the embedding cache under one provider+model+dim before trusting dense recall.'
      : issues.includes('model_unpinned')
        ? 'Pin THUMBGATE_EMBED_PROVIDER / model explicitly — embedding choice is the underrated ROI lever.'
        : issues.length
          ? 'Close embedding identity gaps, then re-run eval:rag golden suite.'
          : 'Embedding identity is pinned; keep progressive Matryoshka + hybrid eval green.',
  };
}

module.exports = {
  parseEmbeddingIdentity,
  assertCompatibleEmbeddings,
  buildProgressiveRetrievalPlan,
  scoreEmbeddingRoiReadiness,
};
