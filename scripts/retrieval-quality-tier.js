'use strict';

/**
 * Retrieval quality tier — surface degraded/stale semantic paths honestly.
 *
 * When embeddings are feature-hash, missing, or the lesson index is older than
 * the freshness window, callers must not claim production semantic quality.
 */

const DEFAULT_MAX_INDEX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * @param {object} [input]
 * @param {object|null} [input.embeddingProfile] — from vector-store getLastEmbeddingProfile()
 * @param {boolean} [input.embedderAvailable]
 * @param {number|null} [input.indexUpdatedAtMs]
 * @param {number} [input.nowMs]
 * @param {number} [input.maxIndexAgeMs]
 * @returns {{
 *   qualityTier: 'production'|'degraded'|'unavailable',
 *   semanticClaimsAllowed: boolean,
 *   degradedReasons: string[],
 *   indexAgeMs: number|null,
 * }}
 */
function assessRetrievalQualityTier(input = {}) {
  const now = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const maxAge = Number.isFinite(input.maxIndexAgeMs)
    ? input.maxIndexAgeMs
    : Number(process.env.THUMBGATE_MAX_INDEX_AGE_MS) || DEFAULT_MAX_INDEX_AGE_MS;

  const reasons = [];
  const profile = input.embeddingProfile || null;
  const profileId = String(profile?.activeProfile?.id || profile?.id || profile?.source || '');
  const profileTier = String(profile?.activeProfile?.qualityTier || profile?.qualityTier || '');

  let qualityTier = 'production';

  if (input.embedderAvailable === false) {
    qualityTier = 'unavailable';
    reasons.push('embedder_unavailable');
  } else if (/feature-hash|built-in|stub/i.test(profileId) || /degraded|test_stub/i.test(profileTier)) {
    qualityTier = 'degraded';
    reasons.push('embedding_tier_degraded');
  } else if (profileTier && /production/i.test(profileTier) === false && profileTier !== '') {
    qualityTier = 'degraded';
    reasons.push(`embedding_quality_tier:${profileTier}`);
  }

  let indexAgeMs = null;
  if (Number.isFinite(input.indexUpdatedAtMs)) {
    indexAgeMs = Math.max(0, now - Number(input.indexUpdatedAtMs));
    if (indexAgeMs > maxAge) {
      if (qualityTier === 'production') qualityTier = 'degraded';
      reasons.push('index_stale');
    }
  }

  if (process.env.THUMBGATE_VECTOR_STUB_EMBED === 'true') {
    qualityTier = 'degraded';
    if (!reasons.includes('embedding_tier_degraded')) reasons.push('vector_stub_embed');
  }

  return {
    qualityTier,
    semanticClaimsAllowed: qualityTier === 'production',
    degradedReasons: reasons,
    indexAgeMs,
    maxIndexAgeMs: maxAge,
  };
}

/**
 * Probe live embedding profile when vector-store is available.
 */
function probeEmbeddingQuality(options = {}) {
  try {
    const vectorStore = require('./vector-store');
    const profile = typeof vectorStore.getLastEmbeddingProfile === 'function'
      ? vectorStore.getLastEmbeddingProfile()
      : null;
    let embedderAvailable = true;
    try {
      const idx = require('./lesson-embedding-index');
      if (typeof idx.isEmbedderAvailable === 'function') {
        embedderAvailable = idx.isEmbedderAvailable();
      }
    } catch {
      embedderAvailable = false;
    }
    return assessRetrievalQualityTier({
      embeddingProfile: profile,
      embedderAvailable,
      indexUpdatedAtMs: options.indexUpdatedAtMs ?? null,
      nowMs: options.nowMs,
      maxIndexAgeMs: options.maxIndexAgeMs,
    });
  } catch {
    return assessRetrievalQualityTier({
      embedderAvailable: false,
      indexUpdatedAtMs: options.indexUpdatedAtMs ?? null,
      nowMs: options.nowMs,
      maxIndexAgeMs: options.maxIndexAgeMs,
    });
  }
}

module.exports = {
  DEFAULT_MAX_INDEX_AGE_MS,
  assessRetrievalQualityTier,
  probeEmbeddingQuality,
};
