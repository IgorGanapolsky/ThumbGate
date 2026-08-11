#!/usr/bin/env node
'use strict';

/**
 * Matryoshka Embedding Implementation for ThumbGate
 * 
 * Based on podcast insights from "The RAG Mistake Almost Every Team Is Making"
 * Episode #1017, featuring Pete Johnson (Field CTO, AI at MongoDB)
 * 
 * Matryoshka embeddings are nested representations where:
 * - Lower dimensions contain meaningful semantic information at multiple granularities
 * - Enables efficient retrieval without full-dimensional computation
 * - Supports progressive disclosure: query at 256 dims, refine at 1024, full at 3072
 */

const PYRAMID_LAYERS = {
  L0_CONVERSATION: 'L0_CONVERSATION',
  L1_ATOM: 'L1_ATOM',
  L2_SCENARIO: 'L2_SCENARIO',
  L3_PERSONA_SOP: 'L3_PERSONA_SOP',
};

// Matryoshka dimension tiers - each tier contains the semantic information of lower tiers
const MATRYOSHKA_DIMENSIONS = [256, 512, 768, 1024, 1536, 2048, 3072, 4096, 7680];

// Embedding model quality thresholds for RAG pipelines
const EMBEDDING_QUALITY_THRESHOLDS = {
  recall: 0.95, // Minimum recall@k for baseline
  precision: 0.15, // Minimum precision@k (covers 15% correctly)
  cross_encoder_reranker: true, // Use cross-encoder for refinement
};

function normalizeToMatryoshkaDimension(requestedDim) {
  const dim = Number(requestedDim) || 768;
  if (dim <= 0 || !Number.isFinite(dim)) return 768;
  let closest = MATRYOSHKA_DIMENSIONS[0];
  let minDiff = Math.abs(dim - closest);
  for (const tier of MATRYOSHKA_DIMENSIONS) {
    const diff = Math.abs(tier - dim);
    if (diff < minDiff) { closest = tier; minDiff = diff; }
  }
  return closest;
}

function getSemanticScore(dim) {
  const tierIndex = MATRYOSHKA_DIMENSIONS.indexOf(dim);
  if (tierIndex === -1) return 0;
  return (tierIndex + 1) / MATRYOSHKA_DIMENSIONS.length;
}

function classifyMemoryLayer(memory = {}) {
  const type = String(memory.type || 'episodic').toLowerCase();
  const content = String(memory.content || '').toLowerCase();
  const tags = Array.isArray(memory.tags) 
    ? new Set(memory.tags.map(t => String(t).toLowerCase()))
    : new Set();

  const transportLike = type === 'transcript'
    || tags.has('transport')
    || tags.has('transcript')
    || /^(user|assistant|system|tool)\s*:/m.test(content);
  if (transportLike) return PYRAMID_LAYERS.L0_CONVERSATION;

  const explicitPolicy = /^(never|always|must|do not|require)\b/i.test(content.trim());
  if (type === 'preference' || tags.has('sop') || tags.has('rule') || tags.has('policy')
      || tags.has('guardrail') || explicitPolicy) {
    return PYRAMID_LAYERS.L3_PERSONA_SOP;
  }
  if (type === 'procedural' || tags.has('workflow') || tags.has('scenario')
      || tags.has('pipeline') || tags.has('playbook')) {
    return PYRAMID_LAYERS.L2_SCENARIO;
  }
  if (type === 'semantic' || tags.has('fact') || tags.has('lesson') || tags.has('atom')
      || memory.whatWentWrong || memory.whatWorked) {
    return PYRAMID_LAYERS.L1_ATOM;
  }
  return PYRAMID_LAYERS.L0_CONVERSATION;
}

function buildEmbeddingTaskPrefix(layer, task = 'code retrieval') {
  const layerWeights = {
    [PYRAMID_LAYERS.L3_PERSONA_SOP]: 4,
    [PYRAMID_LAYERS.L2_SCENARIO]: 3,
    [PYRAMID_LAYERS.L1_ATOM]: 2,
    [PYRAMID_LAYERS.L0_CONVERSATION]: 1,
  };
  const weight = layerWeights[layer] || 1;
  const normalizedTask = String(task).trim().toLowerCase().replace(/[_-]+/g, ' ');
  return `layer:${layer} weight:${weight} task:${normalizedTask} `;
}

