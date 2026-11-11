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
 *     document vectors keyed by `id + sha256(text) + provider + dimension` in
 *     <feedbackDir>/lesson-embeddings.json.
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
const EMEANS_SIDECAR_VERSION = 1;
const MIN_EMEANS_SIDECAR_CORPUS = 16;
const MIN_EMEANS_DIMENSION = 12;
const MACRO_BLOCK_SIZE = 12;
const _sidecarMemCache = new Map();

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

function getSidecarPath(feedbackDir, cacheFile = CACHE_FILE) {
  const base = path.basename(cacheFile);
  const stem = base.endsWith('.json') ? base.slice(0, -5) : base;
  return path.join(resolveFeedbackDir(feedbackDir), `${stem}.emeans.json`);
}

function makeDeterministicPrng(seedText) {
  const digest = crypto.createHash('sha256').update(String(seedText || 'emeans')).digest();
  let state = digest.readUInt32LE(0) || 1;
  return function nextUniform() {
    state = (state + 0x6D2B79F5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function largestPow2Block(dim, maxBlock = 256) {
  let block = 1;
  while (block * 2 <= maxBlock && dim % (block * 2) === 0) {
    block *= 2;
  }
  return block;
}

function resolvePaddedHadamardDims(dim) {
  const safeDim = Math.max(1, Math.floor(Number(dim) || 1));
  let paddedDim = safeDim;
  let block = largestPow2Block(paddedDim, 256);
  if (block < 16 && paddedDim > 16) {
    paddedDim = 1;
    while (paddedDim < safeDim) paddedDim *= 2;
    block = Math.min(256, paddedDim);
  }
  return { dim: safeDim, paddedDim, block };
}

function applyNormalizedFwhtBlocks(buffer, paddedDim, block) {
  if (block <= 1) return;
  const scale = 1 / Math.sqrt(block);
  for (let offset = 0; offset < paddedDim; offset += block) {
    for (let span = 1; span < block; span <<= 1) {
      const step = span << 1;
      for (let i = offset; i < offset + block; i += step) {
        for (let j = 0; j < span; j++) {
          const u = buffer[i + j];
          const v = buffer[i + j + span];
          buffer[i + j] = u + v;
          buffer[i + j + span] = u - v;
        }
      }
    }
    for (let i = offset; i < offset + block; i++) {
      buffer[i] *= scale;
    }
  }
}

/**
 * Deterministic Double Block-Hadamard Butterfly (Q = H_B D_2 Pi H_B D_1).
 * Orthogonal (<Q u, Q v> = <u, v>) while spreading coordinate outliers across
 * all dimensions prior to variable-bitrate codebook quantization (@shinboson / QTIP).
 */
function buildHadamardButterfly(dimension, seed = 'thumbgate-emeans-v1') {
  const { dim, paddedDim, block } = resolvePaddedHadamardDims(dimension);
  const rand = makeDeterministicPrng(`${seed}:${dim}`);
  const signs1 = new Int8Array(paddedDim);
  const signs2 = new Int8Array(paddedDim);
  const perm = new Uint16Array(paddedDim);
  for (let i = 0; i < paddedDim; i++) {
    signs1[i] = rand() < 0.5 ? -1 : 1;
    signs2[i] = rand() < 0.5 ? -1 : 1;
    perm[i] = i;
  }
  for (let i = paddedDim - 1; i > 0; i--) {
    const swapIdx = Math.floor(rand() * (i + 1));
    const tmp = perm[i];
    perm[i] = perm[swapIdx];
    perm[swapIdx] = tmp;
  }
  return {
    dim,
    paddedDim,
    block,
    rotate(vector) {
      const stage1 = new Float32Array(paddedDim);
      const len = Math.min(dim, vector.length);
      for (let i = 0; i < len; i++) {
        stage1[i] = (Number(vector[i]) || 0) * signs1[i];
      }
      applyNormalizedFwhtBlocks(stage1, paddedDim, block);
      const stage2 = new Float32Array(paddedDim);
      for (let i = 0; i < paddedDim; i++) {
        stage2[i] = stage1[perm[i]] * signs2[i];
      }
      applyNormalizedFwhtBlocks(stage2, paddedDim, block);
      return stage2;
    },
  };
}

function computeEmeansScalingParams(count, k, epochs, law = 'default') {
  const cB = law === 'quality' ? 0.0044 : 0.035;
  const rawBatch = Math.round(
    cB * Math.pow(k, 0.13) * Math.pow(count, 0.88) * Math.pow(epochs, 0.81),
  );
  const minBatch = Math.min(count, Math.max(8, k));
  const batchSize = Math.max(minBatch, Math.min(count, rawBatch || minBatch));
  const alpha0 = Math.min(
    1.0,
    0.824 * Math.pow(k, -0.46) * Math.pow(batchSize, 0.90) * Math.pow(count, -0.45) * Math.pow(epochs, -0.11),
  );
  return { batchSize, alpha0 };
}

function nearestCentroidIndex(data, dataOffset, centroids, k, dim) {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let c = 0; c < k; c++) {
    const cBase = c * dim;
    let dist = 0;
    for (let j = 0; j < dim; j++) {
      const diff = data[dataOffset + j] - centroids[cBase + j];
      dist += diff * diff;
    }
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = c;
    }
  }
  return bestIdx;
}

function initCentroidsKmeansPlusPlus(data, count, dim, k, rand) {
  const centroids = new Float32Array(k * dim);
  const first = Math.floor(rand() * count);
  centroids.set(data.subarray(first * dim, (first + 1) * dim), 0);
  const minDists = new Float32Array(count).fill(Infinity);
  for (let c = 1; c < k; c++) {
    const prevBase = (c - 1) * dim;
    let sumDist = 0;
    for (let i = 0; i < count; i++) {
      const base = i * dim;
      let dist = 0;
      for (let j = 0; j < dim; j++) {
        const diff = data[base + j] - centroids[prevBase + j];
        dist += diff * diff;
      }
      if (dist < minDists[i]) minDists[i] = dist;
      sumDist += minDists[i];
    }
    let chosen = Math.floor(rand() * count);
    if (sumDist > 0) {
      let target = rand() * sumDist;
      for (let i = 0; i < count; i++) {
        target -= minDists[i];
        if (target <= 0) {
          chosen = i;
          break;
        }
      }
    }
    centroids.set(data.subarray(chosen * dim, (chosen + 1) * dim), c * dim);
  }
  return centroids;
}

function reviveDeadClustersProportional(sums, counts, k, dim, deadThreshold, rand) {
  let revivals = 0;
  const donorFloor = deadThreshold * 4;
  for (let dead = 0; dead < k; dead++) {
    if (counts[dead] >= deadThreshold) continue;
    let totalActive = 0;
    for (let m = 0; m < k; m++) {
      if (m !== dead && counts[m] > donorFloor) totalActive += counts[m];
    }
    if (totalActive <= 0) continue;
    let draw = rand() * totalActive;
    let donor = -1;
    for (let m = 0; m < k; m++) {
      if (m !== dead && counts[m] > donorFloor) {
        draw -= counts[m];
        if (draw <= 0) {
          donor = m;
          break;
        }
      }
    }
    if (donor < 0) continue;
    const halfN = counts[donor] * 0.5;
    counts[donor] = halfN;
    counts[dead] = halfN;
    for (let j = 0; j < dim; j++) {
      const meanVal = sums[donor * dim + j] / (halfN * 2);
      const jitter = (rand() - 0.5) * 1e-3;
      sums[donor * dim + j] = halfN * (meanVal + jitter);
      sums[dead * dim + j] = halfN * (meanVal - jitter);
    }
    revivals += 1;
  }
  return revivals;
}

/**
 * e-means centroid & codebook optimizer (Bessa et al., arXiv:2611.09501).
 * Uses scaling-law batch/step auto-tuning, cosine-annealed EMA updates,
 * proportional-split dead-cluster revival, and exact last-epoch mean finalization.
 */
function trainEmeans(data, count, dim, requestedK, options = {}) {
  const safeCount = Math.max(0, Math.floor(Number(count) || 0));
  const safeDim = Math.max(1, Math.floor(Number(dim) || 1));
  const k = Math.max(1, Math.min(safeCount || 1, Math.floor(Number(requestedK) || 1)));
  if (safeCount === 0) {
    return { centroids: new Float32Array(0), labels: new Uint16Array(0), batchSize: 0, alpha0: 0, revivals: 0 };
  }
  const epochs = Math.max(1, Number(options.epochs) || 4);
  const rand = makeDeterministicPrng(options.seed || `emeans:${safeCount}:${safeDim}:${k}`);
  const { batchSize, alpha0 } = computeEmeansScalingParams(safeCount, k, epochs, options.law || 'default');
  const centroids = initCentroidsKmeansPlusPlus(data, safeCount, safeDim, k, rand);
  const sums = new Float32Array(centroids);
  const counts = new Float32Array(k).fill(1);
  const batchSums = new Float32Array(k * safeDim);
  const batchCounts = new Float32Array(k);
  const order = new Uint32Array(safeCount);
  for (let i = 0; i < safeCount; i++) order[i] = i;

  const totalSteps = Math.max(1, Math.ceil((epochs * safeCount) / batchSize));
  const deadThreshold = Math.max(1e-3, (batchSize / k) * 0.005);
  let cursor = safeCount;
  let revivals = 0;

  for (let step = 0; step < totalSteps; step++) {
    const alpha = alpha0 * (0.1 + 0.45 * (1 + Math.cos((Math.PI * step) / totalSteps)));
    batchSums.fill(0);
    batchCounts.fill(0);
    for (let b = 0; b < batchSize; b++) {
      if (cursor >= safeCount) {
        for (let i = safeCount - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          const tmp = order[i];
          order[i] = order[j];
          order[j] = tmp;
        }
        cursor = 0;
      }
      const idx = order[cursor++];
      const base = idx * safeDim;
      const bestC = nearestCentroidIndex(data, base, centroids, k, safeDim);
      batchCounts[bestC] += 1;
      const sBase = bestC * safeDim;
      for (let j = 0; j < safeDim; j++) batchSums[sBase + j] += data[base + j];
    }

    const keep = 1 - alpha;
    for (let c = 0; c < k; c++) {
      counts[c] = keep * counts[c] + alpha * batchCounts[c];
      const sBase = c * safeDim;
      for (let j = 0; j < safeDim; j++) {
        sums[sBase + j] = keep * sums[sBase + j] + alpha * batchSums[sBase + j];
      }
    }
    revivals += reviveDeadClustersProportional(sums, counts, k, safeDim, deadThreshold, rand);
    for (let c = 0; c < k; c++) {
      const invN = counts[c] > 0 ? 1 / counts[c] : 0;
      const cBase = c * safeDim;
      for (let j = 0; j < safeDim; j++) centroids[cBase + j] = sums[cBase + j] * invN;
    }
  }

  batchSums.fill(0);
  batchCounts.fill(0);
  const labels = new Uint16Array(safeCount);
  for (let i = 0; i < safeCount; i++) {
    const base = i * safeDim;
    const bestC = nearestCentroidIndex(data, base, centroids, k, safeDim);
    labels[i] = bestC;
    batchCounts[bestC] += 1;
    const sBase = bestC * safeDim;
    for (let j = 0; j < safeDim; j++) batchSums[sBase + j] += data[base + j];
  }
  for (let c = 0; c < k; c++) {
    if (batchCounts[c] <= 0) continue;
    const inv = 1 / batchCounts[c];
    const cBase = c * safeDim;
    for (let j = 0; j < safeDim; j++) centroids[cBase + j] = batchSums[cBase + j] * inv;
  }
  return { centroids, labels, batchSize, alpha0, revivals };
}

function planFisherVariableSubspaces(rotatedVecs, paddedDim, corpusCount) {
  const fullMacros = Math.floor(paddedDim / MACRO_BLOCK_SIZE);
  const energies = Array.from({ length: fullMacros }, (_, m) => {
    const base = m * MACRO_BLOCK_SIZE;
    let sumSq = 0;
    for (let i = 0; i < corpusCount; i++) {
      const rv = rotatedVecs[i];
      for (let j = 0; j < MACRO_BLOCK_SIZE; j++) {
        const v = rv[base + j];
        sumSq += v * v;
      }
    }
    return { m, energy: sumSq / (corpusCount * MACRO_BLOCK_SIZE) };
  }).sort((a, b) => b.energy - a.energy);

  const macroSubDim = new Uint8Array(fullMacros);
  for (let rank = 0; rank < fullMacros; rank++) {
    const ratio = rank / Math.max(1, fullMacros);
    let subDim = 4;
    if (ratio < 0.50) subDim = 2;
    else if (ratio < 0.8125) subDim = 3;
    macroSubDim[energies[rank].m] = subDim;
  }

  const subspaces = [];
  const maxK = Math.min(256, corpusCount);
  for (let m = 0; m < fullMacros; m++) {
    const sd = macroSubDim[m];
    const base = m * MACRO_BLOCK_SIZE;
    for (let off = 0; off < MACRO_BLOCK_SIZE; off += sd) {
      subspaces.push({ offset: base + off, subDim: sd, k: maxK });
    }
  }
  let tailOffset = fullMacros * MACRO_BLOCK_SIZE;
  while (tailOffset < paddedDim) {
    const rem = paddedDim - tailOffset;
    const sd = rem >= 4 ? 2 : rem;
    subspaces.push({ offset: tailOffset, subDim: sd, k: maxK });
    tailOffset += sd;
  }
  return subspaces;
}

function packCodebooksInt16(codebooks) {
  let totalFloats = 0;
  let maxAbs = 0;
  for (const cb of codebooks) {
    totalFloats += cb.length;
    for (let i = 0; i < cb.length; i++) {
      const absVal = Math.abs(cb[i]);
      if (absVal > maxAbs) maxAbs = absVal;
    }
  }
  const scale = maxAbs > 0 ? maxAbs / 32767 : 1e-6;
  const buf = Buffer.allocUnsafe(totalFloats * 2);
  let cursor = 0;
  for (const cb of codebooks) {
    for (let i = 0; i < cb.length; i++) {
      const q = Math.max(-32767, Math.min(32767, Math.round(cb[i] / scale)));
      buf.writeInt16LE(q, cursor);
      cursor += 2;
    }
  }
  return { scale, base64: buf.toString('base64'), totalFloats };
}

/**
 * Compile an e-means + Hadamard + Fisher variable-bitrate ADC sidecar from a
 * homogeneous (single-provider, single-dimension) raw embedding cache.
 */
function compileEmeansCodebookSidecar(cache, options = {}) {
  if (!cache || typeof cache !== 'object') return null;
  const minCorpus = Math.max(2, Number(options.minCorpusSize) || MIN_EMEANS_SIDECAR_CORPUS);
  const entries = Object.entries(cache).filter(([, v]) => (
    v && typeof v.provider === 'string' && Array.isArray(v.vector) && v.vector.length >= MIN_EMEANS_DIMENSION
  ));
  if (entries.length < minCorpus) return null;

  const provider = entries[0][1].provider;
  const dimension = entries[0][1].vector.length;
  for (const [, entry] of entries) {
    if (entry.provider !== provider || entry.vector.length !== dimension) return null;
  }

  const ids = entries.map(([id]) => id);
  const hashes = entries.map(([, entry]) => entry.hash);
  const count = entries.length;
  const seed = `thumbgate-emeans-v1:${provider}:${dimension}`;
  const butterfly = buildHadamardButterfly(dimension, seed);
  const rotatedVecs = entries.map(([, entry]) => butterfly.rotate(entry.vector));
  const subspaces = planFisherVariableSubspaces(rotatedVecs, butterfly.paddedDim, count);
  const numSubspaces = subspaces.length;
  const packedCodes = Buffer.alloc(count * numSubspaces);
  const codebooks = new Array(numSubspaces);
  const epochs = Math.max(2, Number(options.epochs) || 4);

  for (let s = 0; s < numSubspaces; s++) {
    const { offset, subDim, k } = subspaces[s];
    const subData = new Float32Array(count * subDim);
    for (let i = 0; i < count; i++) {
      const rv = rotatedVecs[i];
      for (let j = 0; j < subDim; j++) subData[i * subDim + j] = rv[offset + j];
    }
    const trained = trainEmeans(subData, count, subDim, k, {
      epochs,
      law: 'default',
      seed: `${seed}:sub:${s}`,
    });
    codebooks[s] = trained.centroids;
    for (let i = 0; i < count; i++) {
      packedCodes[i * numSubspaces + s] = trained.labels[i];
    }
  }

  const docNormsBuf = Buffer.allocUnsafe(count * 4);
  for (let i = 0; i < count; i++) {
    let normSq = 0;
    const rowBase = i * numSubspaces;
    for (let s = 0; s < numSubspaces; s++) {
      const { subDim } = subspaces[s];
      const cb = codebooks[s];
      const cBase = packedCodes[rowBase + s] * subDim;
      for (let j = 0; j < subDim; j++) {
        const v = cb[cBase + j];
        normSq += v * v;
      }
    }
    docNormsBuf.writeFloatLE(Math.sqrt(normSq) || 1, i * 4);
  }

  const packedCb = packCodebooksInt16(codebooks);
  const avgBitsPerWeight = Number(((numSubspaces * 8) / dimension).toFixed(3));
  return {
    version: EMEANS_SIDECAR_VERSION,
    algorithm: 'emeans-hadamard-fisher-adc-v1',
    seed,
    provider,
    dimension,
    paddedDim: butterfly.paddedDim,
    avgBitsPerWeight,
    numSubspaces,
    ids,
    hashes,
    subspaces: subspaces.map((s) => [s.offset, s.subDim, s.k]),
    codebookScale: packedCb.scale,
    codebooksI16Base64: packedCb.base64,
    docNormsF32Base64: docNormsBuf.toString('base64'),
    packedCodesBase64: packedCodes.toString('base64'),
  };
}

function writeEmeansSidecar(sidecarPath, sidecar) {
  try {
    if (!sidecar) {
      if (fs.existsSync(sidecarPath)) fs.unlinkSync(sidecarPath);
      _sidecarMemCache.delete(sidecarPath);
      return false;
    }
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    const tmpPath = `${sidecarPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(sidecar), { mode: 0o600 });
    fs.renameSync(tmpPath, sidecarPath);
    fs.chmodSync(sidecarPath, 0o600);
    _sidecarMemCache.delete(sidecarPath);
    return true;
  } catch {
    /* sidecar is an optimization; never break callers on fs contention */
    return false;
  }
}

function loadDecodedSidecar(sidecarPath) {
  try {
    const stat = fs.statSync(sidecarPath);
    const cached = _sidecarMemCache.get(sidecarPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.decoded;
    }
    const parsed = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    if (
      !parsed
      || parsed.version !== EMEANS_SIDECAR_VERSION
      || !Array.isArray(parsed.ids)
      || !Array.isArray(parsed.hashes)
      || !Array.isArray(parsed.subspaces)
    ) {
      return null;
    }
    const cbBuf = Buffer.from(parsed.codebooksI16Base64 || '', 'base64');
    const floatCount = Math.floor(cbBuf.length / 2);
    const cbFloats = new Float32Array(floatCount);
    const scale = Number(parsed.codebookScale) || 1e-6;
    for (let i = 0; i < floatCount; i++) {
      cbFloats[i] = cbBuf.readInt16LE(i * 2) * scale;
    }
    const normsBuf = Buffer.from(parsed.docNormsF32Base64 || '', 'base64');
    const docNorms = new Float32Array(parsed.ids.length);
    for (let i = 0; i < parsed.ids.length; i++) {
      docNorms[i] = i * 4 + 4 <= normsBuf.length ? (normsBuf.readFloatLE(i * 4) || 1) : 1;
    }
    const packedCodes = Buffer.from(parsed.packedCodesBase64 || '', 'base64');
    if (packedCodes.length < parsed.ids.length * parsed.subspaces.length) return null;
    const indexById = new Map();
    for (let i = 0; i < parsed.ids.length; i++) indexById.set(parsed.ids[i], i);
    const decoded = {
      provider: parsed.provider,
      dimension: parsed.dimension,
      paddedDim: parsed.paddedDim,
      avgBitsPerWeight: parsed.avgBitsPerWeight,
      numSubspaces: parsed.subspaces.length,
      subspaces: parsed.subspaces,
      ids: parsed.ids,
      hashes: parsed.hashes,
      indexById,
      butterfly: buildHadamardButterfly(parsed.dimension, parsed.seed),
      cbFloats,
      docNorms,
      packedCodes,
      lutScratch: new Float32Array(parsed.subspaces.length * 256),
    };
    _sidecarMemCache.set(sidecarPath, { mtimeMs: stat.mtimeMs, size: stat.size, decoded });
    return decoded;
  } catch {
    return null;
  }
}

function tryRankWithSidecar({
  sidecarPath,
  fullQueryVector,
  provider,
  dimension,
  lessons,
  pruneCache,
  assertCompatibleEmbeddings,
}) {
  const sidecar = loadDecodedSidecar(sidecarPath);
  if (!sidecar || sidecar.dimension !== dimension) return null;
  const identity = assertCompatibleEmbeddings({
    queryProvider: provider,
    queryDimension: dimension,
    documentProvider: sidecar.provider,
    documentDimension: sidecar.dimension,
  });
  if (!identity.ok) return null;

  const targetRows = [];
  for (const lesson of lessons) {
    if (!lesson || !lesson.id) continue;
    const text = lessonText(lesson);
    if (!text) continue;
    const idx = sidecar.indexById.get(lesson.id);
    if (idx === undefined || sidecar.hashes[idx] !== hashText(text)) return null;
    targetRows.push({ id: lesson.id, idx });
  }
  if (pruneCache && targetRows.length !== sidecar.ids.length) return null;
  if (targetRows.length === 0) return [];

  const rotQuery = sidecar.butterfly.rotate(fullQueryVector);
  let normSq = 0;
  for (let i = 0; i < rotQuery.length; i++) normSq += rotQuery[i] * rotQuery[i];
  const invQueryNorm = normSq > 0 ? 1 / Math.sqrt(normSq) : 0;
  if (invQueryNorm === 0) return targetRows.map((row) => ({ id: row.id, score: 0 }));

  const { lutScratch, subspaces, cbFloats, packedCodes, docNorms, numSubspaces } = sidecar;
  let cbCursor = 0;
  for (let s = 0; s < numSubspaces; s++) {
    const [offset, subDim, k] = subspaces[s];
    const lutBase = s << 8;
    for (let c = 0; c < k; c++) {
      let dot = 0;
      for (let j = 0; j < subDim; j++) dot += rotQuery[offset + j] * cbFloats[cbCursor++];
      lutScratch[lutBase + c] = dot;
    }
  }

  return targetRows
    .map(({ id, idx }) => {
      let dot = 0;
      const codeBase = idx * numSubspaces;
      for (let s = 0; s < numSubspaces; s++) {
        dot += lutScratch[(s << 8) + packedCodes[codeBase + s]];
      }
      return { id, score: (dot * invQueryNorm) / docNorms[idx] };
    })
    .sort((a, b) => b.score - a.score);
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
  try {
    const { hasSemanticEmbeddingProvider } = require('./vector-store');
    return hasSemanticEmbeddingProvider();
  } catch {
    return false;
  }
}

function defaultEmbedder() {
  // Lazy: do not pull in LanceDB or optional embedding providers at module require time.
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
    const tmpPath = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(cache), { mode: 0o600 });
    fs.renameSync(tmpPath, cachePath);
    fs.chmodSync(cachePath, 0o600);
  } catch {
    /* cache is best-effort; never throw into the hot path */
  }
}

function resolveProviderFingerprint(options, vector) {
  if (options.embedder) {
    return String(options.embedderId || options.embedder.providerId || 'injected-test');
  }
  try {
    const { getLastEmbeddingProfile } = require('./vector-store');
    const profile = getLastEmbeddingProfile();
    const active = profile && profile.activeProfile;
    return [
      profile && profile.source,
      active && active.id,
      active && active.model,
      Array.isArray(vector) ? vector.length : 0,
    ].filter(Boolean).join(':') || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Rank lessons by dense (embedding) similarity to the query.
 * Returns [{ id, score }] sorted descending. Embeds the query once; reuses cached
 * document vectors and only embeds new/changed lessons.
 *
 * Fail-closed on embedding identity (Pete Johnson / SDS #1017): never cosine
 * vectors from different providers or base dimensions. Optional progressive
 * Matryoshka: coarse truncate filter, then fine re-rank survivors.
 *
 * @returns {Promise<Array<{id:string, score:number}>>}
 */
async function semanticRank(queryText, lessons = [], options = {}) {
  const {
    feedbackDir,
    embedder = defaultEmbedder(),
    persist = true,
    pruneCache = true,
    truncateDimension = null,
    progressiveMatryoshka = false,
    progressiveTopK = null,
    cacheFile = CACHE_FILE,
    useCodebookSidecar = true,
  } = options;
  if (!queryText || !Array.isArray(lessons) || lessons.length === 0) return [];

  const resolvedDir = resolveFeedbackDir(feedbackDir);
  const cachePath = path.join(resolvedDir, path.basename(cacheFile));
  const sidecarPath = getSidecarPath(resolvedDir, cacheFile);

  const fullQueryVector = await embedder(queryText, { kind: 'query', task: 'code retrieval' });
  if (!Array.isArray(fullQueryVector) || fullQueryVector.length === 0) return [];

  const provider = resolveProviderFingerprint(options, fullQueryVector);
  const dimension = fullQueryVector.length;
  if (!options.embedder && /(?:built-in|feature-hash)/i.test(provider)) {
    throw new Error('Semantic embedding provider degraded to feature hashing');
  }

  const { assertCompatibleEmbeddings, buildProgressiveRetrievalPlan } = require('./rag-embedding-identity');

  if (useCodebookSidecar && !progressiveMatryoshka && !truncateDimension && dimension >= MIN_EMEANS_DIMENSION) {
    const fastRanked = tryRankWithSidecar({
      sidecarPath,
      fullQueryVector,
      provider,
      dimension,
      lessons,
      pruneCache,
      assertCompatibleEmbeddings,
    });
    if (fastRanked) return fastRanked;
  }

  const cache = readCache(cachePath);
  let cacheDirty = false;
  // Never score full-dim then coarse-filter — that is strictly more expensive.
  let progressivePlan = null;
  let coarseDim = null;
  if (progressiveMatryoshka && !truncateDimension) {
    progressivePlan = buildProgressiveRetrievalPlan({ embeddingDim: dimension });
    const plannedCoarse = progressivePlan.stages[0].dimension;
    if (plannedCoarse < dimension) coarseDim = plannedCoarse;
  }

  const scoreDim = truncateDimension || null;
  const compareQueryVector = scoreDim
    ? truncateVector(fullQueryVector, scoreDim)
    : fullQueryVector;
  const coarseQueryVector = coarseDim
    ? truncateVector(fullQueryVector, coarseDim)
    : null;

  const candidates = [];
  for (const lesson of lessons) {
    if (!lesson || !lesson.id) continue;
    const text = lessonText(lesson);
    if (!text) continue;
    const hash = hashText(text);

    let entry = cache[lesson.id];
    if (
      !entry
      || entry.hash !== hash
      || entry.provider !== provider
      || entry.dimension !== dimension
      || !Array.isArray(entry.vector)
      || entry.vector.length !== dimension
    ) {
      // Provider/dim drift → re-embed. Never cosine across mismatched identities.
      const vector = await embedder(text, {
        kind: 'document',
        task: 'code retrieval',
        title: lesson.title || undefined,
      });
      if (!Array.isArray(vector) || vector.length === 0) continue;
      if (vector.length !== dimension) continue;
      // Re-resolve AFTER each document embed so a same-dim fallback provider
      // cannot be cached under the query provider fingerprint (Codex P1).
      const documentProvider = resolveProviderFingerprint(options, vector);
      const identity = assertCompatibleEmbeddings({
        queryProvider: provider,
        queryDimension: dimension,
        documentProvider,
        documentDimension: vector.length,
      });
      if (!identity.ok) continue;
      // Cache under the query-session provider only when identities match.
      entry = { hash, provider, dimension, vector };
      cache[lesson.id] = entry;
      cacheDirty = true;
    } else {
      // Cached entry still must match the active query identity.
      const identity = assertCompatibleEmbeddings({
        queryProvider: provider,
        queryDimension: dimension,
        documentProvider: entry.provider,
        documentDimension: entry.dimension,
      });
      if (!identity.ok) continue;
    }

    candidates.push({ id: lesson.id, vector: entry.vector });
  }

  // Prune only when the caller supplied the complete corpus. Metadata-filtered
  // searches pass pruneCache=false so alternating filters cannot evict and
  // regenerate one another's vectors.
  if (pruneCache) {
    const liveIds = new Set(lessons.map((l) => l && l.id).filter(Boolean));
    for (const id of Object.keys(cache)) {
      if (!liveIds.has(id)) {
        delete cache[id];
        cacheDirty = true;
      }
    }
  }

  if (persist && cacheDirty) {
    writeCache(cachePath, cache);
    if (fs.existsSync(sidecarPath)) {
      writeEmeansSidecar(sidecarPath, compileEmeansCodebookSidecar(cache));
    }
  }
  if (candidates.length === 0) return [];

  // Coarse-first path: score at coarse dim, then full-dim only survivors.
  if (coarseDim && coarseQueryVector && candidates.length > 1) {
    const coarseScored = candidates.map((row) => ({
      id: row.id,
      score: cosineSimilarity(coarseQueryVector, truncateVector(row.vector, coarseDim)),
      vector: row.vector,
    })).sort((a, b) => b.score - a.score);

    const keepBase = Math.max(
      1,
      Number(progressiveTopK) || Math.min(candidates.length, Math.ceil(candidates.length / 2) || 8)
    );
    const keep = Math.min(
      coarseScored.length,
      keepBase * (progressivePlan.stages[0].topKMultiplier || 4)
    );
    const survivors = coarseScored.slice(0, keep);
    return survivors
      .map((row) => ({
        id: row.id,
        score: cosineSimilarity(fullQueryVector, row.vector),
      }))
      .sort((a, b) => b.score - a.score);
  }

  // Standard path: single-pass cosine at requested (or full) dimension.
  return candidates
    .map((row) => {
      const docVector = scoreDim ? truncateVector(row.vector, scoreDim) : row.vector;
      if (docVector.length !== compareQueryVector.length) {
        return null;
      }
      return {
        id: row.id,
        score: cosineSimilarity(compareQueryVector, docVector),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

module.exports = {
  semanticRank,
  isEmbedderAvailable,
  cosineSimilarity,
  truncateVector,
  lessonText,
  hashText,
  getCachePath,
  getSidecarPath,
  readCache,
  writeCache,
  resolveProviderFingerprint,
  buildHadamardButterfly,
  trainEmeans,
  compileEmeansCodebookSidecar,
  writeEmeansSidecar,
  loadDecodedSidecar,
  MIN_EMEANS_SIDECAR_CORPUS,
  MIN_EMEANS_DIMENSION,
};
