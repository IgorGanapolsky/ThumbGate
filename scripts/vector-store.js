'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
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
const _ragWarmState = new Map();
let _lastEmbeddingProfile = null;
let _pipelineLoader = null;
let _geminiEmbedderForTests = null;
const TABLE_NAME = 'thumbgate_memories';
const RAG_TABLE_PREFIX = 'thumbgate_rag_v2';
const RAG_INDEX_SCHEMA_VERSION = 2;
const FEATURE_HASH_DIMENSIONS = 384;
const DEFAULT_VECTOR_TIMEOUT_MS = 8000;
const EMBEDDING_CACHE_DIRNAME = 'embedding-cache-v2';

async function getLanceDB() {
  if (!_lancedb) {
    _lancedb = _lancedbLoader ? await _lancedbLoader() : await import('@lancedb/lancedb');
  }
  return _lancedb;
}

function getFeedbackDir(explicitDir) {
  return explicitDir || resolveFeedbackDir();
}

function getLanceDir(explicitDir) {
  return path.join(getFeedbackDir(explicitDir), 'lancedb');
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

function fnv1a32(value) {
  let hash = 0x811c9dc5;
  const bytes = Buffer.from(String(value), 'utf8');
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
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
    signal: AbortSignal.timeout(Number(options.timeoutMs) || DEFAULT_VECTOR_TIMEOUT_MS),
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

async function embed(text, options = {}) {
  if (process.env.THUMBGATE_VECTOR_STUB_EMBED === 'true') {
    // Deterministic 384-dim unit vector: first element = 1.0, rest = 0.0
    const stub = Array(384).fill(0);
    stub[0] = 1.0;
    _lastEmbeddingProfile = {
      generatedAt: new Date().toISOString(),
      source: 'test',
      activeProfile: {
        id: 'stub',
        model: 'ThumbGate deterministic test embedding',
        outputDimensionality: stub.length,
        task: options.task || 'code retrieval',
      },
      fallbackUsed: false,
    };
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
      console.warn(`Gemini embedding fallback: ${geminiError.message}`);
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

function getActiveEmbeddingIdentity(vector) {
  const profile = _lastEmbeddingProfile && _lastEmbeddingProfile.activeProfile || {};
  const model = String(profile.model || profile.id || 'unknown');
  const modelHash = fnv1a32(model).toString(16).padStart(8, '0');
  return {
    model,
    modelHash,
    dimensions: Array.isArray(vector) ? vector.length : Number(profile.outputDimensionality || 0),
    source: _lastEmbeddingProfile && _lastEmbeddingProfile.source || 'unknown',
    fallbackUsed: Boolean(_lastEmbeddingProfile && _lastEmbeddingProfile.fallbackUsed),
  };
}

function resolveRagTableName(identity) {
  const dimensions = Number(identity && identity.dimensions);
  if (!Number.isFinite(dimensions) || dimensions <= 0) {
    throw new Error('embedding dimensions are required for a versioned RAG index');
  }
  const modelHash = String(identity.modelHash || 'unknown').replaceAll(/[^a-z0-9]/gi, '').slice(0, 12);
  return `${RAG_TABLE_PREFIX}_${modelHash}_${dimensions}`;
}

function resolveConfiguredEmbeddingKey() {
  if (process.env.THUMBGATE_VECTOR_STUB_EMBED === 'true') return 'stub:384:v1';
  const managed = resolveGeminiEmbeddingConfig();
  if (managed.provider === 'coreai') return 'coreai:configured';
  if (managed.enabled) {
    return `gemini:${managed.model}:${managed.outputDimensionality}`;
  }
  if (hasLocalTransformerProvider()) {
    const selected = resolveEmbeddingProfile().selectedProfile;
    return `transformers:${selected.model}:${selected.quantized ? 'q' : 'f'}`;
  }
  return `feature-hash:${FEATURE_HASH_DIMENSIONS}:v1`;
}

function embeddingCachePath(text, options = {}) {
  const configuredKey = resolveConfiguredEmbeddingKey();
  const textHash = sha256(text);
  const fileName = `${sha256(`${configuredKey}:${textHash}`)}.json`;
  return {
    configuredKey,
    textHash,
    filePath: path.join(getLanceDir(options.feedbackDir), EMBEDDING_CACHE_DIRNAME, fileName),
  };
}

function readCachedEmbedding(text, options = {}) {
  const cache = embeddingCachePath(text, options);
  if (!fs.existsSync(cache.filePath)) return null;
  try {
    const record = JSON.parse(fs.readFileSync(cache.filePath, 'utf8'));
    if (
      record.configuredKey !== cache.configuredKey
      || record.textHash !== cache.textHash
      || !Array.isArray(record.vector)
      || !record.identity
      || record.identity.fallbackUsed === true
    ) return null;
    return record;
  } catch {
    return null;
  }
}

function writeCachedEmbedding(text, vector, identity, options = {}) {
  if (identity.fallbackUsed === true) return;
  const cache = embeddingCachePath(text, options);
  ensureDir(path.dirname(cache.filePath));
  fs.writeFileSync(cache.filePath, `${JSON.stringify({
    schemaVersion: 1,
    configuredKey: cache.configuredKey,
    textHash: cache.textHash,
    identity,
    vector,
    createdAt: new Date().toISOString(),
  })}\n`, 'utf8');
}

function escapeSqlLiteral(value) {
  return String(value || '').replaceAll("'", "''");
}

async function replaceRows(table, records) {
  if (typeof table.delete === 'function') {
    for (const record of records) {
      await table.delete(`id = '${escapeSqlLiteral(record.id)}'`);
    }
  }
  await table.add(records);
}

function normalizeIndexRecord(record, vector, identity) {
  const scope = record.scope || {};
  return {
    id: String(record.id || ''),
    text: String(record.text || ''),
    vector,
    source: String(record.source || 'unknown'),
    documentId: String(record.documentId || ''),
    sourceKey: String(record.sourceKey || ''),
    parentId: String(record.parentId || ''),
    tenantId: String(scope.tenantId || record.tenantId || 'local'),
    projectId: String(scope.projectId || record.projectId || ''),
    entityId: String(scope.entityId || record.entityId || ''),
    visibility: String(scope.visibility || record.visibility || 'private'),
    isCurrent: record.isCurrent !== false,
    trustLevel: String(record.trustLevel || 'untrusted'),
    instructionRisk: Boolean(record.instructionRisk && (
      record.instructionRisk.detected === true || record.instructionRisk === true
    )),
    version: Number(record.version || 1),
    startOffset: Number(record.startOffset || 0),
    endOffset: Number(record.endOffset || String(record.text || '').length),
    title: String(record.title || ''),
    tags: Array.isArray(record.tags) ? record.tags.join(',') : String(record.tags || ''),
    signal: String(record.signal || ''),
    timestamp: String(record.timestamp || record.importedAt || ''),
    context: String(record.context || record.text || ''),
    embeddingModel: identity.model,
    embeddingModelHash: identity.modelHash,
    embeddingDimensions: identity.dimensions,
    embeddingSource: identity.source,
    embeddingFallback: identity.fallbackUsed,
    indexSchemaVersion: RAG_INDEX_SCHEMA_VERSION,
  };
}

async function upsertVectorRecords(records, options = {}) {
  const input = Array.isArray(records) ? records : [];
  if (input.length === 0) return { indexed: 0, tables: [], fallbackCount: 0 };
  const lanceDir = getLanceDir(options.feedbackDir);
  ensureDir(lanceDir);
  const { connect } = await getLanceDB();
  const db = await connect(lanceDir);
  const grouped = new Map();
  let reusedCount = 0;
  let embeddedCount = 0;

  for (const record of input) {
    if (!record || !record.id || !record.text) continue;
    const cached = Array.isArray(record.vector)
      ? null
      : readCachedEmbedding(record.text, options);
    const vector = Array.isArray(record.vector)
      ? record.vector
      : cached
        ? cached.vector
        : await embed(record.text, {
        kind: 'document',
        task: options.task || 'code retrieval',
        title: record.title || record.id,
        timeoutMs: options.timeoutMs,
      });
    const identity = record.embeddingIdentity || (cached
      ? cached.identity
      : getActiveEmbeddingIdentity(vector));
    if (cached) reusedCount += 1;
    else if (!Array.isArray(record.vector)) {
      embeddedCount += 1;
      writeCachedEmbedding(record.text, vector, identity, options);
    }
    const tableName = options.tableName || resolveRagTableName(identity);
    if (!grouped.has(tableName)) grouped.set(tableName, []);
    grouped.get(tableName).push(normalizeIndexRecord(record, vector, identity));
  }

  await runStep('vector-store.upsertVectorRecords', {
    retries: 2,
    logger: (message) => console.warn(message),
  }, async () => {
    const tableNames = await db.tableNames();
    for (const [tableName, rows] of grouped.entries()) {
      if (rows.length === 0) continue;
      if (tableNames.includes(tableName)) {
        const table = await db.openTable(tableName);
        await replaceRows(table, rows);
      } else {
        await db.createTable(tableName, rows);
      }
    }
  });

  const rows = [...grouped.values()].flat();
  return {
    indexed: rows.length,
    tables: [...grouped.keys()],
    fallbackCount: rows.filter((row) => row.embeddingFallback).length,
    reusedCount,
    embeddedCount,
    embeddingModels: [...new Set(rows.map((row) => row.embeddingModel))],
  };
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
      await replaceRows(table, [record]);
    } else {
      await db.createTable(TABLE_NAME, [record]);
    }
  });

  await upsertVectorRecords([{
    id: feedbackEvent.id,
    text: textForEmbedding,
    source: 'feedback',
    signal: feedbackEvent.signal,
    tags: feedbackEvent.tags,
    timestamp: feedbackEvent.timestamp,
    context: feedbackEvent.context || '',
    scope: feedbackEvent.scope || {
      tenantId: feedbackEvent.tenantId || 'local',
      projectId: feedbackEvent.projectId || null,
      entityId: feedbackEvent.entityId || null,
      visibility: feedbackEvent.visibility || 'private',
    },
    trustLevel: 'trusted',
    isCurrent: true,
    vector,
    embeddingIdentity: getActiveEmbeddingIdentity(vector),
  }]);
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

function rowMatchesFilters(row, filters = {}) {
  if (filters.tenantId && row.tenantId !== filters.tenantId) return false;
  if (filters.projectId && row.projectId !== filters.projectId) return false;
  if (filters.entityId && row.entityId !== filters.entityId) return false;
  if (filters.visibility && row.visibility !== filters.visibility) return false;
  if (filters.source && filters.source !== 'all' && row.source !== filters.source) return false;
  if (filters.signal && row.signal !== filters.signal) return false;
  if (filters.currentOnly !== false && row.isCurrent === false) return false;
  return true;
}

function buildLanceFilter(filters = {}) {
  const clauses = [];
  for (const key of ['tenantId', 'projectId', 'entityId', 'visibility', 'source', 'signal']) {
    const value = filters[key];
    if (!value || (key === 'source' && value === 'all')) continue;
    clauses.push(`${key} = '${escapeSqlLiteral(value)}'`);
  }
  if (filters.currentOnly !== false) clauses.push('isCurrent = true');
  return clauses.join(' AND ');
}

function applyVectorQueryOptions(builder, options = {}) {
  if (options.filter && typeof builder.where === 'function') {
    builder = builder.where(options.filter);
  }
  if (options.exhaustive && typeof builder.bypassVectorIndex === 'function') {
    builder = builder.bypassVectorIndex();
  }
  return builder.limit(options.limit);
}

function vectorIndexConfigs(indices = []) {
  return indices.filter((index) => (
    Array.isArray(index.columns)
    && index.columns.includes('vector')
  ));
}

function resultIds(rows, excludedId, topK) {
  return rows
    .filter((row) => String(row.id) !== String(excludedId))
    .slice(0, topK)
    .map((row) => String(row.id));
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  return Number(sorted[Math.min(Math.ceil(sorted.length * fraction) - 1, sorted.length - 1)].toFixed(3));
}

function isUnsupportedNativePrewarm(error) {
  return /prewarm_(?:data|index).*only supported on remote tables/i.test(
    String(error && error.message || error || ''),
  );
}

async function boundedLocalPrewarm(table, columns, maxRows) {
  let builder = table.query();
  if (typeof builder.select === 'function') builder = builder.select(columns);
  const rows = await builder.limit(maxRows).toArray();
  return rows.length;
}

async function sampleRecallRows(table, options = {}) {
  const num = Math.max(1, Math.min(Number(options.num) || 25, 100));
  const maxScanRows = Math.max(num, Math.min(Number(options.maxScanRows) || 2000, 10_000));
  let builder = table.query();
  if (options.filter && typeof builder.where === 'function') builder = builder.where(options.filter);
  if (typeof builder.select === 'function') builder = builder.select(['id', 'vector']);
  const rows = await builder.limit(maxScanRows).toArray();
  return rows
    .filter((row) => row && row.id && row.vector)
    .sort((left, right) => sha256(left.id).localeCompare(sha256(right.id)))
    .slice(0, num);
}

/**
 * Explicit pre-flight cache hint for latency-sensitive retrieval.
 *
 * LanceDB owns the real memory/OS cache. This state records only that a warm
 * request completed; it never claims the cache will remain resident.
 */
async function warmRagIndex(options = {}) {
  const lanceDir = getLanceDir(options.feedbackDir);
  ensureDir(lanceDir);
  const { connect } = await getLanceDB();
  const db = await connect(lanceDir);
  const names = (await db.tableNames()).filter((name) => name.startsWith(`${RAG_TABLE_PREFIX}_`));
  const tables = [];
  const maxRows = Math.max(1, Math.min(Number(options.maxRows) || 10_000, 100_000));

  for (const name of names) {
    const startedAt = performance.now();
    const table = await db.openTable(name);
    const indices = typeof table.listIndices === 'function' ? await table.listIndices() : [];
    const warmedIndices = [];
    const unsupportedNativeIndices = [];
    const columns = [
      'id',
      'vector',
      'tenantId',
      'projectId',
      'entityId',
      'visibility',
      'source',
      'signal',
      'isCurrent',
    ];
    let dataPrewarmMethod = 'none';
    let rowsRead = 0;

    if (typeof table.prewarmData === 'function') {
      try {
        await table.prewarmData(columns);
        dataPrewarmMethod = 'native';
      } catch (error) {
        if (!isUnsupportedNativePrewarm(error)) throw error;
        rowsRead = await boundedLocalPrewarm(table, columns, maxRows);
        dataPrewarmMethod = 'bounded_local_scan';
      }
    } else {
      rowsRead = await boundedLocalPrewarm(table, columns, maxRows);
      dataPrewarmMethod = 'bounded_local_scan';
    }
    if (typeof table.prewarmIndex === 'function') {
      for (const index of indices) {
        try {
          await table.prewarmIndex(index.name);
          warmedIndices.push(index.name);
        } catch (error) {
          if (!isUnsupportedNativePrewarm(error)) throw error;
          unsupportedNativeIndices.push(index.name);
        }
      }
    }

    const record = {
      tableName: name,
      warmedAt: new Date().toISOString(),
      durationMs: Number((performance.now() - startedAt).toFixed(3)),
      dataPrewarmed: dataPrewarmMethod !== 'none',
      dataPrewarmMethod,
      rowsRead,
      maxRows,
      warmedIndices,
      unsupportedNativeIndices,
    };
    _ragWarmState.set(name, record);
    tables.push(record);
  }

  return {
    status: names.length ? 'warmed' : 'no_tables',
    tableCount: names.length,
    tables,
  };
}

/**
 * Compare the configured ANN path with LanceDB's exhaustive path.
 *
 * The check is intentionally explicit because exhaustive search can be
 * expensive. Small indexes without a vector index report exact_only instead
 * of manufacturing a perfect ANN recall score.
 */
async function evaluateRagRecall(options = {}) {
  const num = Math.max(1, Math.min(Number(options.num) || 25, 100));
  const topK = Math.max(1, Math.min(Number(options.topK) || 10, 100));
  const threshold = Math.max(0, Math.min(Number(options.threshold) || 0.9, 1));
  const filter = buildLanceFilter(options.filters);
  const lanceDir = getLanceDir(options.feedbackDir);
  ensureDir(lanceDir);
  const { connect } = await getLanceDB();
  const db = await connect(lanceDir);
  const names = (await db.tableNames()).filter((name) => name.startsWith(`${RAG_TABLE_PREFIX}_`));
  const tables = [];
  const recalls = [];
  const annDurations = [];
  const exhaustiveDurations = [];

  for (const name of names) {
    const table = await db.openTable(name);
    const indices = typeof table.listIndices === 'function' ? await table.listIndices() : [];
    const vectorIndices = vectorIndexConfigs(indices);
    if (vectorIndices.length === 0) {
      tables.push({
        tableName: name,
        mode: 'exact_only',
        sampleCount: 0,
        vectorIndices: [],
      });
      continue;
    }

    const samples = await sampleRecallRows(table, {
      filter,
      num,
      maxScanRows: options.maxScanRows,
    });
    const tableRecalls = [];
    let annCount = 0;
    let exhaustiveCount = 0;

    for (const sample of samples) {
      const vector = Array.from(sample.vector);
      const requested = topK + 1;
      const annStartedAt = performance.now();
      const annRows = await applyVectorQueryOptions(table.search(vector), {
        filter,
        limit: requested,
      }).toArray();
      annDurations.push(performance.now() - annStartedAt);

      const exactStartedAt = performance.now();
      const exhaustiveRows = await applyVectorQueryOptions(table.search(vector), {
        filter,
        limit: requested,
        exhaustive: true,
      }).toArray();
      exhaustiveDurations.push(performance.now() - exactStartedAt);

      const annIds = resultIds(annRows, sample.id, topK);
      const exactIds = resultIds(exhaustiveRows, sample.id, topK);
      const annSet = new Set(annIds);
      const recall = exactIds.length
        ? exactIds.filter((id) => annSet.has(id)).length / exactIds.length
        : 1;
      tableRecalls.push(recall);
      recalls.push(recall);
      annCount += annIds.length;
      exhaustiveCount += exactIds.length;
    }

    tables.push({
      tableName: name,
      mode: 'ann_vs_exhaustive',
      sampleCount: samples.length,
      avgRecall: tableRecalls.length
        ? Number((tableRecalls.reduce((sum, value) => sum + value, 0) / tableRecalls.length).toFixed(4))
        : null,
      avgAnnCount: samples.length ? Number((annCount / samples.length).toFixed(2)) : 0,
      avgExhaustiveCount: samples.length ? Number((exhaustiveCount / samples.length).toFixed(2)) : 0,
      vectorIndices: vectorIndices.map((index) => ({
        name: index.name,
        indexType: index.indexType,
      })),
    });
  }

  if (names.length === 0) {
    return {
      status: 'no_tables',
      threshold,
      topK,
      requestedSamples: num,
      sampleCount: 0,
      avgRecall: null,
      tables,
    };
  }
  if (recalls.length === 0) {
    return {
      status: 'exact_only',
      threshold,
      topK,
      requestedSamples: num,
      sampleCount: 0,
      avgRecall: null,
      tables,
    };
  }

  const avgRecall = recalls.reduce((sum, value) => sum + value, 0) / recalls.length;
  return {
    status: avgRecall >= threshold ? 'pass' : 'fail',
    threshold,
    topK,
    requestedSamples: num,
    sampleCount: recalls.length,
    avgRecall: Number(avgRecall.toFixed(4)),
    annLatencyP50Ms: percentile(annDurations, 0.5),
    annLatencyP95Ms: percentile(annDurations, 0.95),
    exhaustiveLatencyP50Ms: percentile(exhaustiveDurations, 0.5),
    exhaustiveLatencyP95Ms: percentile(exhaustiveDurations, 0.95),
    tables,
  };
}

async function searchRag(queryText, options = {}) {
  const query = String(queryText || '').trim();
  if (!query) throw new Error('query is required');
  const limit = Math.max(1, Math.min(Number(options.limit) || 10, 100));
  const lanceDir = getLanceDir(options.feedbackDir);
  ensureDir(lanceDir);
  const { connect } = await getLanceDB();
  const db = await connect(lanceDir);
  const tableNames = await db.tableNames();
  const ragTables = tableNames.filter((name) => name.startsWith(`${RAG_TABLE_PREFIX}_`));
  if (ragTables.length === 0) {
    return {
      results: [],
      tableName: null,
      embedding: null,
      filterApplied: buildLanceFilter(options.filters),
    };
  }
  const vector = await embed(query, {
    kind: 'query',
    task: options.task || 'code retrieval',
    timeoutMs: options.timeoutMs,
  });
  const identity = getActiveEmbeddingIdentity(vector);
  const tableName = resolveRagTableName(identity);
  if (!tableNames.includes(tableName)) {
    return {
      results: [],
      tableName,
      embedding: identity,
      filterApplied: buildLanceFilter(options.filters),
    };
  }

  const table = await db.openTable(tableName);
  let builder = table.search(vector);
  const filter = buildLanceFilter(options.filters);
  if (filter && typeof builder.where === 'function') builder = builder.where(filter);
  const scanLimit = filter && typeof builder.where !== 'function'
    ? Math.min(Math.max(limit * 10, 100), 1000)
    : limit;
  const rows = await builder.limit(scanLimit).toArray();
  const filtered = rows.filter((row) => rowMatchesFilters(row, options.filters)).slice(0, limit);
  return {
    results: filtered,
    tableName,
    embedding: identity,
    filterApplied: filter,
  };
}

async function indexDocument(document, options = {}) {
  if (document && document.supersedesDocumentId) {
    await retireDocument(document.supersedesDocumentId, options);
  }
  const chunks = Array.isArray(document && document.chunks) ? document.chunks : [];
  return upsertVectorRecords(chunks.map((chunk) => ({
    id: chunk.chunkId,
    text: [
      document.title,
      (chunk.headingPath || []).join(' > '),
      chunk.content,
    ].filter(Boolean).join('\n'),
    source: 'document',
    documentId: document.documentId,
    sourceKey: document.sourceKey,
    parentId: chunk.parentId,
    scope: document.scope,
    isCurrent: document.isCurrent,
    trustLevel: document.trustLevel,
    instructionRisk: document.instructionRisk,
    version: document.version,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset,
    title: document.title,
    tags: document.tags,
    importedAt: document.importedAt,
    context: chunk.content,
  })), options);
}

async function retireDocument(documentId, options = {}) {
  const normalizedId = String(documentId || '').trim();
  if (!normalizedId) return { retired: false, tables: [] };
  const lanceDir = getLanceDir(options.feedbackDir);
  ensureDir(lanceDir);
  const { connect } = await getLanceDB();
  const db = await connect(lanceDir);
  const names = (await db.tableNames()).filter((name) => name.startsWith(`${RAG_TABLE_PREFIX}_`));
  for (const name of names) {
    const table = await db.openTable(name);
    if (typeof table.delete === 'function') {
      await table.delete(`documentId = '${escapeSqlLiteral(normalizedId)}'`);
    }
  }
  return { retired: names.length > 0, tables: names };
}

async function getRagIndexStatus(options = {}) {
  const lanceDir = getLanceDir(options.feedbackDir);
  ensureDir(lanceDir);
  const { connect } = await getLanceDB();
  const db = await connect(lanceDir);
  const names = await db.tableNames();
  const ragTables = names.filter((name) => name.startsWith(`${RAG_TABLE_PREFIX}_`));
  return {
    schemaVersion: RAG_INDEX_SCHEMA_VERSION,
    directory: lanceDir,
    tables: ragTables,
    warmState: ragTables.map((name) => _ragWarmState.get(name) || {
      tableName: name,
      warmedAt: null,
    }),
  };
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
  DEFAULT_VECTOR_TIMEOUT_MS,
  RAG_INDEX_SCHEMA_VERSION,
  RAG_TABLE_PREFIX,
  buildLanceFilter,
  evaluateRagRecall,
  getActiveEmbeddingIdentity,
  getRagIndexStatus,
  indexDocument,
  retireDocument,
  rowMatchesFilters,
  searchRag,
  warmRagIndex,
  upsertVectorRecords,
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
};
