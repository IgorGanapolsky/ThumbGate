'use strict';

/**
 * Yambda Ranking & Retrieval Engine for Agent Memory & Policy Selection
 *
 * Adopted from Yandex Yambda-5B (Industrial-Scale Multi-Modal Dataset for Ranking):
 * 1. Dual explicit feedback with reversion states:
 *    - like / dislike
 *    - unlike / undislike (reverting previous votes)
 * 2. Organic vs recommendation-driven interaction weighting (`is_organic` flag):
 *    - Human operator feedback gets 1.5x boost over algorithmic agent-distilled memory.
 * 3. Implicit dwell / completion ratio (`played_ratio_pct` equivalent):
 *    - Tracks how much of an agent's code change or rule was retained (0-100%).
 * 4. Normalized contrastive vector dot-product scoring.
 */

class YambdaRankingEngine {
  constructor(options = {}) {
    this.organicBoost = options.organicBoost || 1.5;
    this.items = new Map();
    this.events = [];
  }

  /**
   * Registers a memory item, rule, or candidate solution.
   * @param {object} item
   */
  registerItem(item) {
    if (!item.id) throw new Error('Item must have an "id" property');
    const normalized = {
      id: item.id,
      title: item.title || item.id,
      content: item.content || '',
      category: item.category || 'general',
      normalized_embed: item.normalized_embed ? this._normalizeVector(item.normalized_embed) : null,
      registeredAt: Date.now(),
    };
    this.items.set(item.id, normalized);
    return normalized;
  }

  /**
   * Records an interaction event.
   * @param {object} evt
   *   - item_id: string
   *   - event_type: 'like' | 'dislike' | 'unlike' | 'undislike' | 'use'
   *   - is_organic: 0 | 1 (1 for human operator, 0 for automated agent loop)
   *   - completion_ratio_pct: number (1-100)
   */
  recordEvent(evt) {
    if (!this.items.has(evt.item_id)) {
      throw new Error(`Cannot record event for unregistered item "${evt.item_id}"`);
    }

    const event = {
      item_id: evt.item_id,
      event_type: evt.event_type || 'use',
      is_organic: evt.is_organic ? 1 : 0,
      completion_ratio_pct: typeof evt.completion_ratio_pct === 'number' ? Math.max(0, Math.min(100, evt.completion_ratio_pct)) : 100,
      timestamp: evt.timestamp || Math.floor(Date.now() / 5000), // 5-second binned time
    };

    this.events.push(event);
    return event;
  }

  /**
   * Computes item feedback state accounting for explicit reversions (unlike, undislike).
   * @param {string} itemId
   */
  computeItemFeedbackState(itemId) {
    const itemEvents = this.events.filter(e => e.item_id === itemId);

    let likes = 0;
    let dislikes = 0;
    let organicLikes = 0;
    let organicDislikes = 0;
    let totalUses = 0;
    let totalCompletionRatio = 0;

    for (const e of itemEvents) {
      const isOrg = e.is_organic === 1;

      switch (e.event_type) {
        case 'like':
          likes += 1;
          if (isOrg) organicLikes += 1;
          break;
        case 'unlike':
          // Reversion cancels prior like
          likes = Math.max(0, likes - 1);
          if (isOrg) organicLikes = Math.max(0, organicLikes - 1);
          break;
        case 'dislike':
          dislikes += 1;
          if (isOrg) organicDislikes += 1;
          break;
        case 'undislike':
          // Reversion cancels prior dislike
          dislikes = Math.max(0, dislikes - 1);
          if (isOrg) organicDislikes = Math.max(0, organicDislikes - 1);
          break;
        case 'use':
          totalUses += 1;
          totalCompletionRatio += e.completion_ratio_pct;
          break;
      }
    }

    const avgCompletionPct = totalUses > 0 ? (totalCompletionRatio / totalUses) : 100;
    const syntheticLikes = Math.max(0, likes - organicLikes);
    const syntheticDislikes = Math.max(0, dislikes - organicDislikes);

    // Weighted net feedback: organic votes get organicBoost multiplier
    const weightedPositive = (organicLikes * this.organicBoost) + syntheticLikes;
    const weightedNegative = (organicDislikes * this.organicBoost) + syntheticDislikes;
    const netFeedbackScore = weightedPositive - weightedNegative;

    return {
      itemId,
      likes,
      dislikes,
      netFeedbackScore,
      organicLikes,
      organicDislikes,
      totalUses,
      avgCompletionPct,
    };
  }

  /**
   * Ranks items given a target query embedding and context.
   * @param {number[]} queryVector
   * @param {object} filter
   */
  rankItems(queryVector = null, filter = {}) {
    const normalizedQuery = queryVector ? this._normalizeVector(queryVector) : null;
    const scored = [];

    for (const [id, item] of this.items.entries()) {
      if (filter.category && item.category !== filter.category) continue;

      const feedback = this.computeItemFeedbackState(id);

      // Compute vector similarity if vectors present
      let similarity = 0.5;
      if (normalizedQuery && item.normalized_embed) {
        similarity = this._dotProduct(normalizedQuery, item.normalized_embed);
      }

      // Implicit completion penalty: items with low retention ratio get penalized
      const completionFactor = feedback.avgCompletionPct / 100;

      // Combined ranking score: Similarity (50%) + Net Feedback (30%) + Completion (20%)
      const feedbackComponent = Math.tanh(feedback.netFeedbackScore * 0.5); // bounded -1 to 1
      const totalScore = (similarity * 0.5) + (feedbackComponent * 0.3) + (completionFactor * 0.2);

      scored.push({
        id,
        title: item.title,
        category: item.category,
        totalScore: Number(totalScore.toFixed(4)),
        similarity: Number(similarity.toFixed(4)),
        feedback,
      });
    }

    return scored.sort((a, b) => b.totalScore - a.totalScore);
  }

  _normalizeVector(vec) {
    if (!Array.isArray(vec) || vec.length === 0) return null;
    const mag = Math.sqrt(vec.reduce((sum, val) => sum + (val * val), 0));
    if (mag === 0) return vec.map(() => 0);
    return vec.map(val => val / mag);
  }

  _dotProduct(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }
}

module.exports = {
  YambdaRankingEngine,
};
