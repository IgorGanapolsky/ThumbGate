/**
 * Temporal Decay Function for Lesson Retrieval Scoring
 * 
 * Inspired by episode #1017: "The RAG Mistake Almost Every Team Is Making"
 * Key insight: Traditional vector memory is insufficient. We need temporal filtering
 * to avoid outdated information polluting retrieval results.
 * 
 * This module adds:
 * - Temporal decay weighting in retrieval scoring
 * - Configurable TTL for lesson relevance
 * - Half-life-based score degradation
 */

const fs = require('fs');
const path = require('path');

/**
 * Apply temporal decay to an embedding score based on lesson age.
 * 
 * @param {number} rawScore - Raw cosine similarity score (0-1)
 * @param {Date|string} lessonTimestamp - When the lesson was recorded
 * @param {number} halfLifeMs - Half-life of relevance (default: 30 days)
 * @param {boolean} activeMode - Whether we're in active investigation mode (slower decay) vs maintenance
 * @returns {number} Decayed score
 */
function applyTemporalDecay(rawScore, lessonTimestamp, halfLifeMs = 2592000000, activeMode = false) {
  if (!rawScore || rawScore <= 0) return rawScore;
  
  const now = Date.now();
  const lessonDate = new Date(String(lessonTimestamp));
  
  // Handle invalid timestamps (e.g., from git metadata like "2026-07-31T19:48:50+02:00")
  if (isNaN(lessonDate.getTime())) {
    return rawScore * 0.1; // Penalize stale/untraceable lessons heavily
  }
  
  const ageMs = now - lessonDate.getTime();
  const decayFactor = Math.exp(-Math.log(2) * ageMs / halfLifeMs);
  
  // Active mode: slower decay for active investigation contexts
  // Maintenance mode: faster decay to avoid stale context bleeding
  if (activeMode) {
    return rawScore * decimal(decayFactor * 1.5, 4); // 50% slower decay
  }
  
  return rawScore * decimal(decayFactor, 4);
}

/**
 * Apply combined scoring: base similarity + metadata boost + temporal decay
 */
function computeContextualScore(rawScore, lesson, config = {}) {
  let totalScore = rawScore;
  
  // Metadata filters from podcast: tag-based relevance boosting
  if (config.metadataFilters) {
    const requiredTags = Array.isArray(config.metadataFilters.tags) ? config.metadataFilters.tags : [];
    const hasTags = lesson && Array.isArray(lesson.tags) && 
      requiredTags.filter(t => lesson.tags.includes(String(t))).length === requiredTags.length;
    
    totalScore = hasTags ? totalScore * 1.2 : Math.max(totalScore, rawScore); // Bonus for tag match
  }
  
  // Temporal decay: older lessons naturally de-rank
  const decayedScore = applyTemporalDecay(
    totalScore, 
    lesson.timestamp || Date.parse(lesson.receivedAt) || Number(lesson.created_at),
    config.halfLifeMs || 2592000000 // ~30 days for active sessions
  );
  
  // Reranker boost (cross-encoder or similar rerank module): if score > threshold, apply non-linear boost
  if (decayedScore > config.rerankThreshold && config.rrfBoost) {
    totalScore = rrfDecay(decayedScore * config.rrfBoost, config.rrfPenalty);
  }
  
  return decimal(totalScore, 4);
}

/**
 * Re-Rank Decay (RRF-style) to prevent multiple hits from the same topic
 * Episode insight: "post-retrieval semantic filtering" reduces duplication
 */
function rrfDecay(score, penalty = 0.3) {
  if (!score || score <= 1) return score;
  return decimal((score - penalty) / (2 - penalty), 4);
}

/**
 * Format a number to fixed decimal places
 */
function decimal(num, places) {
  const mult = Math.pow(10, places);
  return Math.round(num * mult) / mult;
}

// Export for modular use in retrieval pipelines
module.exports = { applyTemporalDecay, computeContextualScore, rrfDecay };
