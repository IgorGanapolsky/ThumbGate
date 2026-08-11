'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  PYRAMID_LAYERS,
  MATRYOSHKA_DIMENSIONS,
  EMBEDDING_QUALITY_THRESHOLDS,
  buildMatryoshkaConfig,
  classifyMemoryLayer,
  distillMemoryForEmbedding,
  generateEmbeddingPreventionRules,
  getSemanticScore,
  normalizeToMatryoshkaDimension,
  validateEmbeddingQuality,
  buildEmbeddingTaskPrefix,
} = require('../scripts/matryoshka-embedding');

describe('matryoshka-embedding - Hierarchical Memory Embeddings for RAG', () => {
  describe('dimension normalization', () => {
    it('normalizes requested dimensions to Matryoshka tiers', () => {
      assert.equal(normalizeToMatryoshkaDimension(700), 768);
      assert.equal(normalizeToMatryoshkaDimension(1600), 1536);
      assert.equal(normalizeToMatryoshkaDimension(3000), 3072);
      assert.equal(normalizeToMatryoshkaDimension(500), 512);
      assert.equal(normalizeToMatryoshkaDimension(4000), 4096);
    });
    it('handles invalid dimensions gracefully', () => {
      assert.equal(normalizeToMatryoshkaDimension(0), 768);
      assert.equal(normalizeToMatryoshkaDimension(-100), 768);
    });
    it('accepts dimensions that are already Matryoshka tiers', () => {
      for (const dim of MATRYOSHKA_DIMENSIONS) {
        assert.equal(normalizeToMatryoshkaDimension(dim), dim);
      }
    });
  });

  describe('semantic scoring', () => {
    it('calculates semantic score based on dimension tier', () => {
      assert.ok(getSemanticScore(256) < getSemanticScore(512));
      assert.ok(getSemanticScore(768) > getSemanticScore(512));
      assert.ok(getSemanticScore(4096) > getSemanticScore(1536));
    });
  });

  describe('memory layer classification', () => {
    it('classifies SOP/policy memories as L3_PERSONA_SOP', () => {
      const result = classifyMemoryLayer({
        type: 'preference',
        tags: ['sop', 'rule'],
        content: 'Always require human review',
      });
      assert.equal(result, PYRAMID_LAYERS.L3_PERSONA_SOP);
    });
    it('classifies workflows as L2_SCENARIO', () => {
      const result = classifyMemoryLayer({
        type: 'procedural',
        tags: ['workflow'],
        content: 'Multi-step deployment',
      });
      assert.equal(result, PYRAMID_LAYERS.L2_SCENARIO);
    });
    it('classifies semantic lessons as L1_ATOM', () => {
      const result = classifyMemoryLayer({
        type: 'semantic',
        tags: ['fact', 'lesson'],
        whatWentWrong: 'Issue description',
        whatWorked: 'Fix',
      });
      assert.equal(result, PYRAMID_LAYERS.L1_ATOM);
    });
    it('classifies raw conversations as L0_CONVERSATION', () => {
      const result = classifyMemoryLayer({
        type: 'working',
        content: 'Raw transcript line',
      });
      assert.equal(result, PYRAMID_LAYERS.L0_CONVERSATION);
    });
  });

  describe('embedding quality validation', () => {
    it('validates recall meets threshold', () => {
      const result = validateEmbeddingQuality({ recall: 0.96 });
      assert.equal(result.valid, true);
      const resultLow = validateEmbeddingQuality({ recall: 0.80 });
      assert.equal(resultLow.valid, false);
    });
    it('validates precision meets threshold', () => {
      const result = validateEmbeddingQuality({ precision: 0.20 });
      assert.equal(result.valid, true);
    });
    it('returns dimension tier and semantic score', () => {
      const result = validateEmbeddingQuality({ embeddingDim: 1600 });
      assert.equal(result.dimensionTier, 1536);
    });
  });

  describe('Matryoshka configuration', () => {
    it('builds configuration with dimension tiers', () => {
      const config = buildMatryoshkaConfig({ embeddingDim: 1536 });
      assert.equal(config.baseDimension, 1536);
      assert.ok(config.tiers.length > 0);
    });
    it('includes rollout plan', () => {
      const config = buildMatryoshkaConfig();
      assert.ok(Array.isArray(config.rolloutPlan));
    });
  });

  describe('prevention rules generation', () => {
    it('generates rules for quality violations', () => {
      const report = { valid: false, issues: [{ issue: 'recall_below_threshold' }], recallThreshold: 0.95, minDimension: 256 };
      const rules = generateEmbeddingPreventionRules(report);
      assert.ok(Array.isArray(rules));
      const recallRule = rules.find(r => r.id === 'block-low-embedding-recall');
      assert.ok(recallRule);
      assert.equal(recallRule.category, 'Embedding Quality');
    });
    it('returns empty rules for valid reports', () => {
      const rules = generateEmbeddingPreventionRules({ valid: true });
      assert.equal(rules.length, 0);
    });
  });

  describe('task prefix building', () => {
    it('builds structured embedding task prefixes', () => {
      const prefix = buildEmbeddingTaskPrefix(PYRAMID_LAYERS.L3_PERSONA_SOP, 'code retrieval');
      assert.ok(prefix.includes('layer:L3_PERSONA_SOP'));
      assert.ok(prefix.includes('weight:4'));
    });
    it('applies correct weights to each layer', () => {
      const l3Prefix = buildEmbeddingTaskPrefix(PYRAMID_LAYERS.L3_PERSONA_SOP);
      const l2Prefix = buildEmbeddingTaskPrefix(PYRAMID_LAYERS.L2_SCENARIO);
      const l1Prefix = buildEmbeddingTaskPrefix(PYRAMID_LAYERS.L1_ATOM);
      const l0Prefix = buildEmbeddingTaskPrefix(PYRAMID_LAYERS.L0_CONVERSATION);
      assert.ok(l3Prefix.includes('weight:4'));
      assert.ok(l2Prefix.includes('weight:3'));
      assert.ok(l1Prefix.includes('weight:2'));
      assert.ok(l0Prefix.includes('weight:1'));
    });
  });
});
