'use strict';

// HNSW vector retrieval layer.
// Embeds manual chunks locally (transformers.js MiniLM, 384-dim) and serves
// approximate-nearest-neighbor search over an HNSW index (hnswlib-node) per
// document route. Purpose: send only the top-K semantically relevant chunks to
// the model — minimizing prompt tokens, retrieval latency, and keyword-miss
// errors ("machine won't stop when I open the gate" → machine guarding).
//
// Degrades gracefully: if the embedding model cannot load (no cache, no
// network) or DISABLE_VECTOR=1, search() resolves null and the caller falls
// back to keyword scoring, so the live demo never depends on this layer.

const { HierarchicalNSW } = require('hnswlib-node');

const EMBED_MODEL = process.env.EMBED_MODEL || 'Xenova/all-MiniLM-L6-v2';
const DIM = 384;
const INIT_TIMEOUT_MS = Number(process.env.VECTOR_INIT_TIMEOUT_MS || 15000);

let embedderPromise = null;
const routeIndexes = new Map(); // route -> { index, ids }

function disabled() {
  return process.env.DISABLE_VECTOR === '1';
}

function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const { pipeline } = require('@huggingface/transformers');
      return pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q8' });
    })().catch((err) => {
      console.error(`[vector-index] embedder unavailable: ${err.message}`);
      return null;
    });
  }
  return embedderPromise;
}

async function embedTexts(texts) {
  const embedder = await getEmbedder();
  if (!embedder) return null;
  const output = await embedder(texts, { pooling: 'mean', normalize: true });
  return output.tolist();
}

async function buildRouteIndex(route, chunks) {
  const vectors = await embedTexts(chunks.map((chunk) => `${chunk.title}\n${chunk.text}`));
  if (!vectors) return null;
  const index = new HierarchicalNSW('cosine', DIM);
  index.initIndex(chunks.length);
  vectors.forEach((vector, i) => index.addPoint(vector, i));
  return { index, ids: chunks.map((chunk) => chunk.id) };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms).unref()),
  ]);
}

// Returns Map(chunkId -> cosine similarity 0..1), or null if unavailable.
async function search(route, chunks, question) {
  if (disabled()) return null;
  try {
    if (!routeIndexes.has(route)) {
      routeIndexes.set(route, withTimeout(buildRouteIndex(route, chunks), INIT_TIMEOUT_MS));
    }
    const built = await routeIndexes.get(route);
    if (!built) {
      routeIndexes.delete(route); // retry on a later request
      return null;
    }
    const [queryVector] = await withTimeout(embedTexts([question]), INIT_TIMEOUT_MS) || [];
    if (!queryVector) return null;
    const { neighbors, distances } = built.index.searchKnn(queryVector, chunks.length);
    const sims = new Map();
    neighbors.forEach((n, i) => sims.set(built.ids[n], 1 - distances[i]));
    return sims;
  } catch (err) {
    console.error(`[vector-index] search failed: ${err.message}`);
    return null;
  }
}

// Pre-build all route indexes so the first user question pays no cold start.
async function warmup(chunksByRoute) {
  if (disabled()) return { mode: 'keyword', reason: 'DISABLE_VECTOR=1' };
  for (const [route, chunks] of Object.entries(chunksByRoute)) {
    if (!routeIndexes.has(route)) {
      routeIndexes.set(route, withTimeout(buildRouteIndex(route, chunks), INIT_TIMEOUT_MS));
    }
  }
  const results = await Promise.all(routeIndexes.values());
  const ready = results.every(Boolean);
  return {
    mode: ready ? 'hybrid-hnsw' : 'keyword',
    model: EMBED_MODEL,
    dim: DIM,
    indexes: ready ? results.length : 0,
  };
}

function status() {
  if (disabled()) return 'keyword (vector disabled)';
  return routeIndexes.size > 0 ? `hnsw (${EMBED_MODEL})` : 'hnsw (cold)';
}

module.exports = { search, warmup, status, EMBED_MODEL };
