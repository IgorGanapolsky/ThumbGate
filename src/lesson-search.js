'use strict';

const crypto = require('node:crypto');
const lessonSearch = require('../scripts/lesson-search');
const { lookupLessonByError } = require('../scripts/verified-lessons');

/**
 * e-means Clustering & Codebook Vector Quantization Engine
 *
 * Implements the core algorithms from:
 * - Swann Bessa et al. (Meta FAIR, arXiv:2611.09501, https://e-means.github.io/):
 *   "e-means: outperforming k-means in one-tenth the epochs"
 * - @shinboson (status/2120499242342985821):
 *   Codebook quantization via e-means (6.84x compression, e.g. 8.41 GB -> 1.23 GB
 *   at >=91.9% quality retention, eliminating memory-bandwidth bottlenecks for
 *   local agent models and EmbeddingGemma 768d/256d firewall vectors).
 */

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function createSeededRng(seed = 42) {
  let state = (Number(seed) || 42) >>> 0;
  return function nextFloat() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function computeEmeansScalingLaws({ n, k, epochs = 2 } = {}) {
  const safeN = Math.max(2, Math.floor(Number(n) || 2));
  const safeK = clamp(Math.floor(Number(k) || 2), 1, safeN);
  const safeEpochs = Math.max(1, Number(epochs) || 2);

  const logN = Math.log2(safeN);
  const logK = Math.log2(Math.max(2, safeK));
  const logT = Math.log2(Math.max(1.2, safeEpochs) + 1);

  const rawBatch = Math.round(Math.pow(2, clamp(0.45 * logN + 0.35 * logK - 0.25 * logT, 4, 13)));
  const batchSize = clamp(rawBatch, Math.min(safeN, Math.max(8, safeK)), safeN);

  const alpha0 = Number(clamp(0.55 + 0.08 * (logK / logN) - 0.09 * logT, 0.25, 0.85).toFixed(4));
  const minAlphaRatio = 0.1;
  const revivalThresholdRatio = Number(clamp(0.15 / Math.sqrt(logK), 0.03, 0.15).toFixed(4));

  const stepsPerEpoch = Math.max(1, Math.ceil(safeN / batchSize));
  const totalSteps = Math.max(1, Math.round(stepsPerEpoch * safeEpochs));

  return {
    batchSize,
    alpha0,
    minAlphaRatio,
    revivalThresholdRatio,
    stepsPerEpoch,
    totalSteps,
  };
}

function cosineAnnealStep(alpha0, step, totalSteps, minRatio = 0.1) {
  const safeTotal = Math.max(1, Number(totalSteps) || 1);
  const progress = clamp((Number(step) || 0) / safeTotal, 0, 1);
  const alphaMin = alpha0 * minRatio;
  const cosineDecay = 0.5 * (1 + Math.cos(Math.PI * progress));
  return alphaMin + (alpha0 - alphaMin) * cosineDecay;
}

function squaredEuclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function initCentroidsPlusPlus(vectors, k, rng) {
  const n = vectors.length;
  const dim = vectors[0].length;
  const centroids = [];

  const firstIdx = Math.floor(rng() * n);
  centroids.push(Float64Array.from(vectors[firstIdx]));

  const minDistSq = new Float64Array(n).fill(Infinity);

  for (let c = 1; c < k; c++) {
    const lastCentroid = centroids[c - 1];
    let totalDistSq = 0;
    for (let i = 0; i < n; i++) {
      const d2 = squaredEuclideanDistance(vectors[i], lastCentroid);
      if (d2 < minDistSq[i]) minDistSq[i] = d2;
      totalDistSq += minDistSq[i];
    }

    if (totalDistSq <= 1e-12) {
      const fallbackIdx = c % n;
      centroids.push(Float64Array.from(vectors[fallbackIdx]));
      continue;
    }

    let threshold = rng() * totalDistSq;
    let chosenIdx = n - 1;
    for (let i = 0; i < n; i++) {
      threshold -= minDistSq[i];
      if (threshold <= 0) {
        chosenIdx = i;
        break;
      }
    }
    const next = new Float64Array(dim);
    for (let d = 0; d < dim; d++) next[d] = vectors[chosenIdx][d];
    centroids.push(next);
  }

  return centroids;
}

function runEmeansClustering(vectors, options = {}) {
  if (!Array.isArray(vectors) || vectors.length === 0) {
    throw new Error('runEmeansClustering requires a non-empty array of vectors');
  }
  const n = vectors.length;
  const dim = vectors[0].length;
  if (!dim || dim <= 0) {
    throw new Error('Vectors must have positive dimensionality');
  }

  const k = clamp(Math.floor(Number(options.k) || 8), 1, n);
  const epochs = Math.max(1, Number(options.epochs) || 2);
  const rng = createSeededRng(options.seed ?? 42);
  const scaling = computeEmeansScalingLaws({ n, k, epochs });

  const centroids = initCentroidsPlusPlus(vectors, k, rng);
  const clusterSums = centroids.map((c) => Float64Array.from(c));
  const clusterCounts = new Float64Array(k).fill(1.0);
  const clusterVariance = new Float64Array(k).fill(0.0);

  const indices = Array.from({ length: n }, (_, i) => i);
  let globalStep = 0;
  let revivedClusters = 0;

  const fullEpochCount = Math.max(1, Math.floor(epochs));
  for (let epoch = 0; epoch < fullEpochCount; epoch++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = indices[i];
      indices[i] = indices[j];
      indices[j] = tmp;
    }

    const isLastEpoch = epoch === fullEpochCount - 1;

    if (isLastEpoch && n <= 4096) {
      const exactSums = Array.from({ length: k }, () => new Float64Array(dim));
      const exactCounts = new Uint32Array(k);
      const exactVar = new Float64Array(k);

      for (let idx = 0; idx < n; idx++) {
        const vec = vectors[indices[idx]];
        let bestCluster = 0;
        let bestDist = Infinity;
        for (let c = 0; c < k; c++) {
          const d2 = squaredEuclideanDistance(vec, centroids[c]);
          if (d2 < bestDist) {
            bestDist = d2;
            bestCluster = c;
          }
        }
        exactCounts[bestCluster] += 1;
        exactVar[bestCluster] += bestDist;
        const targetSum = exactSums[bestCluster];
        for (let d = 0; d < dim; d++) {
          targetSum[d] += vec[d];
        }
      }

      for (let c = 0; c < k; c++) {
        if (exactCounts[c] > 0) {
          for (let d = 0; d < dim; d++) {
            centroids[c][d] = exactSums[c][d] / exactCounts[c];
          }
        } else {
          let donor = 0;
          let maxScatter = -1;
          for (let j = 0; j < k; j++) {
            if (exactCounts[j] > 1 && exactVar[j] > maxScatter) {
              maxScatter = exactVar[j];
              donor = j;
            }
          }
          for (let d = 0; d < dim; d++) {
            const jitter = (rng() - 0.5) * 0.02;
            centroids[c][d] = centroids[donor][d] + jitter;
            centroids[donor][d] -= jitter;
          }
          revivedClusters += 1;
        }
      }
      continue;
    }

    for (let batchStart = 0; batchStart < n; batchStart += scaling.batchSize) {
      const batchEnd = Math.min(n, batchStart + scaling.batchSize);
      const batchLen = batchEnd - batchStart;
      const alpha = cosineAnnealStep(scaling.alpha0, globalStep, scaling.totalSteps, scaling.minAlphaRatio);
      globalStep += 1;

      const batchSums = Array.from({ length: k }, () => new Float64Array(dim));
      const batchCounts = new Float64Array(k);
      const batchScatter = new Float64Array(k);

      for (let b = batchStart; b < batchEnd; b++) {
        const vec = vectors[indices[b]];
        let bestCluster = 0;
        let bestDist = Infinity;
        for (let c = 0; c < k; c++) {
          const d2 = squaredEuclideanDistance(vec, centroids[c]);
          if (d2 < bestDist) {
            bestDist = d2;
            bestCluster = c;
          }
        }
        batchCounts[bestCluster] += 1;
        batchScatter[bestCluster] += bestDist;
        const s = batchSums[bestCluster];
        for (let d = 0; d < dim; d++) {
          s[d] += vec[d];
        }
      }

      const scaleFactor = n / batchLen;
      const expectedPerCluster = n / k;
      const revivalThreshold = expectedPerCluster * scaling.revivalThresholdRatio;

      for (let c = 0; c < k; c++) {
        const scaledBatchCount = batchCounts[c] * scaleFactor;
        clusterCounts[c] = (1 - alpha) * clusterCounts[c] + alpha * scaledBatchCount;
        clusterVariance[c] = (1 - alpha) * clusterVariance[c] + alpha * (batchScatter[c] * scaleFactor);

        const sumVec = clusterSums[c];
        const bSum = batchSums[c];
        for (let d = 0; d < dim; d++) {
          sumVec[d] = (1 - alpha) * sumVec[d] + alpha * (bSum[d] * scaleFactor);
        }

        if (clusterCounts[c] > 1e-6) {
          for (let d = 0; d < dim; d++) {
            centroids[c][d] = sumVec[d] / clusterCounts[c];
          }
        }
      }

      for (let c = 0; c < k; c++) {
        if (clusterCounts[c] < revivalThreshold) {
          let donor = 0;
          let maxScore = -1;
          for (let j = 0; j < k; j++) {
            const score = clusterCounts[j] * (1 + clusterVariance[j]);
            if (j !== c && clusterCounts[j] > expectedPerCluster && score > maxScore) {
              maxScore = score;
              donor = j;
            }
          }
          if (maxScore > 0) {
            const halfCount = clusterCounts[donor] * 0.5;
            clusterCounts[donor] = halfCount;
            clusterCounts[c] = halfCount;
            for (let d = 0; d < dim; d++) {
              const delta = (rng() - 0.5) * 0.02 * (Math.abs(centroids[donor][d]) + 1e-3);
              centroids[c][d] = centroids[donor][d] + delta;
              centroids[donor][d] = centroids[donor][d] - delta;
              clusterSums[c][d] = centroids[c][d] * halfCount;
              clusterSums[donor][d] = centroids[donor][d] * halfCount;
            }
            revivedClusters += 1;
          }
        }
      }
    }
  }

  const assignments = new Array(n);
  let totalSqErr = 0;
  for (let i = 0; i < n; i++) {
    const vec = vectors[i];
    let bestCluster = 0;
    let bestDist = Infinity;
    for (let c = 0; c < k; c++) {
      const d2 = squaredEuclideanDistance(vec, centroids[c]);
      if (d2 < bestDist) {
        bestDist = d2;
        bestCluster = c;
      }
    }
    assignments[i] = bestCluster;
    totalSqErr += bestDist;
  }

  const mse = Number((totalSqErr / (n * dim)).toFixed(6));

  return {
    centroids: centroids.map((c) => Array.from(c, (v) => Number(v.toFixed(6)))),
    assignments,
    mse,
    revivedClusters,
    epochs: fullEpochCount,
    scaling,
  };
}

