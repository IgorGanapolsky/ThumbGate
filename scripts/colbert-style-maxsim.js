'use strict';

/**
 * ColBERT-style late interaction (MaxSim) for ThumbGate lesson reranking.
 *
 * This is NOT a pretrained ColBERT neural model. It implements the *interaction
 * pattern* ColBERT made famous:
 *   - encode query and document as multi-vector bags (one vector per token)
 *   - score with MaxSim: sum over query tokens of max cosine vs any doc token
 *
 * Token vectors are deterministic hashed character-n-gram projections (local-only,
 * no GPU, no network). That gives late interaction without shipping a 100MB model
 * in the npm package — while remaining honest about model provenance.
 *
 * For true neural ColBERT, operators can plug vectors via `tokenEmbedder`.
 *
 * @see https://arxiv.org/abs/2004.12832 (ColBERT MaxSim)
 */

const DEFAULT_DIM = 32;
const DEFAULT_NGRAM = 3;

/**
 * Deterministic 32-bit hash (FNV-1a style) for seedable projections.
 * @param {string} str
 * @returns {number}
 */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Tokenize into lowercase word tokens (length >= 2).
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/[\s_]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Character n-grams for a token (with edge markers).
 * @param {string} token
 * @param {number} n
 * @returns {string[]}
 */
function charNgrams(token, n = DEFAULT_NGRAM) {
  const padded = `#${token}#`;
  if (padded.length < n) return [padded];
  const grams = [];
  for (let i = 0; i <= padded.length - n; i += 1) {
    grams.push(padded.slice(i, i + n));
  }
  return grams;
}

/**
 * Build a unit-length multi-dim embedding for one token via hashed n-grams.
 * @param {string} token
 * @param {{ dim?: number, ngram?: number }} [opts]
 * @returns {Float64Array}
 */
function embedToken(token, opts = {}) {
  const dim = opts.dim ?? DEFAULT_DIM;
  const ngram = opts.ngram ?? DEFAULT_NGRAM;
  const vec = new Float64Array(dim);
  for (const gram of charNgrams(token, ngram)) {
    const h = hash32(gram);
    const idx = h % dim;
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
    // Second hash for denser projection (locality-sensitive bag)
    const h2 = hash32(`${gram}:2`);
    vec[h2 % dim] += ((h2 >> 1) & 1) === 0 ? 0.5 : -0.5;
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < dim; i += 1) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i += 1) vec[i] /= norm;
  return vec;
}

/**
 * Cosine similarity for unit vectors (dot product).
 * @param {Float64Array|number[]} a
 * @param {Float64Array|number[]} b
 * @returns {number}
 */
function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i += 1) s += a[i] * b[i];
  return s;
}

/**
 * Encode text as a bag of token vectors (ColBERT multi-vector representation).
 * @param {string} text
 * @param {{ dim?: number, ngram?: number, maxTokens?: number, tokenEmbedder?: (t: string) => Float64Array|number[] }} [opts]
 * @returns {{ tokens: string[], vectors: Array<Float64Array|number[]> }}
 */
function encodeMultiVector(text, opts = {}) {
  const maxTokens = opts.maxTokens ?? 64;
  const tokens = tokenize(text).slice(0, maxTokens);
  const embedder = opts.tokenEmbedder || ((t) => embedToken(t, opts));
  const vectors = tokens.map((t) => embedder(t));
  return { tokens, vectors };
}

/**
 * ColBERT MaxSim: Σ_i max_j cos(q_i, d_j), normalized by |Q|.
 * @param {Array<Float64Array|number[]>} queryVectors
 * @param {Array<Float64Array|number[]>} docVectors
 * @returns {number} score in [0, 1] approximately
 */
function maxSim(queryVectors, docVectors) {
  if (!queryVectors.length || !docVectors.length) return 0;
  let total = 0;
  for (const q of queryVectors) {
    let best = -1;
    for (const d of docVectors) {
      const c = cosine(q, d);
      if (c > best) best = c;
    }
    total += Math.max(0, best);
  }
  // Normalize by query length so longer queries don't dominate
  return Math.min(1, total / queryVectors.length);
}

/**
 * Score a (query, document) pair with ColBERT-style late interaction.
 * @param {string} query
 * @param {string} document
 * @param {object} [opts]
 * @returns {{ score: number, queryTokens: string[], docTokens: string[], mode: string }}
 */
function scoreLateInteraction(query, document, opts = {}) {
  const q = encodeMultiVector(query, opts);
  const d = encodeMultiVector(document, opts);
  const score = maxSim(q.vectors, d.vectors);
  return {
    score: Number(score.toFixed(6)),
    queryTokens: q.tokens,
    docTokens: d.tokens,
    mode: opts.tokenEmbedder ? 'colbert-style-external' : 'colbert-style-hash',
  };
}

/**
 * Rerank candidates by MaxSim late interaction.
 * @param {string} query
 * @param {Array<object>} candidates
 * @param {{ topK?: number, textOf?: (c: object) => string, blendWeight?: number }} [options]
 * @returns {Array<object>} candidates with maxSimScore + optional blend into rerankedScore
 */
function rerankWithMaxSim(query, candidates, options = {}) {
  const {
    topK = 5,
    textOf = defaultTextOf,
    blendWeight = 0.55,
    dim,
    ngram,
    maxTokens,
    tokenEmbedder,
  } = options;

  if (!candidates || candidates.length === 0) return [];
  if (candidates.length === 1) {
    const only = candidates[0];
    return [{
      ...only,
      maxSimScore: 1,
      rerankedScore: only.rerankedScore ?? only.relevanceScore ?? 1,
      lateInteractionMode: 'trivial',
    }].slice(0, topK);
  }

  const qEnc = encodeMultiVector(query, { dim, ngram, maxTokens, tokenEmbedder });
  const scored = candidates.map((c) => {
    const docText = textOf(c);
    const dEnc = encodeMultiVector(docText, { dim, ngram, maxTokens, tokenEmbedder });
    const ms = maxSim(qEnc.vectors, dEnc.vectors);
    const orig = Number(c.rerankedScore ?? c.relevanceScore ?? c.score ?? 0);
    const blended = blendWeight * ms + (1 - blendWeight) * Math.max(0, Math.min(1, orig));
    return {
      ...c,
      maxSimScore: Number(ms.toFixed(6)),
      rerankedScore: Number(blended.toFixed(6)),
      lateInteractionMode: tokenEmbedder ? 'colbert-style-external' : 'colbert-style-hash',
    };
  });

  return scored
    .sort((a, b) => (b.rerankedScore || 0) - (a.rerankedScore || 0))
    .slice(0, topK);
}

function defaultTextOf(candidate) {
  if (!candidate || typeof candidate !== 'object') return String(candidate || '');
  return [
    candidate.title,
    candidate.whatWentWrong,
    candidate.whatToChange,
    candidate.howToAvoid,
    candidate.summary,
    candidate.content,
    candidate.context,
    Array.isArray(candidate.tags) ? candidate.tags.join(' ') : '',
  ].filter(Boolean).join(' ');
}

module.exports = {
  hash32,
  tokenize,
  charNgrams,
  embedToken,
  cosine,
  encodeMultiVector,
  maxSim,
  scoreLateInteraction,
  rerankWithMaxSim,
  DEFAULT_DIM,
  DEFAULT_NGRAM,
};
