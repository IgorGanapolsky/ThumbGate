'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  semanticRank,
  cosineSimilarity,
  buildHadamardButterfly,
  trainEmeans,
  compileEmeansCodebookSidecar,
  getSidecarPath,
} = require('../scripts/lesson-embedding-index');
const {
  evaluateEmbeddingIndexDrift,
  backfillLessonEmbeddings,
} = require('../scripts/lesson-embedding-maintenance');
const {
  evaluateLocalDecodeRooflineAndQuantization,
  recommendInferenceBackend,
} = require('../scripts/local-model-profile');

function makeSyntheticVector(seedIndex, dim = 384) {
  const out = new Array(dim);
  let normSq = 0;
  for (let i = 0; i < dim; i++) {
    const val = Math.sin((seedIndex + 1) * 0.37 + i * 0.11)
      + 0.4 * Math.cos((seedIndex + 3) * 0.19 - i * 0.07);
    out[i] = val;
    normSq += val * val;
  }
  const norm = Math.sqrt(normSq) || 1;
  for (let i = 0; i < dim; i++) out[i] /= norm;
  return out;
}

test('Double Block-Hadamard Butterfly preserves inner products and spreads coordinate outliers', () => {
  for (const dim of [384, 768, 37]) {
    const butterfly = buildHadamardButterfly(dim, 'orthogonality-check');
    const a = makeSyntheticVector(1, dim);
    const b = makeSyntheticVector(2, dim);
    const rotA = butterfly.rotate(a);
    const rotB = butterfly.rotate(b);

    let origDot = 0;
    for (let i = 0; i < dim; i++) origDot += a[i] * b[i];
    let rotDot = 0;
    for (let i = 0; i < rotA.length; i++) rotDot += rotA[i] * rotB[i];

    assert.ok(
      Math.abs(origDot - rotDot) < 1e-5,
      `dim=${dim}: expected orthogonal dot product invariance, got |${origDot} - ${rotDot}|`,
    );
  }

  // Outlier spreading: single spike [100, 0, ..., 0] spreads across coordinates
  const outlier = new Array(384).fill(0);
  outlier[0] = 100;
  const rotatedOutlier = buildHadamardButterfly(384, 'spike').rotate(outlier);
  let maxCoord = 0;
  for (let i = 0; i < rotatedOutlier.length; i++) {
    const absVal = Math.abs(rotatedOutlier[i]);
    if (absVal > maxCoord) maxCoord = absVal;
  }
  assert.ok(maxCoord < 20, `expected outlier spike 100 to spread below 20, got ${maxCoord}`);
});

test('trainEmeans auto-tunes batch/step via scaling laws and separates imbalanced clusters without dead centroids', () => {
  const dim = 8;
  const count = 240;
  const data = new Float32Array(count * dim);
  // Imbalanced clusters: 180 points near +5, 45 near -5, 15 near +15
  for (let i = 0; i < count; i++) {
    const center = i < 180 ? 5 : (i < 225 ? -5 : 15);
    for (let j = 0; j < dim; j++) {
      data[i * dim + j] = center + ((i * 7 + j * 13) % 11 - 5) * 0.05;
    }
  }

  const trained = trainEmeans(data, count, dim, 3, { epochs: 5, law: 'quality', seed: 'blobs-3' });
  assert.equal(trained.centroids.length, 3 * dim);
  assert.ok(trained.batchSize >= 3 && trained.batchSize <= count);
  assert.ok(trained.alpha0 > 0 && trained.alpha0 <= 1);

  const clusterFirstCoords = [
    trained.centroids[0],
    trained.centroids[dim],
    trained.centroids[2 * dim],
  ].sort((a, b) => a - b);

  assert.ok(Math.abs(clusterFirstCoords[0] - (-5)) < 0.5, `expected -5 centroid, got ${clusterFirstCoords[0]}`);
  assert.ok(Math.abs(clusterFirstCoords[1] - 5) < 0.5, `expected +5 centroid, got ${clusterFirstCoords[1]}`);
  assert.ok(Math.abs(clusterFirstCoords[2] - 15) < 0.5, `expected +15 centroid, got ${clusterFirstCoords[2]}`);
});