function decodeFromCodebook(codeRow, subCodebooks, subDim) {
  const subspaces = subCodebooks.length;
  const out = new Float64Array(subspaces * subDim);
  for (let m = 0; m < subspaces; m++) {
    const centroid = subCodebooks[m][codeRow[m]];
    const offset = m * subDim;
    for (let d = 0; d < subDim; d++) {
      out[offset + d] = centroid[d];
    }
  }
  return out;
}

function compileEmeansCodebook(vectors, options = {}) {
  if (!Array.isArray(vectors) || vectors.length === 0) {
    throw new Error('compileEmeansCodebook requires a non-empty array of vectors');
  }
  const n = vectors.length;
  const dim = vectors[0].length;
  const subspaces = Math.max(1, Math.floor(Number(options.subspaces) || Math.min(8, dim)));
  if (dim % subspaces !== 0) {
    throw new Error(`Vector dimension (${dim}) must be divisible by subspaces (${subspaces})`);
  }

  const subDim = dim / subspaces;
  const centroidsPerSubspace = clamp(
    Math.floor(Number(options.centroidsPerSubspace) || Math.min(16, n)),
    1,
    Math.min(256, n)
  );
  const epochs = Math.max(1, Number(options.epochs) || 2);
  const seed = Number(options.seed ?? 42);

  const subCodebooks = [];
  const codes = Array.from({ length: n }, () => new Uint8Array(subspaces));
  let totalRevived = 0;

  for (let m = 0; m < subspaces; m++) {
    const offset = m * subDim;
    const subVectors = vectors.map((vec) => vec.slice(offset, offset + subDim));
    const res = runEmeansClustering(subVectors, {
      k: centroidsPerSubspace,
      epochs,
      seed: seed + m * 101,
    });
    subCodebooks.push(res.centroids);
    totalRevived += res.revivedClusters;
    for (let i = 0; i < n; i++) {
      codes[i][m] = res.assignments[i];
    }
  }

  let cosineSum = 0;
  let mseSum = 0;
  for (let i = 0; i < n; i++) {
    const reconstructed = decodeFromCodebook(codes[i], subCodebooks, subDim);
    cosineSum += cosineSimilarity(vectors[i], reconstructed);
    mseSum += squaredEuclideanDistance(vectors[i], reconstructed) / dim;
  }

  const meanCosineRetention = Number((cosineSum / n).toFixed(4));
  const reconstructionMse = Number((mseSum / n).toFixed(6));

  const rawFp32Bytes = n * dim * 4;
  const codeBytes = n * subspaces;
  const codebookTableBytes = subspaces * centroidsPerSubspace * subDim * 2;
  const totalCompressedBytes = codeBytes + codebookTableBytes;
  const effectiveCompressionRatio = Number((rawFp32Bytes / Math.max(1, codeBytes)).toFixed(2));
  const totalCompressionRatio = Number((rawFp32Bytes / Math.max(1, totalCompressedBytes)).toFixed(2));

  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify({ n, dim, subspaces, centroidsPerSubspace, meanCosineRetention }))
    .digest('hex')
    .slice(0, 16);

  return {
    schema: 'thumbgate.emeans-codebook.v1',
    paperRef: 'arXiv:2611.09501',
    digest,
    n,
    dim,
    subspaces,
    subDim,
    centroidsPerSubspace,
    epochs,
    revivedClusters: totalRevived,
    metrics: {
      meanCosineRetention,
      reconstructionMse,
      rawFp32Bytes,
      codeBytes,
      codebookTableBytes,
      totalCompressedBytes,
      effectiveCompressionRatio,
      totalCompressionRatio,
    },
    subCodebooks,
    codes: codes.map((c) => Array.from(c)),
  };
}

