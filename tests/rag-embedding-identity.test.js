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
      mixedProviderCorpus: true,
    });
    assert.equal(score.ready, false);
    assert.ok(score.issues.includes('mixed_provider_corpus'));
  });
});

describe('lesson-embedding-index progressive Matryoshka', () => {
  it('progressive mode re-ranks survivors without mixing dimensions incorrectly', async () => {
    // Deterministic unit vectors in 4-d space (simulating MRL-compatible base).
    const base = {
      a: [1, 0, 0, 0],
      b: [0.9, 0.1, 0, 0],
      c: [0, 1, 0, 0],
    };
    const embedder = async (text) => {
      if (String(text).includes('query-about-a')) return base.a.slice();
      if (String(text).includes('lesson-a')) return base.a.slice();
      if (String(text).includes('lesson-b')) return base.b.slice();
      if (String(text).includes('lesson-c')) return base.c.slice();
      return [0, 0, 0, 1];
    };

    const lessons = [
      { id: 'a', title: 'lesson-a', content: 'lesson-a content' },
      { id: 'b', title: 'lesson-b', content: 'lesson-b content' },
      { id: 'c', title: 'lesson-c', content: 'lesson-c content' },
    ];

    const ranked = await semanticRank('query-about-a', lessons, {
      embedder,
      embedderId: 'test-embedder:4',
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
});
