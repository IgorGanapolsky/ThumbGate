#!/usr/bin/env node
'use strict';

/**
 * Per-Step Scoring — OpenClaw-RL inspired real-time learning signals.
 *
 * Converts audit trail entries (allow/deny/warn per tool call) into
 * +1/-1 binary scoring for DPO/KTO training data export.
 *
 * OpenClaw-RL: "Binary RLA scores +1/-1 from next-state feedback after every step."
 * ThumbGate: audit trail already captures allow/deny/warn per step.
 * This module bridges the gap — turns gate decisions into training signals.
 */

const fs = require('fs');
const path = require('path');

function getFeedbackDir() { return process.env.THUMBGATE_FEEDBACK_DIR || path.join(process.cwd(), '.rlhf'); }
function ensureDir(fp) { const d = path.dirname(fp); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function readJsonl(fp) { if (!fs.existsSync(fp)) return []; const raw = fs.readFileSync(fp, 'utf-8').trim(); if (!raw) return []; return raw.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }

const SCORES_FILE = 'step-scores.jsonl';
function getScoresPath() { return path.join(getFeedbackDir(), SCORES_FILE); }

// ---------------------------------------------------------------------------
// Score Conversion
// ---------------------------------------------------------------------------

/**
 * Convert an audit trail decision to a binary score.
 * allow = +1, warn = -0.5, deny = -1
 */
function decisionToScore(decision) {
  switch (decision) {
    case 'allow': return 1;
    case 'warn': return -0.5;
    case 'deny': return -1;
    default: return 0;
  }
}

/**
 * Score a single tool call step from an audit trail entry.
 */
function scoreStep(auditEntry) {
  return {
    id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: auditEntry.timestamp || new Date().toISOString(),
    toolName: auditEntry.toolName || 'unknown',
    agentId: auditEntry.agentId || auditEntry.source || 'unknown',
    decision: auditEntry.decision || 'allow',
    score: decisionToScore(auditEntry.decision),
    gateId: auditEntry.gateId || null,
    context: auditEntry.message || auditEntry.context || '',
  };
}

/**
 * Score all audit trail entries and persist to step-scores.jsonl.
 */
function scoreAuditTrail(auditEntries) {
  const scores = auditEntries.map(scoreStep);
  const scoresPath = getScoresPath();
  ensureDir(scoresPath);
  for (const s of scores) fs.appendFileSync(scoresPath, JSON.stringify(s) + '\n');
  return { scored: scores.length, scores };
}

// ---------------------------------------------------------------------------
// DPO Pair Generation from Per-Step Scores
// ---------------------------------------------------------------------------

/**
 * Generate DPO pairs from per-step scores.
 * Groups consecutive tool calls by agent session, pairs +1 (chosen) with -1 (rejected).
 */
function generateStepDpoPairs({ periodHours = 24 } = {}) {
  const allScores = readJsonl(getScoresPath());
  const cutoff = Date.now() - periodHours * 60 * 60 * 1000;
  const recent = allScores.filter((s) => new Date(s.timestamp).getTime() > cutoff);

  const positives = recent.filter((s) => s.score > 0);
  const negatives = recent.filter((s) => s.score < 0);

  const pairs = [];
  const maxPairs = Math.min(positives.length, negatives.length);

  for (let i = 0; i < maxPairs; i++) {
    const pos = positives[i];
    const neg = negatives[i];
    pairs.push({
      prompt: `Tool call: ${neg.toolName}`,
      chosen: `${pos.toolName}: ${pos.context || 'Action allowed by gate policy'}`.slice(0, 500),
      rejected: `${neg.toolName}: ${neg.context || 'Action blocked/warned by gate policy'}`.slice(0, 500),
      chosenScore: pos.score,
      rejectedScore: neg.score,
      metadata: { chosenGate: pos.gateId, rejectedGate: neg.gateId },
    });
  }

  return {
    pairs,
    pairCount: pairs.length,
    totalPositive: positives.length,
    totalNegative: negatives.length,
    periodHours,
  };
}

// ---------------------------------------------------------------------------
// KTO (Kahneman-Tversky Optimization) Export
// ---------------------------------------------------------------------------

/**
 * Export per-step scores in KTO format.
 * KTO uses individual (prompt, completion, score) tuples — not pairs.
 */
function exportStepKto({ periodHours = 24 } = {}) {
  const allScores = readJsonl(getScoresPath());
  const cutoff = Date.now() - periodHours * 60 * 60 * 1000;
  const recent = allScores.filter((s) => new Date(s.timestamp).getTime() > cutoff);

  const ktoEntries = recent.map((s) => ({
    prompt: `Tool call: ${s.toolName}`,
    completion: `${s.decision}: ${s.context || s.toolName}`.slice(0, 500),
    label: s.score > 0,
    score: s.score,
    metadata: { gateId: s.gateId, agentId: s.agentId },
  }));

  return { entries: ktoEntries, count: ktoEntries.length, periodHours };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/**
 * Get scoring stats for a time period.
 */
function getStepScoringStats({ periodHours = 24 } = {}) {
  const allScores = readJsonl(getScoresPath());
  const cutoff = Date.now() - periodHours * 60 * 60 * 1000;
  const recent = allScores.filter((s) => new Date(s.timestamp).getTime() > cutoff);

  const positive = recent.filter((s) => s.score > 0).length;
  const negative = recent.filter((s) => s.score < 0).length;
  const neutral = recent.filter((s) => s.score === 0).length;

  const byTool = {};
  for (const s of recent) {
    if (!byTool[s.toolName]) byTool[s.toolName] = { positive: 0, negative: 0, total: 0 };
    byTool[s.toolName].total++;
    if (s.score > 0) byTool[s.toolName].positive++;
    else if (s.score < 0) byTool[s.toolName].negative++;
  }

  return { total: recent.length, positive, negative, neutral, byTool, periodHours };
}

module.exports = {
  decisionToScore, scoreStep, scoreAuditTrail,
  generateStepDpoPairs, exportStepKto, getStepScoringStats, getScoresPath,
};
