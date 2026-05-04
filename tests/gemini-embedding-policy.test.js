'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGeminiEmbeddingRolloutPlan,
  GEMINI_EMBEDDING_2_MODEL,
  MULTIMODAL_LIMITS,
  normalizeOutputDimensionality,
  prepareEmbeddingText,
  resolveGeminiEmbeddingConfig,
  resolveGeminiModelResource,
  resolveGeminiTaskType,
} = require('../scripts/gemini-embedding-policy');

describe('gemini-embedding-policy', () => {
  it('formats asymmetric retrieval prefixes for queries and documents', () => {
    assert.equal(
      prepareEmbeddingText({ kind: 'query', task: 'code retrieval', content: 'force push gate' }),
      'task: code retrieval | query: force push gate',
    );
    assert.equal(
      prepareEmbeddingText({ kind: 'document', task: 'code retrieval', title: 'git safety', content: 'Block force pushes to main.' }),
      'title: git safety | text: Block force pushes to main.',
    );
  });

  it('formats symmetric task prefixes for classification-like workloads', () => {
    assert.equal(
      prepareEmbeddingText({ kind: 'document', task: 'classification', content: 'billing failure' }),
      'task: classification | query: billing failure',
    );
  });

  it('rounds output dimensions to the recommended Matryoshka tiers', () => {
    assert.equal(normalizeOutputDimensionality(700), 768);
    assert.equal(normalizeOutputDimensionality(1600), 1536);
    assert.equal(normalizeOutputDimensionality(3000), 3072);
  });

  it('maps retrieval and symmetric workloads to Gemini API task types', () => {
    assert.equal(resolveGeminiTaskType({ kind: 'query', task: 'code retrieval' }), 'RETRIEVAL_QUERY');
    assert.equal(resolveGeminiTaskType({ kind: 'document', task: 'code retrieval' }), 'RETRIEVAL_DOCUMENT');
    assert.equal(resolveGeminiTaskType({ task: 'classification' }), 'CLASSIFICATION');
    assert.equal(resolveGeminiModelResource('gemini-embedding-2'), 'models/gemini-embedding-2');
    assert.equal(resolveGeminiModelResource('models/gemini-embedding-2'), 'models/gemini-embedding-2');
  });

  it('resolves an opt-in Gemini Embedding 2 config without requiring local model changes', () => {
    const config = resolveGeminiEmbeddingConfig({
      THUMBGATE_EMBED_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-key',
      THUMBGATE_EMBED_DIM: '1536',
    });

    assert.equal(config.enabled, true);
    assert.equal(config.provider, 'gemini');
    assert.equal(config.model, GEMINI_EMBEDDING_2_MODEL);
    assert.equal(config.outputDimensionality, 1536);
    assert.equal(config.fallbackToLocal, true);
  });

  it('builds a rollout plan with modality limits and batch economics', () => {
    const plan = buildGeminiEmbeddingRolloutPlan({
      corpusItems: 1200,
      outputDimensionality: 768,
      task: 'search result',
    });

    assert.equal(plan.model, GEMINI_EMBEDDING_2_MODEL);
    assert.equal(plan.modalityLimits.maxImages, MULTIMODAL_LIMITS.maxImages);
    assert.match(plan.taskPrefixes.query, /task: search result/);
    assert.match(plan.economics.batchApi, /50%/);
  });
});