function validateEmbeddingQuality({
  recall,
  precision,
  recallBaseline,
  precisionBaseline,
  embeddingDim,
  goldenCases,
  perCaseRecall,
} = {}) {
  const issues = [];
  if (!Number.isFinite(recall)) {
    issues.push({ severity: 'high', issue: 'recall_missing_or_non_finite', actual: recall, recommended: 'Run the deterministic golden retrieval suite.' });
  } else if (recall < EMBEDDING_QUALITY_THRESHOLDS.recall) {
    issues.push({ severity: 'high', issue: 'recall_below_threshold', actual: recall, expected: EMBEDDING_QUALITY_THRESHOLDS.recall, recommended: 'Lower embedding dimension or use hybrid retrieval' });
  }
  if (!Number.isFinite(precision)) {
    issues.push({ severity: 'high', issue: 'precision_missing_or_non_finite', actual: precision, recommended: 'Measure deterministic precision before promotion.' });
  } else if (precision < EMBEDDING_QUALITY_THRESHOLDS.precision) {
    issues.push({ severity: 'medium', issue: 'precision_below_threshold', actual: precision, expected: EMBEDDING_QUALITY_THRESHOLDS.precision, recommended: 'Enable cross-encoder reranker or increase dimension tier' });
  }
  if (!Number.isInteger(goldenCases) || goldenCases < 6) {
    issues.push({ severity: 'high', issue: 'insufficient_golden_cases', actual: goldenCases, expected: 6, recommended: 'Provide at least six deterministic golden cases.' });
  }
  if (!Array.isArray(perCaseRecall) || perCaseRecall.length < 6
      || perCaseRecall.some((value) => !Number.isFinite(value) || value < 1)) {
    issues.push({ severity: 'high', issue: 'per_case_recall_incomplete', actual: perCaseRecall, expected: 'at least 6 cases at recall 1.0', recommended: 'Require 100% recall for every golden case.' });
  }
  if (Number.isFinite(recallBaseline) && Number.isFinite(precisionBaseline)
      && Number.isFinite(recall) && Number.isFinite(precision)) {
    if (recall < recallBaseline * 0.95) {
      issues.push({ severity: 'high', issue: 'recall_regression_from_baseline', actual: recall, baseline: recallBaseline, recommended: 'Retrain embedding model with baseline preserved' });
    }
    if (precision < precisionBaseline * 0.95) {
      issues.push({ severity: 'medium', issue: 'precision_regression_from_baseline', actual: precision, baseline: precisionBaseline, recommended: 'Verify embedding changes maintained retrieval quality' });
    }
  }
  return {
    valid: issues.length === 0,
    issues,
    dimensionTier: normalizeToMatryoshkaDimension(embeddingDim || 768),
    semanticScore: getSemanticScore(normalizeToMatryoshkaDimension(embeddingDim || 768)),
  };
}

function buildMatryoshkaConfig(options = {}) {
  const baseDim = normalizeToMatryoshkaDimension(options.embeddingDim || 768);
  const tiers = [];
  let currentDim = 256;
  while (currentDim <= baseDim) {
    if (MATRYOSHKA_DIMENSIONS.includes(currentDim)) {
      tiers.push({
        dimension: currentDim,
        semanticScore: getSemanticScore(currentDim),
        useCase: currentDim < 512 ? 'fast_query' : currentDim < 1536 ? 'balanced' : 'full_precision',
      });
    }
    currentDim += 256;
  }
  return {
    baseDimension: baseDim,
    tiers,
    retrievalStrategy: options.retrievalStrategy || 'progressive_disclosure',
    hybridRouting: options.hybridRouting !== undefined ? options.hybridRouting : true,
    embeddingModel: options.embeddingModel || 'text-embedding-3-large',
    provider: options.provider || 'openai',
    qualityThresholds: EMBEDDING_QUALITY_THRESHOLDS,
    rolloutPlan: [
      'Use 256-dim embeddings for initial query filtering (fast, cheap)',
      'Re-rank top candidates at 768-dim for balanced quality',
      'Use full 1536+ dim embeddings for final precision or when cross-encoder confirms relevance',
      'Log dimension-tier performance metrics for continuous optimization',
    ],
  };
}

function distillMemoryForEmbedding(memories = [], options = {}) {
  const safeMemories = Array.isArray(memories) ? memories : [];
  const layerGroups = {
    [PYRAMID_LAYERS.L3_PERSONA_SOP]: [],
    [PYRAMID_LAYERS.L2_SCENARIO]: [],
    [PYRAMID_LAYERS.L1_ATOM]: [],
    [PYRAMID_LAYERS.L0_CONVERSATION]: [],
  };
  const maxItemsPerLayer = options.maxItemsPerLayer || 100;
  for (const memory of safeMemories) {
    const layer = classifyMemoryLayer(memory);
    if (layerGroups[layer].length < maxItemsPerLayer) {
      layerGroups[layer].push({
        ...memory,
        pyramidLayer: layer,
        semanticWeight: getSemanticScore(normalizeToMatryoshkaDimension(options.embeddingDim || 768)),
      });
    }
  }
  return {
    kind: 'matryoshka-memory-distillation',
    totalMemories: safeMemories.length,
    layerDistribution: Object.entries(layerGroups).map(([layer, items]) => ({
      layer,
      count: items.length,
      contentPreview: items.slice(0, 3).map(i => String(i.content || i.title || '').slice(0, 50)),
    })),
    layers: layerGroups,
    embeddingStrategy: buildMatryoshkaConfig(options),
  };
}

function generateEmbeddingPreventionRules(qualityReport) {
  const rules = [];
  if (!qualityReport.valid) {
    for (const issue of qualityReport.issues) {
      if (issue.issue === 'recall_below_threshold') {
        const actualRecall = String(issue.actual).replace('.', '\\.');
        rules.push({
          id: 'block-low-embedding-recall',
          name: 'Block embedding changes with low recall',
          category: 'Embedding Quality',
          signal: '👎',
          defaultAction: 'block',
          severity: 'high',
          pattern: `(embedding|vector|retrieval).*(recall\\s*[:=]\\s*${actualRecall})`,
          problem: 'Prevents deployment of embedding configurations that fail minimum recall thresholds.',
          roi: 'Protects RAG pipeline effectiveness by ensuring embedding quality gates are maintained.',
          rollout: 'Enable for all RAG workflows to prevent quality regressions.',
        });
      }
    }
  }
  return rules;
}

module.exports = {
  PYRAMID_LAYERS,
  MATRYOSHKA_DIMENSIONS,
  EMBEDDING_QUALITY_THRESHOLDS,
  buildMatryoshkaConfig,
  classifyMemoryLayer,
  distillMemoryForEmbedding,
  generateEmbeddingPreventionRules,
  getSemanticScore,
  normalizeToMatryoshkaDimension,
  validateEmbeddingQuality,
  buildEmbeddingTaskPrefix,
};
