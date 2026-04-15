#!/usr/bin/env node
'use strict';

/**
 * Session Episode Store — episodic memory for agent sessions.
 *
 * Persists session health snapshots across conversations so the system
 * learns cross-session degradation patterns:
 *   - Which times of day produce degraded sessions
 *   - Which task categories trigger repeat errors
 *   - How long sessions last before degradation onset
 *   - Whether feedback is actually reducing repeat mistakes over time
 *
 * This is the "episodic experience" layer described in the harnessed-agent
 * framework (Memory = working context + semantic knowledge + episodic experience).
 * The session-health-sensor provides the real-time signal; this module provides
 * the longitudinal learning.
 */

const path = require('node:path');
const { readJsonl, appendJsonl } = require('./fs-utils');
const { resolveFeedbackDir } = require('./feedback-paths');
const {
  computeSessionHealth,
  loadRecentFeedback,
} = require('./session-health-sensor');

const EPISODE_FILE = 'session-episodes.jsonl';
const PATTERN_WINDOW_EPISODES = 20;

// ---------------------------------------------------------------------------
// Episode Recording
// ---------------------------------------------------------------------------

function getEpisodePath({ feedbackDir } = {}) {
  const dir = feedbackDir || resolveFeedbackDir();
  return path.join(dir, EPISODE_FILE);
}

function buildEpisode({
  sessionId = null,
  health = null,
  feedbackEntries = [],
  tags = [],
  durationMs = null,
} = {}) {
  const now = new Date();
  const effectiveHealth = health || computeSessionHealth(feedbackEntries);

  const negativeEntries = feedbackEntries.filter((e) => e.signal === 'negative');
  const categories = extractCategories(feedbackEntries);
  const errorFingerprints = extractErrorFingerprints(negativeEntries);

  return {
    sessionId: sessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    recordedAt: now.toISOString(),
    hourOfDay: now.getHours(),
    dayOfWeek: now.getDay(),
    score: effectiveHealth.score,
    grade: effectiveHealth.grade,
    signals: effectiveHealth.signals.map((s) => ({ signal: s.signal, severity: s.severity })),
    recommendation: effectiveHealth.recommendation,
    feedbackCount: feedbackEntries.length,
    negativeCount: negativeEntries.length,
    positiveCount: feedbackEntries.filter((e) => e.signal === 'positive').length,
    categories,
    errorFingerprints,
    durationMs,
    tags,
  };
}

function recordEpisode(episode, options = {}) {
  const episodePath = getEpisodePath(options);
  appendJsonl(episodePath, episode);
  return episode;
}

function captureAndRecordEpisode(options = {}) {
  const feedbackEntries = loadRecentFeedback(options);
  const episode = buildEpisode({
    sessionId: options.sessionId,
    feedbackEntries,
    tags: options.tags || [],
    durationMs: options.durationMs,
  });
  return recordEpisode(episode, options);
}

// ---------------------------------------------------------------------------
// Episode Loading
// ---------------------------------------------------------------------------

function loadEpisodes(options = {}) {
  return readJsonl(getEpisodePath(options));
}

function loadRecentEpisodes(count = PATTERN_WINDOW_EPISODES, options = {}) {
  return readJsonl(getEpisodePath(options), { tail: true, maxLines: count });
}

// ---------------------------------------------------------------------------
// Cross-Session Pattern Detection
// ---------------------------------------------------------------------------

function analyzeTimeOfDayPatterns(episodes) {
  const byHour = new Map();
  for (const ep of episodes) {
    const hour = ep.hourOfDay;
    if (hour === undefined || hour === null) continue;
    const bucket = byHour.get(hour) || { total: 0, degraded: 0, critical: 0, totalScore: 0 };
    bucket.total += 1;
    bucket.totalScore += ep.score || 0;
    if (ep.grade === 'degraded') bucket.degraded += 1;
    if (ep.grade === 'critical') bucket.critical += 1;
    byHour.set(hour, bucket);
  }

  const patterns = [];
  for (const [hour, bucket] of byHour) {
    if (bucket.total < 2) continue;
    const failRate = (bucket.degraded + bucket.critical) / bucket.total;
    const avgScore = Math.round(bucket.totalScore / bucket.total);
    if (failRate > 0.5) {
      patterns.push({
        type: 'time_of_day_risk',
        hour,
        failRate: Math.round(failRate * 100),
        avgScore,
        sessions: bucket.total,
        recommendation: `Sessions at ${formatHour(hour)} degrade ${Math.round(failRate * 100)}% of the time. Consider scheduling complex work at other hours.`,
      });
    }
  }

  return patterns.sort((a, b) => b.failRate - a.failRate);
}

function analyzeCategoryPatterns(episodes) {
  const byCategory = new Map();
  for (const ep of episodes) {
    for (const cat of ep.categories || []) {
      const bucket = byCategory.get(cat) || { total: 0, degraded: 0, totalScore: 0 };
      bucket.total += 1;
      bucket.totalScore += ep.score || 0;
      if (ep.grade === 'degraded' || ep.grade === 'critical') bucket.degraded += 1;
      byCategory.set(cat, bucket);
    }
  }

  const patterns = [];
  for (const [category, bucket] of byCategory) {
    if (bucket.total < 2) continue;
    const failRate = bucket.degraded / bucket.total;
    const avgScore = Math.round(bucket.totalScore / bucket.total);
    if (failRate > 0.4) {
      patterns.push({
        type: 'category_risk',
        category,
        failRate: Math.round(failRate * 100),
        avgScore,
        sessions: bucket.total,
        recommendation: `"${category}" tasks degrade ${Math.round(failRate * 100)}% of sessions. Break these into smaller chunks or add prevention rules.`,
      });
    }
  }

  return patterns.sort((a, b) => b.failRate - a.failRate);
}

