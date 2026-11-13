/**
 * YAMBDA-Inspired Recommendation, Retrieval & Interaction Engine.
 * 
 * Inspired by Yandex Yambda-5B (Industrial-Scale Multi-Modal Retrieval):
 * - Distinguishes organic interactions (manual user search) from recommendation-driven (agent-injected).
 * - Models explicit feedback reversals (unlike, undislike) with calibrated entropy updates.
 * - Tracks consumption dwell ratio (retained code/rule %) including replay (>100% for heavy re-use).
 * - Normalized dense vector similarity fused with behavioral feedback.
 */

'use strict';

const INTERACTION_TYPES = {
  CONSUME: 'consume',
  UPVOTE: 'upvote',
  DOWNVOTE: 'downvote',
  REVERT_UPVOTE: 'revert_upvote',
  REVERT_DOWNVOTE: 'revert_downvote',
};

class YambdaRetrievalEngine {
  constructor(options = {}) {
    this.items = new Map(); // itemId -> { id, metadata, embedding, organicScore, algoScore, totalInteractions }
    this.interactionLog = [];
  }

  registerItem(itemId, metadata = {}, embedding = null) {
    let normalized = null;
    if (embedding && Array.isArray(embedding)) {
      normalized = this._normalizeVector(embedding);
    }

    this.items.set(itemId, {
      id: itemId,
      metadata,
      embedding: normalized,
      positiveCount: 0,
      negativeCount: 0,
      organicCount: 0,
      algoCount: 0,
      replayCount: 0, // times dwell_ratio > 100%
      dwellRatios: [],
    });

    return this.items.get(itemId);
  }

  recordInteraction(event) {
    const {
      actorId = 'anonymous',
      itemId,
      eventType = INTERACTION_TYPES.CONSUME,
      isOrganic = false,
      dwellRatioPct = 100, // % of rule/code applied; >100% indicates repeated reuse
      timestamp = Date.now(),
    } = event;

    const item = this.items.get(itemId);
    if (!item) {
      throw new Error(`Item not registered: ${itemId}`);
    }

    const record = {
      actorId,
      itemId,
      eventType,
      isOrganic: Boolean(isOrganic),
      dwellRatioPct,
      timestamp,
    };
    this.interactionLog.push(record);

    // Update item statistics based on YAMBDA behavioral dynamics
    item.dwellRatios.push(dwellRatioPct);
    if (dwellRatioPct > 100) {
      item.replayCount += 1;
    }

    if (isOrganic) {
      item.organicCount += 1;
    } else {
      item.algoCount += 1;
    }

    switch (eventType) {
      case INTERACTION_TYPES.UPVOTE:
        item.positiveCount += isOrganic ? 1.3 : 1.0;
        break;
      case INTERACTION_TYPES.DOWNVOTE:
        item.negativeCount += isOrganic ? 1.5 : 1.0;
        break;
      case INTERACTION_TYPES.REVERT_UPVOTE:
        // Reversal carries 2x entropy penalty
        item.positiveCount = Math.max(0, item.positiveCount - 1.0);
        item.negativeCount += 1.0;
        break;
      case INTERACTION_TYPES.REVERT_DOWNVOTE:
        // Undislike carries forgiveness recovery
        item.negativeCount = Math.max(0, item.negativeCount - 1.0);
        item.positiveCount += 0.5;
        break;
      case INTERACTION_TYPES.CONSUME:
        // Consume with high dwell ratio adds fractional positive signal
        if (dwellRatioPct >= 80) item.positiveCount += 0.2;
        if (dwellRatioPct < 20) item.negativeCount += 0.2;
        break;
    }

    return record;
  }

  scoreItem(itemId) {
    const item = this.items.get(itemId);
    if (!item) return 0;

    const pos = item.positiveCount + 1.0; // Laplace smoothing
    const neg = item.negativeCount + 1.0;
    const baseAffinity = pos / (pos + neg);

    // Organic boost: items discovered and chosen organically have higher trust
    const organicRatio = (item.organicCount + 1.0) / (item.organicCount + item.algoCount + 2.0);
    const organicMultiplier = 1.0 + (organicRatio * 0.2);

    // Replay boost (>100% dwell indicates golden pattern repeatedly reused)
    const replayBonus = Math.min(0.25, item.replayCount * 0.05);

    return Math.min(1.0, (baseAffinity * organicMultiplier) + replayBonus);
  }

  rankItemsForContext(queryEmbedding = null, options = {}) {
    const minScore = options.minScore || 0.0;
    const limit = options.limit || 10;
    const ranked = [];

    let normQuery = null;
    if (queryEmbedding && Array.isArray(queryEmbedding)) {
      normQuery = this._normalizeVector(queryEmbedding);
    }

    for (const [itemId, item] of this.items.entries()) {
      const behavioralScore = this.scoreItem(itemId);
      let contentSimilarity = 0.5;

      if (normQuery && item.embedding) {
        contentSimilarity = (this._cosineSimilarity(normQuery, item.embedding) + 1.0) / 2.0;
      }

      // Hybrid rank: 50% behavioral affinity (interactions/reversals) + 50% dense vector similarity
      const finalScore = Math.round(((behavioralScore * 0.5) + (contentSimilarity * 0.5)) * 1000) / 1000;

      if (finalScore >= minScore) {
        ranked.push({
          itemId,
          metadata: item.metadata,
          score: finalScore,
          behavioralScore: Math.round(behavioralScore * 1000) / 1000,
          contentSimilarity: Math.round(contentSimilarity * 1000) / 1000,
          replayCount: item.replayCount,
          organicCount: item.organicCount,
        });
      }
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, limit);
  }

  _normalizeVector(vec) {
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm === 0) return vec.slice();
    return vec.map((v) => v / norm);
  }

  _cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return dot;
  }
}

module.exports = {
  YambdaRetrievalEngine,
  INTERACTION_TYPES,
};
