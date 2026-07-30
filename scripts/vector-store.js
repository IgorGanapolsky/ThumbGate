'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./fs-utils');
const {
  resolveEmbeddingProfile,
  writeModelFitReport,
  resolveFeedbackDir,
} = require('./local-model-profile');
const {
  prepareEmbeddingText,
  resolveGeminiEmbeddingConfig,
  resolveGeminiModelResource,
  resolveGeminiTaskType,
} = require('./gemini-embedding-policy');
const { runStep } = require('./durability/step');

const DEFAULT_FEEDBACK_DIR = resolveFeedbackDir();
const DEFAULT_LANCE_DIR = path.join(DEFAULT_FEEDBACK_DIR, 'lancedb');

// Module-level cache — prevents re-importing on every upsertFeedback() call
// First ESM import takes ~200ms; second is instant from cache.
let _lancedb = null;
let _lancedbLoader = null;
const _pipelineCache = new Map();
let _lastEmbeddingProfile = null;
let _pipelineLoader = null;
let _geminiEmbedderForTests = null;
const TABLE_NAME = 'thumbgate_memories';
const FEATURE_HASH_DIMENSIONS = 384;

async function getLanceDB() {
  if (!_lancedb) {
    _lancedb = _lancedbLoader ? await _lancedbLoader() : await import('@lancedb/lancedb');
  }
  return _lancedb;
}

function getFeedbackDir() {
  return resolveFeedbackDir();
}

function getLanceDir() {
  return path.join(getFeedbackDir(), 'lancedb');
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

function hasLocalTransformerProvider() {
  if (_pipelineLoader) return true;
  try {
    require.resolve('@huggingface/transformers');
    return true;
  } catch {
    return false;
  }
}

function getOllamaEmbeddingConfig() {
  const model = String(process.env.THUMBGATE_OLLAMA_EMBED_MODEL || '').trim();
  let endpoint = String(
    process.env.THUMBGATE_OLLAMA_ENDPOINT
    || process.env.OLLAMA_HOST
    || 'http://127.0.0.1:11434',
  ).trim();
  if (endpoint && !/^https?:\/\//i.test(endpoint)) endpoint = `http://${endpoint}`;
  return {
    enabled: Boolean(model),
    model,
    endpoint: endpoint.replace(/\/+$/, ''),
    timeoutMs: Math.max(
      250,
      Math.min(30_000, Number(process.env.THUMBGATE_OLLAMA_TIMEOUT_MS) || 10_000),
    ),
  };
}

/**
 * Synchronous capability check used by hot-path routing. This reports only
 * semantic providers, never the deterministic feature-hash degradation.
 */
function hasSemanticEmbeddingProvider() {
  if (process.env.THUMBGATE_VECTOR_STUB_EMBED === 'true') return true;
  if (getOllamaEmbeddingConfig().enabled) return true;
  if (hasLocalTransformerProvider()) return true;
  try {
    const config = resolveGeminiEmbeddingConfig();
    return config.provider === 'coreai' || Boolean(config.enabled && config.apiKey);
  } catch {
    return false;
  }
}

function fnv1a32(value) {
  let hash = 0x811c9dc5;
  const bytes = Buffer.from(String(value), 'utf8');
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function addHashedFeature(vector, feature, weight) {
  const hash = fnv1a32(feature);
  const index = hash % vector.length;
  const sign = (hash & 0x80000000) === 0 ? 1 : -1;
  vector[index] += sign * weight;
}

function embedWithFeatureHash(text) {
  const vector = Array(FEATURE_HASH_DIMENSIONS).fill(0);
  const tokens = String(text || '').toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    addHashedFeature(vector, `token:${token}`, 1);
    if (index > 0) {
      addHashedFeature(vector, `bigram:${tokens[index - 1]}:${token}`, 0.6);
    }

    const bounded = `^${token.slice(0, 64)}$`;
    for (let offset = 0; offset <= bounded.length - 3; offset += 1) {
      addHashedFeature(vector, `trigram:${bounded.slice(offset, offset + 3)}`, 0.3);
    }
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  if (norm === 0) {
    vector[0] = 1;
    return vector;
  }
  return vector.map((value) => value / norm);
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
async function embedWithGemini(text, options = {}) {
  const config = resolveGeminiEmbeddingConfig();
  if (!config.apiKey && !_geminiEmbedderForTests) {
    throw new Error('Gemini embeddings requested but no GEMINI_API_KEY, GOOGLE_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY is configured');
  }

  const preparedText = prepareEmbeddingText({
    content: text,
    kind: options.kind,
    task: options.task || config.defaultTask,
    title: options.title,
  });

  if (_geminiEmbedderForTests) {
    return _geminiEmbedderForTests(preparedText, config, options);
  }

  if (typeof fetch !== 'function') {
    throw new Error('Gemini embeddings require global fetch. Use Node 18.18+ or the local embedding provider.');
  }

  const modelResource = resolveGeminiModelResource(config.model);
  const requestBody = {
    model: modelResource,
    content: {
      parts: [{ text: preparedText }],
    },
    outputDimensionality: config.outputDimensionality,
  };
  const taskType = resolveGeminiTaskType({
    kind: options.kind,
    task: options.task || config.defaultTask,
  });
  if (taskType) {
    requestBody.taskType = taskType;
  }
  if (taskType === 'RETRIEVAL_DOCUMENT' && options.title) {
    requestBody.title = String(options.title);
  }

  const endpoint = `${config.apiBaseUrl}/${modelResource}:embedContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.apiKey,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Gemini embedding request failed: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 240)}` : ''}`);
  }

  const payload = await response.json();
  const values = payload && (
    (payload.embedding && payload.embedding.values)
    || (Array.isArray(payload.embeddings) && payload.embeddings[0] && payload.embeddings[0].values)
  );

  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Gemini embedding response did not include vector values');
  }

  return values.map(Number);
}

async function embedWithCoreAI(text, options = {}) {
  if (process.platform !== 'darwin') {
    throw new Error('Core AI is only supported on macOS');
  }
  const endpoint = process.env.THUMBGATE_COREAI_ENDPOINT || 'http://localhost:8088';
  try {
    const res = await fetch(`${endpoint}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, options }),
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const payload = await res.json();
      if (Array.isArray(payload.embedding)) {
        return payload.embedding.map(Number);
      }
    }
  } catch (err) {
    throw new Error(`Core AI local service unavailable: ${err.message}`);
  }
  throw new Error('Core AI local service did not return a valid embedding');
}

