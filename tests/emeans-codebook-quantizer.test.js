'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeEmeansScalingLaws,
  cosineAnnealStep,
  runEmeansClustering,
  compileEmeansCodebook,
  queryEmeansCodebook,
} = require('../src/emeans-codebook-quantizer');

test('computeEmeansScalingLaws derives deterministic batch size and alpha0 without manual tuning', () => {
  const scaling = computeEmeansScalingLaws({ n: 1024, k: 16, epochs: 2 });
  assert.ok(scaling.batchSize >= 16 && scaling.batchSize <= 1024);
  assert.ok(scaling.alpha0 >= 0.25 && scaling.alpha0 <= 0.85);
  assert.equal(scaling.minAlphaRatio, 0.1);
  assert.ok(scaling.totalSteps >= 1);
});

test('cosineAnnealStep smoothly decays alpha0 down to 0.1 * alpha0', () => {
  const alpha0 = 0.6;
  const start = cosineAnnealStep(alpha0, 0, 100, 0.1);
  const mid = cosineAnnealStep(alpha0, 50, 100, 0.1);
  const end = cosineAnnealStep(alpha0, 100, 100, 0.1);

  assert.ok(Math.abs(start - 0.6) < 1e-9);
  assert.ok(mid < start && mid > end);
  assert.ok(Math.abs(end - 0.06) < 1e-9);
});

test('runEmeansClustering separates multi-modal clusters in 2 epochs with low MSE', () => {
  const centers = [
    [10, 0, 0, 0],
    [0, 10, 0, 0],
    [0, 0, 10, 0],
    [0, 0, 0, 10],
  ];
  const vectors = [];
  for (let c = 0; c < centers.length; c++) {
    for (let i = 0; i < 30; i++) {
      const offset = (i - 15) * 0.01;
      vectors.push(centers[c].map((v) => v + offset));
    }
  }

  const res = runEmeansClustering(vectors, { k: 4, epochs: 2, seed: 7 });
  assert.equal(res.centroids.length, 4);
  assert.equal(res.assignments.length, vectors.length);
  assert.ok(res.mse < 0.05, `Expected low MSE < 0.05, got ${res.mse}`);
});

test('compileEmeansCodebook achieves >=6.84x effective compression and high cosine retention on 64d vectors', () => {
  const prototypes = [
    Array.from({ length: 64 }, (_, d) => Math.sin(d * 0.2)),
    Array.from({ length: 64 }, (_, d) => Math.cos(d * 0.2)),
    Array.from({ length: 64 }, (_, d) => Math.sin(d * 0.5 + 1.0)),
    Array.from({ length: 64 }, (_, d) => Math.cos(d * 0.5 + 2.0)),
  ];

  const vectors = [];
  for (let p = 0; p < prototypes.length; p++) {
    for (let i = 0; i < 32; i++) {
      const jitter = ((i % 7) - 3) * 0.015;
      vectors.push(prototypes[p].map((v) => v + jitter));
    }
  }

  const codebook = compileEmeansCodebook(vectors, {
    subspaces: 8,
    centroidsPerSubspace: 16,
    epochs: 2,
    seed: 42,
  });

  assert.equal(codebook.schema, 'thumbgate.emeans-codebook.v1');
  assert.equal(codebook.paperRef, 'arXiv:2611.09501');
  assert.ok(
    codebook.metrics.effectiveCompressionRatio >= 6.84,
    `Expected effectiveCompressionRatio >= 6.84, got ${codebook.metrics.effectiveCompressionRatio}`
  );
  assert.ok(
    codebook.metrics.meanCosineRetention >= 0.919,
    `Expected meanCosineRetention >= 0.919, got ${codebook.metrics.meanCosineRetention}`
  );

  // Verify fast ADC query returns matching prototype cluster at top rank
  const hits = queryEmeansCodebook(vectors[0], codebook, 3);
  assert.equal(hits.length, 3);
  assert.ok(hits[0].index < 32, `Expected top hit from prototype 0 [0..31], got index ${hits[0].index}`);
});
