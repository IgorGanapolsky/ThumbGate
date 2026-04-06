'use strict';

const fs = require('fs');
const path = require('path');
const {
  resolveEmbeddingProfile,
  writeModelFitReport,
  resolveFeedbackDir,
} = require('./local-model-profile');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_FEEDBACK_DIR = path.join(PROJECT_ROOT, '.claude', 'memory', 'feedback');
const DEFAULT_LANCE_DIR = path.join(DEFAULT_FEEDBACK_DIR, 'lancedb');

// Module-level cache — prevents re-importing on every upsertFeedback() call
// First ESM import takes ~200ms; second is instant from cache.
let _lancedb = null;
let _lancedbLoader = null;
const _pipelineCache = new Map();
let _lastEmbeddingProfile = null;
let _pipelineLoader = null;
const TABLE_NAME = 'thumbgate_memories';

async function getLanceDB() {
  if (!_lancedb) {
    _lancedb = _lancedbLoader ? await _lancedbLoader() : await import('@lancedb/lancedb');
  }
  return _lancedb;
}

function getFeedbackDir() {
  return resolveFeedbackDir(process.env.THUMBGATE_FEEDBACK_DIR || DEFAULT_FEEDBACK_DIR);
}

function getLanceDir() {
  return path.join(getFeedbackDir(), 'lancedb');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function truncateForEmbedding(text, maxChars) {
  const raw = String(text || '');
  if (!maxChars || raw.length <= maxChars) return raw;
  return raw.slice(0, maxChars);
}

async function loadPipelineForProfile(profile) {
  const cacheKey = `${profile.model}::${profile.quantized}`;
  if (_pipelineCache.has(cacheKey)) {
    return _pipelineCache.get(cacheKey);
  }

  if (process.env.THUMBGATE_VECTOR_FORCE_PRIMARY_FAILURE === 'true' && profile.id !== 'fallback') {
    throw new Error('Forced primary embedding profile failure');
  }

  const pipeline = _pipelineLoader || (await import('@huggingface/transformers')).pipeline;
  const pipe = await pipeline('feature-extraction', profile.model, {
    quantized: profile.quantized,
  });
  _pipelineCache.set(cacheKey, pipe);
  return pipe;
}

async function getEmbeddingPipeline() {
  const resolved = resolveEmbeddingProfile();
  const report = writeModelFitReport(getFeedbackDir(), { resolved }).report;

  try {
    const pipe = await loadPipelineForProfile(resolved.selectedProfile);
    _lastEmbeddingProfile = {
      ...report,
      activeProfile: resolved.selectedProfile,
      fallbackUsed: false,
    };
    return { pipe, profile: _lastEmbeddingProfile };
  } catch (primaryError) {
    const fallback = resolved.fallbackProfile;
    const pipe = await loadPipelineForProfile(fallback);
    _lastEmbeddingProfile = {
      ...report,
      activeProfile: fallback,
      fallbackUsed: true,
      fallbackReason: primaryError.message,
    };
    writeModelFitReport(getFeedbackDir(), {
      resolved: {
        ...resolved,
        selectedProfile: fallback,
      },
    });
    return { pipe, profile: _lastEmbeddingProfile };
  }
}

// Stub embed support for unit tests — avoids HuggingFace ONNX model download.
// Set THUMBGATE_VECTOR_STUB_EMBED=true to get a deterministic 384-dim unit vector.
// The real embed() is used in production and integration tests
// (gated by absence of this env var).
async function embed(text) {
  if (process.env.THUMBGATE_VECTOR_STUB_EMBED === 'true') {
    // Deterministic 384-dim unit vector: first element = 1.0, rest = 0.0
    const stub = Array(384).fill(0);
    stub[0] = 1.0;
    return stub;
  }
  const { pipe, profile } = await getEmbeddingPipeline();
  const output = await pipe(truncateForEmbedding(text, profile.activeProfile.maxChars), {
    pooling: 'mean',
    normalize: true,
  });
  return Array.from(output.data); // Float32Array -> plain number[] for LanceDB Arrow serialization
}

async function upsertFeedback(feedbackEvent) {
  const lanceDir = getLanceDir();
  ensureDir(lanceDir);

  const { connect } = await getLanceDB();
  const db = await connect(lanceDir);

  const textForEmbedding = [
    feedbackEvent.context || '',
    (feedbackEvent.tags || []).join(' '),
    feedbackEvent.whatWentWrong || '',
    feedbackEvent.whatWorked || '',
  ].filter(Boolean).join('. ');

  const vector = await embed(textForEmbedding);

  const record = {
    id: feedbackEvent.id,
    text: textForEmbedding,
    vector,
    signal: feedbackEvent.signal,
    tags: (feedbackEvent.tags || []).join(','),
    timestamp: feedbackEvent.timestamp,
    context: feedbackEvent.context || '',
  };

  const tableNames = await db.tableNames();
  if (tableNames.includes(TABLE_NAME)) {
    const table = await db.openTable(TABLE_NAME);
    await table.add([record]);
  } else {
    await db.createTable(TABLE_NAME, [record]);
  }
}

async function searchSimilar(queryText, limit = 5) {
  const lanceDir = getLanceDir();
  ensureDir(lanceDir);

  const { connect } = await getLanceDB();
  const db = await connect(lanceDir);

  const tableNames = await db.tableNames();
  if (!tableNames.includes(TABLE_NAME)) return [];

  const vector = await embed(queryText);
  const table = await db.openTable(TABLE_NAME);
  const results = await table.search(vector).limit(limit).toArray();
  return results;
}

function getEmbeddingConfig() {
  return resolveEmbeddingProfile();
}

function getLastEmbeddingProfile() {
  return _lastEmbeddingProfile;
}

function setPipelineLoaderForTests(loader) {
  _pipelineLoader = loader;
  _pipelineCache.clear();
  _lastEmbeddingProfile = null;
}

function setLanceLoaderForTests(loader) {
  _lancedbLoader = loader;
  _lancedb = null;
}

module.exports = {
  upsertFeedback,
  searchSimilar,
  TABLE_NAME,
  getEmbeddingConfig,
  getLastEmbeddingProfile,
  setPipelineLoaderForTests,
  setLanceLoaderForTests,
  truncateForEmbedding,
};
