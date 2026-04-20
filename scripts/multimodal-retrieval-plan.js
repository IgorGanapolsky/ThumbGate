'use strict';

const DEFAULT_EVIDENCE_TYPES = ['screenshots', 'pdf_pages', 'proof_artifacts'];
const DEFAULT_DIMS = [1024, 512, 256, 128, 64];

function clampInteger(value, { min, max, fallback }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeEvidenceTypes(value) {
  if (!Array.isArray(value)) return DEFAULT_EVIDENCE_TYPES;
  const normalized = value
    .map((item) => String(item || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'))
    .filter(Boolean);
  return normalized.length > 0 ? [...new Set(normalized)] : DEFAULT_EVIDENCE_TYPES;
}

function dimensionPlan({ corpusItems, maxEmbeddingDim }) {
  const dims = DEFAULT_DIMS.filter((dim) => dim <= maxEmbeddingDim);
  const selected = dims.length > 0 ? dims : [maxEmbeddingDim];
  return selected.map((dim) => ({
    dim,
    estimatedFloat32Mb: Number(((corpusItems * dim * 4) / (1024 * 1024)).toFixed(2)),
    useWhen: dim >= 1024
      ? 'default quality pass for launch-critical retrieval'
      : 'cost-down pass when storage or latency dominates',
  }));
}

function buildMultimodalRetrievalPlan(args = {}) {
  const evidenceTypes = normalizeEvidenceTypes(args.evidenceTypes);
  const corpusItems = clampInteger(args.corpusItems, {
    min: 100,
    max: 10000000,
    fallback: 5000,
  });
  const maxEmbeddingDim = clampInteger(args.maxEmbeddingDim, {
    min: 64,
    max: 2048,
    fallback: 1024,
  });
  const latencyBudgetMs = clampInteger(args.latencyBudgetMs, {
    min: 50,
    max: 30000,
    fallback: 750,
  });
  const useReranker = args.useReranker !== false;
  const goal = String(args.goal || 'retrieve visual proof for agent-governance decisions').trim();
  const dims = dimensionPlan({ corpusItems, maxEmbeddingDim });
  const defaultDim = dims.some((entry) => entry.dim === 1024) ? 1024 : dims[0].dim;

  return {
    planVersion: '2026-04-20',
    sourcePattern: 'multimodal Sentence Transformers visual document retrieval',
    goal,
    evidenceTypes,
    architecture: {
      stage1: 'Index screenshots, PDF pages, dashboard captures, and proof artifacts with a multimodal embedding model.',
      stage2: useReranker
        ? 'Rerank the top candidates with a multimodal cross-encoder before using evidence in a gate, PR, or sales proof claim.'
        : 'Skip reranking for low-latency agent recall; require stronger holdout evaluation before shipping.',
      fallback: 'Keep text-only search as a fallback for code, logs, markdown, and plain policy docs.',
    },
    trainingData: {
      pilotSchema: ['query', 'image', 'negative_0'],
      hardNegativeStrategy: 'Pair each proof query with visually similar but wrong screenshots or PDF pages.',
      minimumPilot: 'Start with 300 labeled evaluation queries and at least one hard negative per query before finetuning.',
    },
    evaluation: {
      baseline: 'Measure current text-only retrieval before any model changes.',
      primaryMetric: 'NDCG@10',
      secondaryMetrics: ['Recall@5', 'MAP', 'false_positive_gate_rate'],
      holdoutSets: [
        'agent failure screenshots',
        'dashboard proof captures',
        'visual docs that contain tables or charts',
      ],
    },
    deployment: {
      latencyBudgetMs,
      defaultEmbeddingDim: defaultDim,
      matryoshkaDimensions: dims,
      compressionPath: 'Use Matryoshka truncation first, then quantization only after holdout quality is stable.',
    },
    thumbgateUseCases: [
      'Find the exact screenshot or proof artifact behind a completion claim.',
      'Retrieve visual evidence before approving a workflow-hardening sprint.',
      'Rank dashboard captures and PDF runbook pages for GEO/SEO evidence pages.',
      'Attach visual hard negatives to Autoresearch loops so agents cannot reward-hack by deleting hard cases.',
    ],
    guardrails: [
      'Never promote visual retrieval results into claims without a linked artifact URL or local path.',
      'Keep the multimodal index read-only for agent recall; gate training and index rebuilds behind explicit workflow checks.',
      'Evaluate retrieval on holdout screenshots/PDF pages before replacing text-only recall.',
    ],
    nextActions: [
      'Create a small visual proof corpus from existing public dashboard screenshots and proof artifacts.',
      'Log query -> correct artifact -> hard negative triples during workflow sprint reviews.',
      'Use Autoresearch to optimize NDCG@10 and latency only after the baseline corpus exists.',
    ],
  };
}

module.exports = {
  buildMultimodalRetrievalPlan,
  dimensionPlan,
  normalizeEvidenceTypes,
};