test('semanticRank executes compiled e-means ADC sidecar on hot path with >=0.95 Recall@5 and fail-closed drift recovery', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-emeans-hotpath-'));
  try {
    const dim = 384;
    const lessons = Array.from({ length: 32 }, (_, idx) => ({
      id: `lesson-${idx}`,
      title: `Guardrail lesson ${idx}`,
      content: `Prevent failure pattern ${idx} in tool execution.`,
      tags: ['negative'],
      timestamp: new Date().toISOString(),
    }));
    fs.writeFileSync(
      path.join(tempDir, 'memory-log.jsonl'),
      `${lessons.map((l) => JSON.stringify(l)).join('\n')}\n`,
    );

    const vectorByText = new Map();
    lessons.forEach((lesson, idx) => {
      const key = `${lesson.title} ${lesson.content} negative`;
      vectorByText.set(key, makeSyntheticVector(idx, dim));
    });

    const embedder = async (text) => {
      if (vectorByText.has(text)) return vectorByText.get(text);
      const match = /query-(\d+)/.exec(String(text));
      const baseIdx = match ? Number(match[1]) : 0;
      const base = makeSyntheticVector(baseIdx, dim);
      return base.map((v, j) => v + Math.sin(j + baseIdx) * 0.02);
    };

    const report = await backfillLessonEmbeddings({
      feedbackDir: tempDir,
      embedder,
      embedderId: 'synthetic-384',
    });

    assert.equal(report.status, 'healthy');
    assert.equal(report.codebookSidecar.present, true);
    assert.equal(report.codebookSidecar.inSync, true);
    assert.ok(
      report.codebookSidecar.compressionRatio >= 3.5,
      `expected significant sidecar compression, got ${report.codebookSidecar.compressionRatio}x`,
    );
    assert.ok(report.codebookSidecar.avgBitsPerWeight >= 2.0 && report.codebookSidecar.avgBitsPerWeight <= 4.0);

    const sidecarPath = getSidecarPath(tempDir);
    assert.equal(fs.statSync(sidecarPath).mode & 0o777, 0o600);

    // Measure Recall@5 against exact Float64 path (useCodebookSidecar: false)
    let recallSum = 0;
    const queryCount = 16;
    for (let q = 0; q < queryCount; q++) {
      const exact = await semanticRank(`query-${q}`, lessons, {
        feedbackDir: tempDir,
        embedder,
        embedderId: 'synthetic-384',
        useCodebookSidecar: false,
      });
      const fast = await semanticRank(`query-${q}`, lessons, {
        feedbackDir: tempDir,
        embedder,
        embedderId: 'synthetic-384',
        useCodebookSidecar: true,
      });
      assert.equal(fast[0].id, exact[0].id, `query-${q}: top-1 must match exact cosine`);
      const exactTop5 = new Set(exact.slice(0, 5).map((r) => r.id));
      const hits = fast.slice(0, 5).filter((r) => exactTop5.has(r.id)).length;
      recallSum += hits / 5;
    }
    const meanRecallAt5 = recallSum / queryCount;
    assert.ok(meanRecallAt5 >= 0.95, `expected Recall@5 >= 0.95, got ${meanRecallAt5}`);

    // Anti-shelfware proof: corrupt/remove raw lesson-embeddings.json temporarily;
    // semanticRank MUST still succeed from the compiled e-means sidecar alone!
    const rawCachePath = path.join(tempDir, 'lesson-embeddings.json');
    const savedRaw = fs.readFileSync(rawCachePath, 'utf8');
    fs.unlinkSync(rawCachePath);

    let docEmbedCalls = 0;
    const queryOnlyEmbedder = async (text, opts = {}) => {
      if (opts.kind === 'document') docEmbedCalls += 1;
      return embedder(text);
    };
    const sidecarOnlyRanked = await semanticRank('query-3', lessons, {
      feedbackDir: tempDir,
      embedder: queryOnlyEmbedder,
      embedderId: 'synthetic-384',
    });
    assert.equal(docEmbedCalls, 0, 'hot-path sidecar must not re-embed documents when hashes match');
    assert.equal(sidecarOnlyRanked[0].id, 'lesson-3');

    // Restore raw cache and mutate one lesson -> must bypass stale sidecar, re-embed ONLY changed lesson, and refresh sidecar!
    fs.writeFileSync(rawCachePath, savedRaw, { mode: 0o600 });
    const mutatedLessons = lessons.map((l, idx) => (
      idx === 5 ? { ...l, content: 'Updated corrective action after drift' } : l
    ));
    vectorByText.set(
      `${mutatedLessons[5].title} ${mutatedLessons[5].content} negative`,
      makeSyntheticVector(99, dim),
    );

    const postDriftRanked = await semanticRank('query-5', mutatedLessons, {
      feedbackDir: tempDir,
      embedder: queryOnlyEmbedder,
      embedderId: 'synthetic-384',
    });
    assert.equal(docEmbedCalls, 1, 'drift recovery must re-embed only the single mutated lesson');
    assert.equal(postDriftRanked.length, 32);

    // Provider mismatch must fail-closed on sidecar and never mix identities
    const mismatched = compileEmeansCodebookSidecar({
      a: { hash: 'h1', provider: 'p1', dimension: 12, vector: new Array(12).fill(0.2) },
      b: { hash: 'h2', provider: 'p2', dimension: 12, vector: new Array(12).fill(0.3) },
    }, { minCorpusSize: 2 });
    assert.equal(mismatched, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('evaluateLocalDecodeRooflineAndQuantization fixes 4x hybrid KV overestimate and gates sub-4-bit TCQ to speculative drafters', () => {
  const appleEnv = {
    THUMBGATE_RAM_BYTES_OVERRIDE: String(48 * (1024 ** 3)),
    THUMBGATE_PLATFORM_OVERRIDE: 'darwin',
    THUMBGATE_ARCH_OVERRIDE: 'arm64',
  };

  // 1. Qwen3.8-27B hybrid attention (64 total layers, 16 full-attention) @ 8-bit weights + 8-bit KV fits 36 GB Metal ceiling
  const qwen27bHybrid = evaluateLocalDecodeRooflineAndQuantization({
    role: 'coding',
    modelParamB: 27,
    bitsPerWeight: 8,
    kvCacheBits: 8,
    contextTokens: 65536,
    totalLayers: 64,
    fullAttentionInterval: 4,
    numKeyValueHeads: 8,
    headDim: 128,
    memoryBandwidthGbPerSec: 307,
    peakComputeTflops: 22,
  }, appleEnv);

  assert.equal(qwen27bHybrid.allowed, true);
  assert.equal(qwen27bHybrid.verdict, 'PASS_LOCAL_QUALITY_FIT');
  assert.equal(qwen27bHybrid.memoryBudget.fullAttentionLayers, 16);
  assert.equal(qwen27bHybrid.memoryBudget.kvOverestimationFactorAvoided, 4);
  assert.equal(qwen27bHybrid.roofline.rooflineRegime, 'memory_bandwidth_bound');

  // 2. @shinboson Qwen3.5-4B at 2.3 bpw (1.15 GB) REJECTED as primary coding model on 48 GB Mac (apple-silicon-llm rule)
  const tcqPrimaryRejected = evaluateLocalDecodeRooflineAndQuantization({
    role: 'coding',
    modelParamB: 4.2,
    bitsPerWeight: 2.3,
    quantizationScheme: 'qtip-tcq-emeans',
    kvCacheBits: 8,
    memoryBandwidthGbPerSec: 546,
    peakComputeTflops: 18,
  }, appleEnv);

  assert.equal(tcqPrimaryRejected.allowed, false);
  assert.equal(tcqPrimaryRejected.verdict, 'FAIL_SUB_4BIT_PRIMARY_QUALITY_FLOOR');

  // 3. Same 2.3 bpw e-means TCQ Qwen3.5-4B ALLOWED as lossless speculative_drafter in compute-bound regime!
  const tcqDrafterAllowed = evaluateLocalDecodeRooflineAndQuantization({
    role: 'speculative_drafter',
    modelParamB: 4.2,
    bitsPerWeight: 2.3,
    quantizationScheme: 'qtip-tcq-emeans',
    kvCacheBits: 8,
    memoryBandwidthGbPerSec: 546,
    peakComputeTflops: 18,
  }, appleEnv);

  assert.equal(tcqDrafterAllowed.allowed, true);
  assert.equal(tcqDrafterAllowed.verdict, 'PASS_TCQ_LOSSLESS_SPECULATIVE_DRAFTER');
  assert.equal(tcqDrafterAllowed.roofline.rooflineRegime, 'compute_bound');
  assert.equal(tcqDrafterAllowed.roofline.bandwidthBottlenecked, false);

  // 4. 4-bit KV cache is blocked for alignment collapse
  const badKv = evaluateLocalDecodeRooflineAndQuantization({
    role: 'coding',
    modelParamB: 8,
    bitsPerWeight: 8,
    kvCacheBits: 4,
  }, appleEnv);
  assert.equal(badKv.allowed, false);
  assert.equal(badKv.verdict, 'FAIL_4BIT_KV_ALIGNMENT_COLLAPSE');

  // 5. Wired into recommendInferenceBackend when task.decodeModel is supplied
  const routed = recommendInferenceBackend({
    privacyRoute: 'local',
    decodeModel: {
      role: 'speculative_drafter',
      modelParamB: 4.2,
      bitsPerWeight: 2.3,
      quantizationScheme: 'qtip-tcq-emeans',
      memoryBandwidthGbPerSec: 546,
      peakComputeTflops: 18,
    },
  }, {
    ...appleEnv,
    THUMBGATE_PROVIDER_MODE: 'local',
    THUMBGATE_LOCAL_MODEL_FAMILY: 'qwen3.5',
  });
  assert.equal(routed.decodeRooflineAudit.verdict, 'PASS_TCQ_LOSSLESS_SPECULATIVE_DRAFTER');
});
