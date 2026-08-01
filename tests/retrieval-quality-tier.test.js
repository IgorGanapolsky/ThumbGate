'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  assessRetrievalQualityTier,
  probeEmbeddingQuality,
  DEFAULT_MAX_INDEX_AGE_MS,
} = require('../scripts/retrieval-quality-tier');

describe('retrieval-quality-tier', () => {
  it('marks feature-hash profiles as degraded and blocks semantic claims', () => {
    const result = assessRetrievalQualityTier({
      embedderAvailable: true,
      embeddingProfile: {
        source: 'built-in',
        activeProfile: { id: 'feature-hash-v1', qualityTier: 'degraded' },
      },
    });
    assert.equal(result.qualityTier, 'degraded');
    assert.equal(result.semanticClaimsAllowed, false);
    assert.ok(result.degradedReasons.includes('embedding_tier_degraded'));
  });

  it('marks missing embedder as unavailable', () => {
    const result = assessRetrievalQualityTier({ embedderAvailable: false });
    assert.equal(result.qualityTier, 'unavailable');
    assert.equal(result.semanticClaimsAllowed, false);
    assert.ok(result.degradedReasons.includes('embedder_unavailable'));
  });

  it('allows production claims for production-tier profiles with fresh index', () => {
    const now = Date.now();
    const result = assessRetrievalQualityTier({
      embedderAvailable: true,
      embeddingProfile: {
        source: 'local-ollama',
        activeProfile: { id: 'ollama', qualityTier: 'production' },
      },
      indexUpdatedAtMs: now - 60_000,
      nowMs: now,
      maxIndexAgeMs: DEFAULT_MAX_INDEX_AGE_MS,
    });
    assert.equal(result.qualityTier, 'production');
    assert.equal(result.semanticClaimsAllowed, true);
    assert.equal(result.degradedReasons.length, 0);
  });

  it('degrades when the dense index is stale', () => {
    const now = Date.now();
    const result = assessRetrievalQualityTier({
      embedderAvailable: true,
      embeddingProfile: {
        activeProfile: { id: 'gemini', qualityTier: 'production' },
      },
      indexUpdatedAtMs: now - (DEFAULT_MAX_INDEX_AGE_MS + 1),
      nowMs: now,
    });
    assert.equal(result.qualityTier, 'degraded');
    assert.ok(result.degradedReasons.includes('index_stale'));
  });

  it('probeEmbeddingQuality returns a well-formed tier object', () => {
    const result = probeEmbeddingQuality();
    assert.ok(['production', 'degraded', 'unavailable'].includes(result.qualityTier));
    assert.equal(typeof result.semanticClaimsAllowed, 'boolean');
    assert.ok(Array.isArray(result.degradedReasons));
  });
});
