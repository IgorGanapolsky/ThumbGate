#!/usr/bin/env node
'use strict';

/**
 * Progressive Sign-off Removal (McKinsey / Industrial AI Engineering Steal)
 *
 * Evaluates human-in-the-loop gates whose action is `approve`.
 * When a gate passes N clean runs in a row (Beta-Bernoulli Thompson-sampling
 * confidence above threshold, default N=20, confidence >= 0.90), ThumbGate doctor
 * recommends downgrading the action from `approve` to `warn`.
 *
 * CRITICAL SAFETY INVARIANT:
 * Recommend only. Never edit gate definition files under config/ or .thumbgate/.
 * The self-protect gate blocks direct configuration edits, and must.
 */

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');

const DEFAULT_CLEAN_RUNS_N = 20;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.90;

/**
 * Compute Beta posterior mean as Thompson-sampling confidence:
 *   confidence = alpha / (alpha + beta)
 * where alpha = 1.0 + cleanRuns, beta = 1.0 + failures (using uniform prior Beta(1,1)).
 *
 * @param {number} cleanRuns - Number of consecutive clean runs
 * @param {number} [failures=0] - Number of failures (0 for clean streak)
 * @returns {number} Confidence value in [0, 1]
 */
function computeThompsonConfidence(cleanRuns, failures = 0) {
  const alpha = 1.0 + Math.max(0, Number(cleanRuns) || 0);
  const beta = 1.0 + Math.max(0, Number(failures) || 0);
  return alpha / (alpha + beta);
}

/**
 * Load all gates from default or custom gate paths.
 *
 * @param {object} [options]
 * @param {string} [options.projectRoot]
 * @param {string} [options.manualGatesPath]
 * @param {Array} [options.gates]
 * @returns {Array<object>}
 */
function loadApprovalGates(options = {}) {
  if (Array.isArray(options.gates)) {
    return options.gates.filter((g) => g && g.action === 'approve');
  }

  const projectRoot = options.projectRoot || path.join(__dirname, '..');
  const manualGatesPath = options.manualGatesPath
    || path.join(projectRoot, 'config', 'gates', 'default.json');

  if (!fs.existsSync(manualGatesPath)) return [];

  try {
    const raw = fs.readFileSync(manualGatesPath, 'utf8');
    const parsed = JSON.parse(raw);
    const gates = Array.isArray(parsed.gates) ? parsed.gates : [];
    return gates.filter((g) => g && g.action === 'approve');
  } catch {
    return [];
  }
}

/**
 * Scan audit-trail.jsonl backwards to count consecutive clean runs for a gate.
 *
 * @param {string} gateId
 * @param {string} auditTrailPath
 * @returns {number} Consecutive clean runs
 */
function countCleanRunsFromAuditTrail(gateId, auditTrailPath) {
  if (!fs.existsSync(auditTrailPath)) return 0;

  try {
    const content = fs.readFileSync(auditTrailPath, 'utf8').trim();
    if (!content) return 0;
    const lines = content.split('\n');

    let cleanStreak = 0;
    // Iterate from newest to oldest
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i].trim();
      if (!line) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }

      if (record.gateId === gateId || record.gate === gateId) {
        const isDeny = record.decision === 'deny' || record.error === true || record.violation === true;
        if (isDeny) {
          // Streak broken
          break;
        }

        const isClean = record.decision === 'approve'
          || record.decision === 'allow'
          || record.status === 'clean'
          || record.status === 'success'
          || record.clean === true;

        if (isClean) {
          cleanStreak += 1;
        }
      }
    }
    return cleanStreak;
  } catch {
    return 0;
  }
}

/**
 * Resolve clean runs for a gate across explicit overrides, gate-stats, and audit-trail.
 *
 * @param {string} gateId
 * @param {object} [options]
 * @returns {number}
 */
function resolveCleanRunsForGate(gateId, options = {}) {
  // 1. Explicit override (e.g. for testing or telemetry injected directly)
  if (options.cleanRunsByGate && typeof options.cleanRunsByGate[gateId] === 'number') {
    return Math.max(0, options.cleanRunsByGate[gateId]);
  }

  // 2. Check gate-stats.json if present
  const statsPath = options.statsPath
    || (options.feedbackDir ? path.join(options.feedbackDir, 'gate-stats.json') : null)
    || path.join(resolveFeedbackDir(), 'gate-stats.json');

  if (fs.existsSync(statsPath)) {
    try {
      const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
      if (stats.byGate && stats.byGate[gateId]) {
        const entry = stats.byGate[gateId];
        if (typeof entry.cleanRuns === 'number') {
          return Math.max(0, entry.cleanRuns);
        }
        if (typeof entry.consecutiveCleanRuns === 'number') {
          return Math.max(0, entry.consecutiveCleanRuns);
        }
      }
    } catch {
      // fallback to audit-trail
    }
  }

  // 3. Scan audit-trail.jsonl
  const auditPath = options.auditTrailPath
    || (options.feedbackDir ? path.join(options.feedbackDir, 'audit-trail.jsonl') : null)
    || path.join(resolveFeedbackDir(), 'audit-trail.jsonl');

  return countCleanRunsFromAuditTrail(gateId, auditPath);
}

