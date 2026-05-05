#!/usr/bin/env node
'use strict';

const GEMINI_EMBEDDING_2_MODEL = 'gemini-embedding-2';
const DEFAULT_OUTPUT_DIMENSIONALITY = 768;
const RECOMMENDED_OUTPUT_DIMENSIONS = [3072, 1536, 768];

const MULTIMODAL_LIMITS = Object.freeze({
  maxTextTokens: 8192,
  maxImages: 6,
  maxVideoSeconds: 120,
  maxAudioSeconds: 180,
  maxPdfPages: 6,
  languages: '100+',
});

const ASYMMETRIC_TASKS = new Set([
  'question answering',
  'fact checking',
  'code retrieval',
  'search result',
]);

const SYMMETRIC_TASKS = new Set([
  'anomaly detection',
  'classification',
  'clustering',
  'sentence similarity',
]);

const GEMINI_TASK_TYPES = Object.freeze({
  query: 'RETRIEVAL_QUERY',
  document: 'RETRIEVAL_DOCUMENT',
  classification: 'CLASSIFICATION',
  clustering: 'CLUSTERING',
  sentenceSimilarity: 'SEMANTIC_SIMILARITY',
});

function normalizeTask(task, fallback = 'code retrieval') {
  const normalized = String(task || fallback)
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  return normalized || fallback;
}

function normalizeEmbeddingKind(kind) {
  const normalized = String(kind || 'document').trim().toLowerCase();
  if (normalized === 'query' || normalized === 'document' || normalized === 'symmetric') {
    return normalized;
  }
  return 'document';
}

function isSymmetricTask(task) {
  return SYMMETRIC_TASKS.has(normalizeTask(task));
}

function prepareEmbeddingText({ content, kind = 'document', task = 'code retrieval', title = 'none' } = {}) {
  const text = String(content || '').trim();
  const normalizedTask = normalizeTask(task);
  const normalizedKind = isSymmetricTask(normalizedTask) ? 'symmetric' : normalizeEmbeddingKind(kind);

  if (!text) return '';

  if (normalizedKind === 'query' || normalizedKind === 'symmetric') {
    return `task: ${normalizedTask} | query: ${text}`;
  }

  const safeTitle = String(title || 'none').trim() || 'none';
  return `title: ${safeTitle} | text: ${text}`;
}

function resolveGeminiTaskType({ kind = 'document', task = 'code retrieval' } = {}) {
  const normalizedTask = normalizeTask(task);
  if (normalizedTask === 'classification') return GEMINI_TASK_TYPES.classification;
  if (normalizedTask === 'clustering') return GEMINI_TASK_TYPES.clustering;
  if (normalizedTask === 'sentence similarity') return GEMINI_TASK_TYPES.sentenceSimilarity;

  const normalizedKind = normalizeEmbeddingKind(kind);
  if (normalizedKind === 'query') return GEMINI_TASK_TYPES.query;
  if (normalizedKind === 'document') return GEMINI_TASK_TYPES.document;
  return undefined;
}