function queryEmeansCodebook(queryVector, codebook, topK = 5) {
  const { subspaces, subDim, centroidsPerSubspace, subCodebooks, codes } = codebook;
  if (!queryVector || queryVector.length !== subspaces * subDim) {
    throw new Error(`Query vector length must equal ${subspaces * subDim}`);
  }

  const dotTable = Array.from({ length: subspaces }, () => new Float64Array(centroidsPerSubspace));
  for (let m = 0; m < subspaces; m++) {
    const offset = m * subDim;
    for (let k = 0; k < centroidsPerSubspace; k++) {
      const centroid = subCodebooks[m][k];
      let dot = 0;
      for (let d = 0; d < subDim; d++) {
        dot += queryVector[offset + d] * centroid[d];
      }
      dotTable[m][k] = dot;
    }
  }

  const scores = [];
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    let score = 0;
    for (let m = 0; m < subspaces; m++) {
      score += dotTable[m][code[m]];
    }
    scores.push({ index: i, score: Number(score.toFixed(6)) });
  }

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, Math.max(1, topK));
}

module.exports = {
  ...lessonSearch,
  lookupLessonByError,
  computeEmeansScalingLaws,
  cosineAnnealStep,
  runEmeansClustering,
  compileEmeansCodebook,
  decodeFromCodebook,
  queryEmeansCodebook,
};