async function embedWithOllama(text, options = {}) {
  const config = getOllamaEmbeddingConfig();
  if (!config.enabled) {
    throw new Error('Ollama embeddings require THUMBGATE_OLLAMA_EMBED_MODEL');
  }
  if (typeof fetch !== 'function') {
    throw new Error('Ollama embeddings require global fetch. Use Node 18.18+.');
  }

  let response;
  try {
    response = await fetch(`${config.endpoint}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        input: String(text || ''),
        truncate: true,
        dimensions: options.outputDimensionality || undefined,
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw new Error(`Ollama embedding service unavailable: ${error.message}`);
  }

  if (!response.ok) {
    throw new Error(`Ollama embedding request failed: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  const vector = Array.isArray(payload.embeddings) ? payload.embeddings[0] : null;
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error('Ollama embedding response did not include vector values');
  }
  return vector.map(Number);
}

async function embed(text, options = {}) {
  if (process.env.THUMBGATE_VECTOR_STUB_EMBED === 'true') {
    // Deterministic 384-dim unit vector: first element = 1.0, rest = 0.0
    const stub = Array(384).fill(0);
    stub[0] = 1.0;
    return stub;
  }
  const geminiConfig = resolveGeminiEmbeddingConfig();
  if (geminiConfig.provider === 'coreai') {
    try {
      const vector = await embedWithCoreAI(text, options);
      _lastEmbeddingProfile = {
        generatedAt: new Date().toISOString(),
        source: 'local-coreai',
        activeProfile: {
          id: 'coreai',
          model: 'Core AI local model',
          outputDimensionality: vector.length,
          task: options.task || 'code retrieval',
          rationale: 'Local Core AI Apple Silicon accelerated path.',
        },
        fallbackUsed: false,
      };
      return vector;
    } catch (coreaiError) {
      console.warn(`Core AI embedding failed, falling back to local: ${coreaiError.message}`);
    }
  }
  const ollamaConfig = getOllamaEmbeddingConfig();
  if (ollamaConfig.enabled) {
    try {
      const vector = await embedWithOllama(text, options);
      _lastEmbeddingProfile = {
        generatedAt: new Date().toISOString(),
        source: 'local-ollama',
        activeProfile: {
          id: 'ollama',
          model: ollamaConfig.model,
          outputDimensionality: vector.length,
          task: options.task || 'code retrieval',
          rationale: 'Explicit local Ollama semantic embedding provider.',
          qualityTier: 'production',
        },
        fallbackUsed: false,
      };
      return vector;
    } catch (ollamaError) {
      console.warn(`Ollama embedding failed, falling back: ${ollamaError.message}`);
    }
  }
  if (geminiConfig.enabled) {
    try {
      const vector = await embedWithGemini(text, options);
      _lastEmbeddingProfile = {
        generatedAt: new Date().toISOString(),
        source: 'managed',
        activeProfile: {
          id: 'gemini',
          model: geminiConfig.model,
          outputDimensionality: geminiConfig.outputDimensionality,
          task: options.task || geminiConfig.defaultTask,
          rationale: 'Managed Gemini Embedding 2 path with task-specific query/document prefixes.',
        },
        fallbackUsed: false,
      };
      return vector;
    } catch (geminiError) {
      if (!geminiConfig.fallbackToLocal) {
        throw geminiError;
      }
      // Do not log raw provider/user-controlled error text (Sonar jssecurity:S5145).
      const code = geminiError && (geminiError.code || geminiError.name || 'Error');
      console.warn(`Gemini embedding fallback: ${code}`);
    }
  }
  if (hasLocalTransformerProvider()) {
    try {
      const { pipe, profile } = await getEmbeddingPipeline();
      const output = await pipe(truncateForEmbedding(text, profile.activeProfile.maxChars), {
        pooling: 'mean',
        normalize: true,
      });
      return Array.from(output.data); // Float32Array -> plain number[] for LanceDB Arrow serialization
    } catch (transformerError) {
      console.warn(`Transformers.js embedding fallback: ${transformerError.message}`);
    }
  }

  const vector = embedWithFeatureHash(text);
  // Feature-hash is a last-resort degrade, not production semantic quality.
  // Callers (prove/eval/chat health) must treat quality_tier=degraded.
  _lastEmbeddingProfile = {
    generatedAt: new Date().toISOString(),
    source: 'built-in',
    activeProfile: {
      id: 'feature-hash-v1',
      model: 'ThumbGate feature hashing',
      outputDimensionality: FEATURE_HASH_DIMENSIONS,
      task: options.task || 'code retrieval',
      rationale: 'DEGRADED: deterministic zero-dependency hash embedding — not semantic. Configure Gemini or local transformers for production retrieval quality.',
      qualityTier: 'degraded',
    },
    fallbackUsed: true,
    fallbackReason: 'no_managed_or_transformer_embedder',
  };
  return vector;
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

  // Embed is pure CPU/model work (managed, optional Transformers.js, built-in,
  // or stub) and deterministic for local providers.
  // for a given input, so no retry is needed here. Retry wraps the table
  // write below, which is the actual I/O failure surface.
  const vector = await embed(textForEmbedding, {
    kind: 'document',
    task: 'code retrieval',
    title: feedbackEvent.id || 'thumbgate feedback',
  });

  const record = {
    id: feedbackEvent.id,
    text: textForEmbedding,
    vector,
    signal: feedbackEvent.signal,
    tags: (feedbackEvent.tags || []).join(','),
    timestamp: feedbackEvent.timestamp,
    context: feedbackEvent.context || '',
  };

  // Wrap the actual LanceDB write with retry. LanceDB is local-disk in our
  // deployment but can fail on transient fs contention (EBUSY on Windows,
  // lock timeouts on WSL, disk-full edge cases). `feedbackEvent.id` already
  // acts as a stable row identity — re-running this step with the same
  // event produces the same row, so retries are safe.
  await runStep('vector-store.upsertFeedback', {
    retries: 2,
    logger: (msg) => console.warn(msg),
  }, async () => {
    const tableNames = await db.tableNames();
    if (tableNames.includes(TABLE_NAME)) {
      const table = await db.openTable(TABLE_NAME);
      await table.add([record]);
    } else {
      await db.createTable(TABLE_NAME, [record]);
    }
  });
}

async function searchSimilar(queryText, limit = 5) {
  const lanceDir = getLanceDir();
  ensureDir(lanceDir);

  const { connect } = await getLanceDB();
  const db = await connect(lanceDir);

  const tableNames = await db.tableNames();
  if (!tableNames.includes(TABLE_NAME)) return [];

  const vector = await embed(queryText, {
    kind: 'query',
    task: 'code retrieval',
  });
  const table = await db.openTable(TABLE_NAME);
  const results = await table.search(vector).limit(limit).toArray();
  return results;
}

function getEmbeddingConfig() {
  return {
    ...resolveEmbeddingProfile(),
    managed: resolveGeminiEmbeddingConfig(),
  };
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

function setGeminiEmbedderForTests(loader) {
  _geminiEmbedderForTests = loader;
  _lastEmbeddingProfile = null;
}

module.exports = {
  upsertFeedback,
  searchSimilar,
  embed,
  TABLE_NAME,
  getEmbeddingConfig,
  getLastEmbeddingProfile,
  setPipelineLoaderForTests,
  setLanceLoaderForTests,
  setGeminiEmbedderForTests,
  truncateForEmbedding,
  embedWithFeatureHash,
  embedWithOllama,
  getOllamaEmbeddingConfig,
  hasSemanticEmbeddingProvider,
};