function analyzeRecurringErrors(episodes) {
  const fingerprints = new Map();
  for (const ep of episodes) {
    for (const fp of ep.errorFingerprints || []) {
      const count = (fingerprints.get(fp) || 0) + 1;
      fingerprints.set(fp, count);
    }
  }

  const patterns = [];
  for (const [fingerprint, count] of fingerprints) {
    if (count < 2) continue;
    patterns.push({
      type: 'recurring_error',
      fingerprint,
      occurrences: count,
      recommendation: `Error "${fingerprint.slice(0, 80)}" has recurred across ${count} sessions. Promote to a prevention rule.`,
    });
  }

  return patterns.sort((a, b) => b.occurrences - a.occurrences);
}

function analyzeFeedbackEffectiveness(episodes) {
  if (episodes.length < 3) return null;

  const recentHalf = episodes.slice(Math.floor(episodes.length / 2));
  const olderHalf = episodes.slice(0, Math.floor(episodes.length / 2));

  const avgRecent = average(recentHalf.map((e) => e.score || 0));
  const avgOlder = average(olderHalf.map((e) => e.score || 0));
  const recentRepeatRate = average(recentHalf.map((e) => (e.errorFingerprints || []).length));
  const olderRepeatRate = average(olderHalf.map((e) => (e.errorFingerprints || []).length));

  const scoreTrend = avgRecent - avgOlder;
  const repeatTrend = recentRepeatRate - olderRepeatRate;

  return {
    type: 'feedback_effectiveness',
    olderAvgScore: Math.round(avgOlder),
    recentAvgScore: Math.round(avgRecent),
    scoreTrend: Math.round(scoreTrend),
    olderRepeatRate: round2(olderRepeatRate),
    recentRepeatRate: round2(recentRepeatRate),
    repeatTrend: round2(repeatTrend),
    improving: scoreTrend > 0 && repeatTrend <= 0,
    recommendation: scoreTrend > 0
      ? `Session health is improving (${Math.round(avgOlder)} → ${Math.round(avgRecent)}). Feedback loop is working.`
      : `Session health is declining (${Math.round(avgOlder)} → ${Math.round(avgRecent)}). Review prevention rules and consider a fresh context reset.`,
  };
}

function analyzePatterns(episodes) {
  const timePatterns = analyzeTimeOfDayPatterns(episodes);
  const categoryPatterns = analyzeCategoryPatterns(episodes);
  const recurringErrors = analyzeRecurringErrors(episodes);
  const effectiveness = analyzeFeedbackEffectiveness(episodes);

  return {
    timeOfDay: timePatterns,
    categories: categoryPatterns,
    recurringErrors,
    effectiveness,
    episodesAnalyzed: episodes.length,
    analyzedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractCategories(entries) {
  const cats = new Set();
  for (const entry of entries) {
    if (Array.isArray(entry.tags)) {
      for (const tag of entry.tags) cats.add(tag);
    }
    if (entry.richContext && entry.richContext.domain) {
      cats.add(entry.richContext.domain);
    }
  }
  return Array.from(cats).slice(0, 20);
}

function extractErrorFingerprints(negativeEntries) {
  const fps = new Set();
  for (const entry of negativeEntries) {
    if (!entry.whatWentWrong) continue;
    const fp = entry.whatWentWrong
      .toLowerCase()
      .replace(/\b(line|col|column)\s*\d+/g, '')
      .replace(/\b\d+\b/g, 'N')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    if (fp) fps.add(fp);
  }
  return Array.from(fps).slice(0, 20);
}

function formatHour(hour) {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${h}${ampm}`;
}

function average(nums) {
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  return invokedPath ? path.resolve(invokedPath) === __filename : false;
}

if (isCliInvocation()) {
  const command = process.argv[2] || 'capture';

  if (command === 'capture') {
    const episode = captureAndRecordEpisode();
    console.log(JSON.stringify(episode, null, 2));
  } else if (command === 'patterns') {
    const episodes = loadEpisodes();
    const patterns = analyzePatterns(episodes);
    console.log(JSON.stringify(patterns, null, 2));
  } else if (command === 'history') {
    const episodes = loadRecentEpisodes(20);
    console.log(JSON.stringify(episodes, null, 2));
  } else {
    console.error(`Unknown command: ${command}. Use: capture, patterns, history`);
    process.exit(1);
  }
}

module.exports = {
  EPISODE_FILE,
  PATTERN_WINDOW_EPISODES,
  analyzePatterns,
  analyzeCategoryPatterns,
  analyzeFeedbackEffectiveness,
  analyzeRecurringErrors,
  analyzeTimeOfDayPatterns,
  buildEpisode,
  captureAndRecordEpisode,
  getEpisodePath,
  loadEpisodes,
  loadRecentEpisodes,
  recordEpisode,
};
