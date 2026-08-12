'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseEmbeddingIdentity,
  assertCompatibleEmbeddings,
  buildProgressiveRetrievalPlan,
  scoreEmbeddingRoiReadiness,
} = require('../scripts/rag-embedding-identity');
const { semanticRank, cosineSimilarity } = require('../scripts/lesson-embedding-index');

describe('rag-embedding-identity (Pete Johnson / SDS #1017)', () => {
  it('parses provider fingerprints into identity keys', () => {
    const id = parseEmbeddingIdentity('gemini:models/gemini-embedding-2:768', 768);
    assert.equal(id.dimension, 768);
    assert.match(id.identityKey, /gemini/);
    assert.match(id.identityKey, /768/);
  });

  it('fails closed on provider mismatch — the classic RAG ROI destroyer', () => {
    const result = assertCompatibleEmbeddings({
      queryProvider: 'gemini:gemini-embedding-2:768',
      queryDimension: 768,
      documentProvider: 'openai:text-embedding-3-large:1536',
      documentDimension: 1536,
    });
    assert.equal(result.ok, false);
    assert.equal(result.failClosed, true);
    assert.ok(result.issues.some((i) => i.code === 'embedding_provider_mismatch'));
    assert.ok(result.issues.some((i) => i.code === 'embedding_dimension_mismatch'));
  });

  it('accepts matching provider and dimension', () => {
    const result = assertCompatibleEmbeddings({
      queryProvider: 'local:transformers:768',
      queryDimension: 768,
      documentProvider: 'local:transformers:768',
      documentDimension: 768,
    });
    assert.equal(result.ok, true);
    assert.equal(result.issues.length, 0);
  });

  it('builds progressive Matryoshka plan with research provenance', () => {
    const plan = buildProgressiveRetrievalPlan({ embeddingDim: 1536 });
    assert.equal(plan.strategy, 'progressive_matryoshka');
    assert.equal(plan.stages.length, 2);
    assert.ok(plan.stages[0].dimension <= plan.stages[1].dimension);
    assert.match(plan.researchSource.url, /jAPGTVlNoD4/);
    assert.ok(plan.rules.some((r) => /Never cosine/i.test(r)));
  });

  it('scores embedding ROI readiness: unpinned model is not ready', () => {
    const score = scoreEmbeddingRoiReadiness({
      providerPinned: true,
      modelPinned: false,
      dimensionPinned: true,
      hybridEnabled: true,
      goldenRecall: 1,
      goldenPrecision: 0.2,
      goldenCaseCount: 6,
      perCaseRecalls: [1, 1, 1, 1, 1, 1],
    });
    assert.equal(score.ready, false);
    assert.ok(score.issues.includes('model_unpinned'));
    assert.match(score.recommendation, /embedding/i);
  });

  it('flags mixed provider corpus as highest-priority ROI defect', () => {
    const score = scoreEmbeddingRoiReadiness({
      providerPinned: true,
      modelPinned: true,
      dimensionPinned: true,
      hybridEnabled: true,
      goldenRecall: 1,
      goldenPrecision: 0.5,
      goldenCaseCount: 6,
      perCaseRecalls: [1, 1, 1, 1, 1, 1],
      mixedProviderCorpus: true,
    });
    assert.equal(score.ready, false);
    assert.ok(score.issues.includes('mixed_provider_corpus'));
  });

  it('refuses ready when only aggregate metrics are supplied (no per-case proof)', () => {
    const score = scoreEmbeddingRoiReadiness({
      providerPinned: true,
      modelPinned: true,
      dimensionPinned: true,
      hybridEnabled: true,
      goldenRecall: 0.95,
      goldenPrecision: 0.15,
    });
    assert.equal(score.ready, false);
    assert.ok(score.issues.includes('golden_case_count_below_bar'));
    assert.ok(score.issues.includes('per_case_recall_missing'));
  });

  it('marks ready only with pins + aggregate bar + ≥6 cases at 100% per-case recall', () => {
    const score = scoreEmbeddingRoiReadiness({
      providerPinned: true,
      modelPinned: true,
      dimensionPinned: true,
      hybridEnabled: true,
      goldenRecall: 1,
      goldenPrecision: 0.2,
      goldenCaseCount: 6,
      perCaseRecalls: [1, 1, 1, 1, 1, 1],
    });
    assert.equal(score.ready, true);
    assert.equal(score.issues.length, 0);
  });
});

describe('lesson-embedding-index progressive Matryoshka', () => {
  it('progressive mode re-ranks survivors without mixing dimensions incorrectly', async () => {
    // Deterministic unit vectors in 4-d space (simulating MRL-compatible base).
    // Use 1024-d so progressive coarse (256) is strictly smaller than base.
    const dim = 1024;
    const mk = (onesAt) => {
      const v = new Array(dim).fill(0);
      for (const i of onesAt) v[i] = 1;
      // normalize-ish for cosine
      const n = Math.sqrt(onesAt.length) || 1;
      return v.map((x) => x / n);
    };
    const base = {
      a: mk([0]),
      b: mk([0, 1]),
      c: mk([50]),
    };
    const embedder = async (text) => {
      if (String(text).includes('query-about-a')) return base.a.slice();
      if (String(text).includes('lesson-a')) return base.a.slice();
      if (String(text).includes('lesson-b')) return base.b.slice();
      if (String(text).includes('lesson-c')) return base.c.slice();
      return mk([999]);
    };

    const lessons = [
      { id: 'a', title: 'lesson-a', content: 'lesson-a content' },
      { id: 'b', title: 'lesson-b', content: 'lesson-b content' },
      { id: 'c', title: 'lesson-c', content: 'lesson-c content' },
    ];

    const ranked = await semanticRank('query-about-a', lessons, {
      embedder,
      embedderId: 'test-embedder:1024',
      persist: false,
      progressiveMatryoshka: true,
      progressiveTopK: 2,
    });

    assert.ok(ranked.length >= 1);
    assert.equal(ranked[0].id, 'a');
    // Cosine of identical vectors is 1
    assert.ok(ranked[0].score > 0.99);
    assert.ok(cosineSimilarity(base.a, base.b) > cosineSimilarity(base.a, base.c));
  });

  it('rejects same-dimension vectors when provider fingerprints diverge', () => {
    // semanticRank re-resolves the document fingerprint after each embed and
    // feeds it here; same-dim fallback providers must fail closed.
    const mixed = assertCompatibleEmbeddings({
      queryProvider: 'gemini:models/gemini-embedding-2:4',
      queryDimension: 4,
      documentProvider: 'openai:text-embedding-3-small:4',
      documentDimension: 4,
    });
    assert.equal(mixed.ok, false);
    assert.ok(mixed.issues.some((i) => i.code === 'embedding_provider_mismatch'));
  });

  it('ranks with a stable injected embedder identity', async () => {
    const ranked = await semanticRank('query', [
      { id: 'x', title: 'doc', content: 'doc body' },
    ], {
      embedder: async () => [1, 0, 0, 0],
      embedderId: 'stable-test:4',
      persist: false,
    });
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].id, 'x');
    assert.ok(ranked[0].score > 0.99);
  });
});