/**
 * Evaluate human-in-the-loop approval gates for progressive sign-off removal recommendations.
 *
 * @param {object} [options]
 * @param {number} [options.thresholdN=20] - Number of clean runs required
 * @param {number} [options.confidenceThreshold=0.90] - Thompson-sampling confidence threshold
 * @param {object} [options.cleanRunsByGate] - Optional map of gateId -> clean run count
 * @param {Array<object>} [options.gates] - Optional explicit list of gates
 * @param {string} [options.projectRoot] - Project root directory
 * @returns {object} Evaluation results with recommendations
 */
function evaluateProgressiveSignoff(options = {}) {
  const rawN = Number(options.thresholdN || options.cleanRunsThreshold);
  const thresholdN = Number.isFinite(rawN) && rawN > 0 ? rawN : DEFAULT_CLEAN_RUNS_N;

  const rawConf = Number(options.confidenceThreshold);
  const confidenceThreshold = Number.isFinite(rawConf) && rawConf > 0 && rawConf <= 1.0
    ? rawConf
    : DEFAULT_CONFIDENCE_THRESHOLD;

  const approvalGates = loadApprovalGates(options);
  const evaluatedGates = [];
  const recommendations = [];

  for (const gate of approvalGates) {
    if (!gate || !gate.id) continue;
    const cleanRuns = resolveCleanRunsForGate(gate.id, options);
    const confidence = computeThompsonConfidence(cleanRuns, 0);
    const eligible = cleanRuns >= thresholdN && confidence >= confidenceThreshold;

    const evaluation = {
      gateId: gate.id,
      currentAction: gate.action,
      cleanRuns,
      requiredCleanRuns: thresholdN,
      confidence: Number(confidence.toFixed(4)),
      confidenceThreshold,
      eligibleForDowngrade: eligible,
    };
    evaluatedGates.push(evaluation);

    if (eligible) {
      recommendations.push({
        gateId: gate.id,
        currentAction: 'approve',
        recommendedAction: 'warn',
        cleanRuns,
        requiredCleanRuns: thresholdN,
        confidence: Number(confidence.toFixed(4)),
        confidenceThreshold,
        reason: `Passed ${cleanRuns} clean runs in a row (Thompson-sampling confidence ${(confidence * 100).toFixed(1)}% >= ${(confidenceThreshold * 100).toFixed(1)}%). Recommend downgrade 'approve' -> 'warn'.`,
        advisoryOnly: true,
      });
    }
  }

  return {
    evaluatedCount: evaluatedGates.length,
    thresholdN,
    confidenceThreshold,
    evaluatedGates,
    recommendations,
    hasRecommendations: recommendations.length > 0,
    safetyNotice: 'Advisory only. Gate definition files under config/ are protected and must never be auto-edited.',
  };
}

/**
 * Format progressive sign-off recommendations for human-readable doctor output.
 *
 * @param {object} progressiveSignoff
 * @returns {string|null}
 */
function formatProgressiveSignoffSection(progressiveSignoff) {
  if (!progressiveSignoff || !Array.isArray(progressiveSignoff.recommendations) || progressiveSignoff.recommendations.length === 0) {
    return null;
  }

  const lines = ['Progressive Sign-off Recommendations:'];
  for (const rec of progressiveSignoff.recommendations) {
    const pct = (rec.confidence * 100).toFixed(1);
    lines.push(
      `  - Gate "${rec.gateId}": ${rec.cleanRuns} clean runs (Thompson confidence: ${pct}%). Recommend downgrade 'approve' -> 'warn'. (Advisory only — manual config change required)`
    );
  }
  return lines.join('\n');
}

module.exports = {
  DEFAULT_CLEAN_RUNS_N,
  DEFAULT_CONFIDENCE_THRESHOLD,
  computeThompsonConfidence,
  loadApprovalGates,
  countCleanRunsFromAuditTrail,
  resolveCleanRunsForGate,
  evaluateProgressiveSignoff,
  formatProgressiveSignoffSection,
};