function resolveGeminiModelResource(model) {
  const normalized = String(model || GEMINI_EMBEDDING_2_MODEL).trim() || GEMINI_EMBEDDING_2_MODEL;
  return normalized.startsWith('models/') ? normalized : `models/${normalized}`;
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function normalizeOutputDimensionality(value) {
  const parsed = parsePositiveInteger(value, DEFAULT_OUTPUT_DIMENSIONALITY);
  if (RECOMMENDED_OUTPUT_DIMENSIONS.includes(parsed)) return parsed;
  return RECOMMENDED_OUTPUT_DIMENSIONS.reduce((best, candidate) => (
    Math.abs(candidate - parsed) < Math.abs(best - parsed) ? candidate : best
  ), DEFAULT_OUTPUT_DIMENSIONALITY);
}

function resolveGeminiEmbeddingConfig(env = process.env) {
  const provider = String(env.THUMBGATE_EMBED_PROVIDER || env.THUMBGATE_EMBEDDING_PROVIDER || 'local')
    .trim()
    .toLowerCase();
  const explicitGemini = parseBoolean(env.THUMBGATE_GEMINI_EMBEDDINGS, false);
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY || '';
  const enabled = explicitGemini || provider === 'gemini';

  return {
    enabled,
    provider: enabled ? 'gemini' : 'local',
    model: String(env.THUMBGATE_GEMINI_EMBED_MODEL || GEMINI_EMBEDDING_2_MODEL).trim() || GEMINI_EMBEDDING_2_MODEL,
    apiKey,
    apiBaseUrl: trimTrailingSlashes(env.THUMBGATE_GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta'),
    outputDimensionality: normalizeOutputDimensionality(env.THUMBGATE_GEMINI_EMBED_DIM || env.THUMBGATE_EMBED_DIM),
    fallbackToLocal: parseBoolean(env.THUMBGATE_GEMINI_EMBED_FALLBACK_LOCAL, true),
    defaultTask: normalizeTask(env.THUMBGATE_GEMINI_EMBED_TASK || 'code retrieval'),
    multimodalLimits: MULTIMODAL_LIMITS,
    recommendedOutputDimensions: RECOMMENDED_OUTPUT_DIMENSIONS,
  };
}

function trimTrailingSlashes(value) {
  let text = String(value);
  while (text.endsWith('/')) text = text.slice(0, -1);
  return text;
}

function buildGeminiEmbeddingRolloutPlan(args = {}) {
  const corpusItems = parsePositiveInteger(args.corpusItems, 5000);
  const outputDimensionality = normalizeOutputDimensionality(args.outputDimensionality || args.maxEmbeddingDim);
  const task = normalizeTask(args.task || 'code retrieval');
  const useBatchApi = args.useBatchApi !== false;
  const vectorMb = Number(((corpusItems * outputDimensionality * 4) / (1024 * 1024)).toFixed(2));

  return {
    model: GEMINI_EMBEDDING_2_MODEL,
    task,
    outputDimensionality,
    corpusItems,
    estimatedFloat32Mb: vectorMb,
    taskPrefixes: {
      query: prepareEmbeddingText({ kind: 'query', task, content: '{query}' }),
      document: prepareEmbeddingText({ kind: 'document', task, title: '{title}', content: '{content}' }),
      symmetric: prepareEmbeddingText({ kind: 'symmetric', task: 'classification', content: '{content}' }),
    },
    apiHints: {
      queryTaskType: resolveGeminiTaskType({ kind: 'query', task }),
      documentTaskType: resolveGeminiTaskType({ kind: 'document', task }),
      modelResource: resolveGeminiModelResource(GEMINI_EMBEDDING_2_MODEL),
    },
    modalityLimits: MULTIMODAL_LIMITS,
    economics: {
      recommendedDimensions: RECOMMENDED_OUTPUT_DIMENSIONS,
      storageDefault: outputDimensionality,
      batchApi: useBatchApi ? 'Use for offline re-indexing; Google positions Batch API embeddings at 50% of default price.' : 'Skip Batch API only for latency-sensitive incremental writes.',
    },
    rolloutSteps: [
      'Keep local embeddings as the default offline path.',
      'Enable Gemini Embedding 2 only when a Gemini API key is present.',
      'Use task-specific query/document prefixes at index and retrieval time.',
      'Start at 768 dimensions, then benchmark 1536 only if recall misses show up.',
      'Use Batch API for full re-indexes and online embed_content for fresh feedback events.',
    ],
  };
}

module.exports = {
  ASYMMETRIC_TASKS,
  DEFAULT_OUTPUT_DIMENSIONALITY,
  GEMINI_EMBEDDING_2_MODEL,
  MULTIMODAL_LIMITS,
  RECOMMENDED_OUTPUT_DIMENSIONS,
  SYMMETRIC_TASKS,
  GEMINI_TASK_TYPES,
  buildGeminiEmbeddingRolloutPlan,
  isSymmetricTask,
  normalizeOutputDimensionality,
  normalizeTask,
  prepareEmbeddingText,
  resolveGeminiEmbeddingConfig,
  resolveGeminiModelResource,
  resolveGeminiTaskType,
};
