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

const DEFAULT_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Apply temporal decay to an embedding score based on lesson age.
 * 
 * @param {number} rawScore - Raw cosine similarity score (0-1)
 * @param {Date|string} lessonTimestamp - When the lesson was recorded
 * @param {number} halfLifeMs - Half-life of relevance (default: 30 days)
 * @param {boolean} activeMode - Whether we're in active investigation mode (slower decay) vs maintenance
 * @returns {number} Decayed score
 */
function applyTemporalDecay(rawScore, lessonTimestamp, halfLifeMs = DEFAULT_HALF_LIFE_MS, activeMode = false) {
  if (!rawScore || rawScore <= 0) return rawScore;

  if (!Number.isFinite(halfLifeMs) || halfLifeMs <= 0) {
    throw new TypeError('halfLifeMs must be a positive finite number');
  }

  const lessonDate = new Date(String(lessonTimestamp));

  // Handle invalid timestamps (e.g., from git metadata like "2026-07-31T19:48:50+02:00")
  if (isNaN(lessonDate.getTime())) {
    return rawScore * 0.1; // Penalize stale/untraceable lessons heavily
  }
  
  const ageMs = Math.max(0, Date.now() - lessonDate.getTime());
  const effectiveHalfLifeMs = activeMode ? halfLifeMs * 1.5 : halfLifeMs;
  const decayFactor = Math.exp(-Math.log(2) * ageMs / effectiveHalfLifeMs);

  return rawScore * decimal(decayFactor, 4);
}

/**
 * Apply combined scoring: base similarity + metadata boost + temporal decay
 */
function computeContextualScore(rawScore, lesson, config = {}) {
  let totalScore = rawScore;

  const safeLesson = lesson || {};

  // Metadata filters from podcast: tag-based relevance boosting
  if (config.metadataFilters) {
    const requiredTags = Array.isArray(config.metadataFilters.tags) ? config.metadataFilters.tags : [];
    const hasTags = Array.isArray(safeLesson.tags) &&
      requiredTags.every(tag => safeLesson.tags.includes(String(tag)));

    totalScore = hasTags ? totalScore * 1.2 : Math.max(totalScore, rawScore); // Bonus for tag match
  }
  
  // Temporal decay: older lessons naturally de-rank
  totalScore = applyTemporalDecay(
    totalScore, 
    safeLesson.timestamp || Date.parse(safeLesson.receivedAt) || Number(safeLesson.created_at),
    config.halfLifeMs || DEFAULT_HALF_LIFE_MS,
    Boolean(config.activeMode)
  );

  // Reranker boost (cross-encoder or similar rerank module): if score > threshold, apply non-linear boost
  if (totalScore > config.rerankThreshold && config.rrfBoost) {
    totalScore = rrfDecay(totalScore * config.rrfBoost, config.rrfPenalty);
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
module.exports = { DEFAULT_HALF_LIFE_MS, applyTemporalDecay, computeContextualScore, rrfDecay };
