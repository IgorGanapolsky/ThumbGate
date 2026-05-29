#!/usr/bin/env node
'use strict';

/**
 * Lesson Embedding Index — maintained dense index over the lesson corpus.
 *
 * Powers the dense half of hybrid retrieval in the per-action gating hot path.
 * The gating path reads memory-log lessons and must surface past mistakes that
 * are semantically related to the current action even when they share no
 * keywords (paraphrase, synonym, different file path). Pure lexical scoring
 * misses those; dense embeddings catch them.
 *
 * Design constraints:
 *   - Embedding the whole corpus on every tool call is too expensive. We cache
 *     document vectors keyed by `id + sha1(text)` in <feedbackDir>/lesson-embeddings.json.
 *     Only the query is embedded per call; only new/changed lessons re-embed.
 *   - The embedder is reused from vector-store.embed (Gemini -> local transformers
 *     -> stub). No new embedding dependency.
 *   - HONESTY: when no real embedder is available, callers must degrade to lexical.
 *     We never synthesize fake (e.g. hash-based) vectors — that would be overclaiming.
 *
 * Zero hard dependency on LanceDB: this module only needs the embed() function.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_FILE = 'lesson-embeddings.json';

function resolveFeedbackDir(explicit) {
  if (explicit) return explicit;
  try {
    const { resolveFeedbackDir: resolve } = require('./feedback-paths');
    return resolve();
  } catch {
    return process.env.THUMBGATE_FEEDBACK_DIR || process.cwd();
  }
}

function getCachePath(feedbackDir) {
  return path.join(resolveFeedbackDir(feedbackDir), CACHE_FILE);
}

/** Canonical text for a lesson record (title + content + tags). */
function lessonText(lesson) {
  if (!lesson) return '';
  return [
    lesson.title || '',
    lesson.content || '',
    Array.isArray(lesson.tags) ? lesson.tags.join(' ') : '',
  ].filter(Boolean).join(' ').trim();
}

/**
 * Truncate a vector to a specific dimension (Matryoshka Embedding Truncation).
 * Assumes the model supports MRL (like text-embedding-3 or modern transformers).
 */
function truncateVector(vector, dimension) {
  if (!Array.isArray(vector) || !dimension || vector.length <= dimension) {
    return vector;
  }
  return vector.slice(0, dimension);
}

function hashText(text) {
  // Content-change key for the embedding cache (not a security context). sha256
  // matches the repo's standard non-security hashing and avoids the weak-hash flag.
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]) || 0;
    const y = Number(b[i]) || 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Is a real embedder available? Used so callers can decide hybrid vs lexical-only
 * WITHOUT loading a model. Returns true for the deterministic stub (test/CI safe).
 */
function isEmbedderAvailable() {
  if (process.env.THUMBGATE_VECTOR_STUB_EMBED === 'true') return true;
  // Managed Gemini path
  try {
    const { resolveGeminiEmbeddingConfig } = require('./gemini-embedding-policy');
    const cfg = resolveGeminiEmbeddingConfig();
    if (cfg && cfg.enabled && cfg.apiKey) return true;
  } catch { /* policy module unavailable */ }
  // Local transformers path
  try {
    require.resolve('@huggingface/transformers');
    return true;
  } catch { /* not installed */ }
  return false;
}

function defaultEmbedder() {
  // Lazy: do not pull in LanceDB/transformers at module require time.
  const { embed } = require('./vector-store');
  return embed;
}

function readCache(cachePath) {
  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(cachePath, cache) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cache));
  } catch {
    /* cache is best-effort; never throw into the hot path */
  }
}

/**
 * Rank lessons by dense (embedding) similarity to the query.
 * Returns [{ id, score }] sorted descending. Embeds the query once; reuses cached
 * document vectors and only embeds new/changed lessons.
 *
 * @returns {Promise<Array<{id:string, score:number}>>}
 */
async function semanticRank(queryText, lessons = [], options = {}) {
  const { feedbackDir, embedder = defaultEmbedder(), persist = true, truncateDimension = null } = options;
  if (!queryText || !Array.isArray(lessons) || lessons.length === 0) return [];

  const cachePath = getCachePath(feedbackDir);
  const cache = readCache(cachePath);
  let cacheDirty = false;

  let queryVector = await embedder(queryText, { kind: 'query', task: 'code retrieval' });
  if (!Array.isArray(queryVector) || queryVector.length === 0) return [];
  
  if (truncateDimension) {
    queryVector = truncateVector(queryVector, truncateDimension);
  }

  const scored = [];
  for (const lesson of lessons) {
    if (!lesson || !lesson.id) continue;
    const text = lessonText(lesson);
    if (!text) continue;
    const hash = hashText(text);

    let entry = cache[lesson.id];
    if (!entry || entry.hash !== hash || !Array.isArray(entry.vector)) {
      const vector = await embedder(text, {
        kind: 'document',
        task: 'code retrieval',
        title: lesson.title || undefined,
      });
      if (!Array.isArray(vector) || vector.length === 0) continue;
      entry = { hash, vector };
      cache[lesson.id] = entry;
      cacheDirty = true;
    }

    const docVector = truncateDimension ? truncateVector(entry.vector, truncateDimension) : entry.vector;
    scored.push({ id: lesson.id, score: cosineSimilarity(queryVector, docVector) });
  }

  // Prune cache entries for lessons no longer present (bounded growth).
  const liveIds = new Set(lessons.map((l) => l && l.id).filter(Boolean));
  for (const id of Object.keys(cache)) {
    if (!liveIds.has(id)) {
      delete cache[id];
      cacheDirty = true;
    }
  }

  if (persist && cacheDirty) writeCache(cachePath, cache);

  return scored.sort((a, b) => b.score - a.score);
}

module.exports = {
  semanticRank,
  isEmbedderAvailable,
  cosineSimilarity,
  truncateVector,
  lessonText,
  hashText,
  getCachePath,
};
