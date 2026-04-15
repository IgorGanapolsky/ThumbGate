#!/usr/bin/env node
'use strict';

/**
 * Session Health Sensor
 *
 * Detects real-time agent session degradation by analyzing feedback patterns,
 * error recurrence, and context drift signals. Inspired by community research
 * showing that "context rot" — not model quality — is the primary cause of
 * perceived AI agent degradation on large projects.
 *
 * Signals tracked:
 *   1. Repeat error rate — same error recurring within a session window
 *   2. Negative feedback density — ratio of thumbs-down in recent window
 *   3. Stagnation — consecutive negative signals without recovery
 *   4. Context amnesia — feedback referencing "forgot", "again", "already told"
 *
 * Output: A session health score (0–100) and actionable degradation signals.
 *
 * Integration points:
 *   - Thompson Sampling: feeds per-category reliability with session context
 *   - Gates engine: health score can trigger "restart session" recommendation
 *   - Self-heal: low health triggers diagnostic capture
 */

const path = require('node:path');
const { readJsonl } = require('./fs-utils');
const { resolveFeedbackDir } = require('./feedback-paths');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_WINDOW_MS = 45 * 60 * 1000; // 45 minutes — aligned with community best practice
const AMNESIA_PATTERNS = /\b(again|forgot|already told|repeated|same mistake|same error|keeps? (doing|making|breaking)|context (lost|drift|rot)|amnesia)\b/i;
const STAGNATION_THRESHOLD = 4; // consecutive negatives without a positive
const HEALTH_FLOOR = 0;
const HEALTH_CEILING = 100;

// ---------------------------------------------------------------------------
// Data Loading
// ---------------------------------------------------------------------------

function loadRecentFeedback({ feedbackDir, windowMs = SESSION_WINDOW_MS, now = Date.now() } = {}) {
  const dir = feedbackDir || resolveFeedbackDir();
  const logPath = path.join(dir, 'feedback-log.jsonl');
  const entries = readJsonl(logPath, { tail: true, maxLines: 200 });
  const cutoff = now - windowMs;

  return entries.filter((entry) => {
    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

// ---------------------------------------------------------------------------
// Signal Detectors
// ---------------------------------------------------------------------------

function detectRepeatErrors(entries) {
  const errorTexts = entries
    .filter((e) => e.signal === 'negative' && e.whatWentWrong)
    .map((e) => normalizeErrorText(e.whatWentWrong));

  const seen = new Map();
  let repeats = 0;

  for (const text of errorTexts) {
    const count = (seen.get(text) || 0) + 1;
    seen.set(text, count);
    if (count > 1) repeats += 1;
  }

  return {
    signal: 'repeat_errors',
    count: repeats,
    total: errorTexts.length,
    rate: errorTexts.length > 0 ? repeats / errorTexts.length : 0,
    severity: repeats >= 3 ? 'critical' : repeats >= 1 ? 'warning' : 'healthy',
  };
}

function detectNegativeDensity(entries) {
  if (entries.length === 0) {
    return { signal: 'negative_density', count: 0, total: 0, rate: 0, severity: 'healthy' };
  }

  const negatives = entries.filter((e) => e.signal === 'negative').length;
  const rate = negatives / entries.length;

  return {
    signal: 'negative_density',
    count: negatives,
    total: entries.length,
    rate,
    severity: rate > 0.7 ? 'critical' : rate > 0.4 ? 'warning' : 'healthy',
  };
}

function detectStagnation(entries) {
  let maxConsecutiveNegatives = 0;
  let current = 0;

  for (const entry of entries) {
    if (entry.signal === 'negative') {
      current += 1;
      maxConsecutiveNegatives = Math.max(maxConsecutiveNegatives, current);
    } else {
      current = 0;
    }
  }

  return {
    signal: 'stagnation',
    consecutiveNegatives: maxConsecutiveNegatives,
    threshold: STAGNATION_THRESHOLD,
    severity: maxConsecutiveNegatives >= STAGNATION_THRESHOLD * 2 ? 'critical'
      : maxConsecutiveNegatives >= STAGNATION_THRESHOLD ? 'warning'
        : 'healthy',
  };
}

function detectContextAmnesia(entries) {
  const amnesiaEntries = entries.filter((e) => {
    const text = [e.context, e.whatWentWrong, e.whatToChange].filter(Boolean).join(' ');
    return AMNESIA_PATTERNS.test(text);
  });

  return {
    signal: 'context_amnesia',
    count: amnesiaEntries.length,
    total: entries.length,
    severity: amnesiaEntries.length >= 3 ? 'critical'
      : amnesiaEntries.length >= 1 ? 'warning'
        : 'healthy',
  };
}

// ---------------------------------------------------------------------------
// Health Score
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHTS = { healthy: 0, warning: 15, critical: 30 };

function computeSessionHealth(entries) {
  const signals = [
    detectRepeatErrors(entries),
    detectNegativeDensity(entries),
    detectStagnation(entries),
    detectContextAmnesia(entries),
  ];

  let penalty = 0;
  for (const signal of signals) {
    penalty += SEVERITY_WEIGHTS[signal.severity] || 0;
  }

  // Extra penalty for high negative density rate
  const density = signals.find((s) => s.signal === 'negative_density');
  if (density && density.rate > 0) {
    penalty += Math.round(density.rate * 20);
  }

  const score = Math.max(HEALTH_FLOOR, Math.min(HEALTH_CEILING, HEALTH_CEILING - penalty));

  return {
    score,
    grade: score >= 80 ? 'healthy' : score >= 50 ? 'degraded' : 'critical',
    signals,
    recommendation: buildRecommendation(score, signals),
    windowMs: SESSION_WINDOW_MS,
    entriesAnalyzed: entries.length,
    computedAt: new Date().toISOString(),
  };
}

function buildRecommendation(score, signals) {
  if (score >= 80) return null;

  const critical = signals.filter((s) => s.severity === 'critical');
  const parts = [];

  if (critical.some((s) => s.signal === 'context_amnesia')) {
    parts.push('Context drift detected. Start a fresh session with CLAUDE.md re-read.');
  }
  if (critical.some((s) => s.signal === 'repeat_errors')) {
    parts.push('Same errors recurring. Capture feedback and promote to prevention rule.');
  }
  if (critical.some((s) => s.signal === 'stagnation')) {
    parts.push('No recovery from failures. Break the task into smaller chunks or restart.');
  }
  if (score < 50 && parts.length === 0) {
    parts.push('Session health is critically low. Consider starting a fresh conversation.');
  }

  return parts.length > 0 ? parts.join(' ') : 'Session showing mild degradation. Monitor closely.';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeErrorText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/\b(line|col|column)\s*\d+/g, '')
    .replace(/\b\d+\b/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  return invokedPath ? path.resolve(invokedPath) === __filename : false;
}

if (isCliInvocation()) {
  const entries = loadRecentFeedback();
  const health = computeSessionHealth(entries);
  console.log(JSON.stringify(health, null, 2));
  if (health.grade === 'critical') process.exit(1);
  if (health.grade === 'degraded') process.exit(2);
}

module.exports = {
  AMNESIA_PATTERNS,
  SESSION_WINDOW_MS,
  STAGNATION_THRESHOLD,
  computeSessionHealth,
  detectContextAmnesia,
  detectNegativeDensity,
  detectRepeatErrors,
  detectStagnation,
  loadRecentFeedback,
  normalizeErrorText,
};
