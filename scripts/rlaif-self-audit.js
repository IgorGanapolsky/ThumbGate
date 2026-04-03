'use strict';
/**
 * RLAIF Self-Audit Module (DPO-01)
 *
 * Heuristic self-scoring of feedback events against CLAUDE.md constraints.
 * NO API calls — pure synchronous evaluation of event fields.
 *
 * Exports: selfAudit, selfAuditAndLog, CONSTRAINTS
 */

const fs = require('fs');
const path = require('path');
const { assessFeedbackActionability } = require('./feedback-quality');

// ---------------------------------------------------------------------------
// CLAUDE.md Constraint Definitions (weight sum = 1.0)
// ---------------------------------------------------------------------------

const CONSTRAINTS = [
  {
    id: 'has_context',
    weight: 0.20,
    check: (e) => typeof e.context === 'string' && e.context.length >= 20,
  },
  {
    id: 'has_actionable_detail',
    weight: 0.25,
    check: (e) => {
      if (e.signal === 'positive') return Boolean(e.whatWorked);
      return Boolean(e.whatWentWrong) && Boolean(e.whatToChange);
    },
  },
  {
    id: 'schema_valid',
    weight: 0.15,
    check: (e) =>
      ['positive', 'negative'].includes(e.signal) &&
      Array.isArray(e.tags) &&
      e.tags.length > 0,
  },
  {
    id: 'rubric_evaluated',
    weight: 0.20,
    check: (e) => e.rubric != null && e.rubric.promotionEligible != null,
  },
  {
    id: 'budget_compliant',
    weight: 0.10,
    check: (e) =>
      !e.rubric ||
      !e.rubric.failingGuardrails ||
      !e.rubric.failingGuardrails.includes('budgetCompliant'),
  },
  {
    id: 'no_vague_signal',
    weight: 0.10,
    check: (e) => assessFeedbackActionability({
      signal: e.signal,
      context: e.context,
      whatWentWrong: e.whatWentWrong,
      whatWorked: e.whatWorked,
    }).promotable,
  },
];

// ---------------------------------------------------------------------------
// selfAudit — pure function, no I/O, no API calls
// ---------------------------------------------------------------------------

/**
 * Evaluate a feedback event against all CLAUDE.md constraints.
 *
 * @param {Object} feedbackEvent - A feedback event object
 * @returns {{ score: number, constraints: Array, timestamp: string }}
 *   score: float in [0, 1] rounded to 3 decimals
 *   constraints: array of { constraint, passed, weight }
 *   timestamp: ISO 8601 string at evaluation time
 */
function selfAudit(feedbackEvent) {
  const e = feedbackEvent || {};
  const results = CONSTRAINTS.map((c) => ({
    constraint: c.id,
    passed: Boolean(c.check(e)),
    weight: c.weight,
  }));
  const score = results.reduce((sum, r) => sum + (r.passed ? r.weight : 0), 0);
  return {
    score: Math.round(score * 1000) / 1000,
    constraints: results,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// selfAuditAndLog — evaluates and appends to self-score-log.jsonl (sync)
// ---------------------------------------------------------------------------

/**
 * Score a feedback event and append the result to self-score-log.jsonl.
 *
 * Non-critical: any filesystem error is swallowed — result is returned regardless.
 *
 * @param {Object} feedbackEvent - The feedback event to score
 * @param {Object} mlPaths - Object with feedbackDir property (from getFeedbackPaths())
 * @returns {{ score: number, constraints: Array, timestamp: string }}
 */
function selfAuditAndLog(feedbackEvent, mlPaths) {
  const result = selfAudit(feedbackEvent);
  try {
    const feedbackDir = (mlPaths && mlPaths.FEEDBACK_DIR) || (mlPaths && mlPaths.feedbackDir);
    if (feedbackDir) {
      const logPath = path.join(feedbackDir, 'self-score-log.jsonl');
      const entry = {
        feedbackId: (feedbackEvent || {}).id || null,
        ...result,
      };
      fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
    }
  } catch (_err) {
    // Non-critical side-effect — swallow and return result anyway
  }
  return result;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { selfAudit, selfAuditAndLog, CONSTRAINTS };
