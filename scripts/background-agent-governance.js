#!/usr/bin/env node
'use strict';

/**
 * Background Agent Governance — the missing layer for Ramp/Ona-style agent stacks.
 *
 * Background agents run unattended (writing 57% of PRs at Ramp). They need:
 * 1. Run tracking — what did each agent run do?
 * 2. Governance gate — should this PR/action be allowed based on past failures?
 * 3. Post-run audit — auto-capture feedback from CI results
 * 4. Governance report — "X runs, Y blocked, Z lessons learned"
 *
 * Integrates with: MCP server, gates engine, org dashboard, lesson inference.
 */

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');
const { ensureParentDir, readJsonl } = require('./fs-utils');

const RUNS_FILE = 'agent-runs.jsonl';

function getFeedbackDir(feedbackDir) { return resolveFeedbackDir({ feedbackDir }); }
function getRunsPath(feedbackDir) { return path.join(getFeedbackDir(feedbackDir), RUNS_FILE); }

// ---------------------------------------------------------------------------
// 1. Run Tracking
// ---------------------------------------------------------------------------

/**
 * Record a background agent run.
 * Called when a background agent starts or completes a task.
 */
function recordAgentRun({ agentId, runType, source, branch, prNumber, status, gatesChecked, gatesBlocked, filesChanged, ciPassed, duration, metadata } = {}, feedbackDir) {
  const runsPath = getRunsPath(feedbackDir);
  ensureParentDir(runsPath);
  const run = {
    id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    agentId: agentId || 'unknown',
    runType: runType || 'unknown', // 'pr', 'fix', 'refactor', 'ci-repair', 'migration'
    source: source || 'background', // 'background', 'triggered', 'scheduled', 'manual'
    branch: branch || null,
    prNumber: prNumber || null,
    status: status || 'started', // 'started', 'completed', 'blocked', 'failed'
    gatesChecked: gatesChecked || 0,
    gatesBlocked: gatesBlocked || 0,
    filesChanged: filesChanged || 0,
    ciPassed: ciPassed === undefined ? null : ciPassed,
    durationMs: duration || null,
    metadata: metadata || {},
  };
  fs.appendFileSync(runsPath, JSON.stringify(run) + '\n');
  return run;
}

// ---------------------------------------------------------------------------
// 2. Governance Gate — pre-run check
// ---------------------------------------------------------------------------

/**
 * Check if a background agent run should proceed based on governance rules.
 * Returns { allowed, blockers, warnings, governanceScore }.
 */
function checkRunGovernance({ agentId, runType, branch, filesChanged } = {}, feedbackDir) {
  const runs = readJsonl(getRunsPath(feedbackDir));
  const blockers = [];
  const warnings = [];

  // Rule 1: Block if this agent has > 50% failure rate in last 10 runs
  const agentRuns = runs.filter((r) => r.agentId === agentId).slice(-10);
  const failedRuns = agentRuns.filter((r) => r.status === 'failed' || r.status === 'blocked');
  if (agentRuns.length >= 5 && failedRuns.length / agentRuns.length > 0.5) {
    blockers.push({ rule: 'high_failure_rate', message: `Agent ${agentId} has ${failedRuns.length}/${agentRuns.length} failed runs (>50%)`, severity: 'critical' });
  }

  // Rule 2: Warn if agent has been blocked by gates in recent runs
  const recentBlocked = agentRuns.filter((r) => r.gatesBlocked > 0);
  if (recentBlocked.length >= 3) {
    warnings.push({ rule: 'repeated_gate_blocks', message: `Agent ${agentId} has been gate-blocked in ${recentBlocked.length} recent runs`, severity: 'warning' });
  }

  // Rule 3: Block if targeting protected branch without CI passing
  if (branch && /^(main|master|develop)$/.test(branch)) {
    warnings.push({ rule: 'protected_branch', message: `Run targets protected branch "${branch}" — CI must pass before merge`, severity: 'warning' });
  }

  // Rule 4: Warn if too many files changed (large blast radius)
  if (filesChanged > 20) {
    warnings.push({ rule: 'large_blast_radius', message: `${filesChanged} files changed — consider splitting into smaller PRs`, severity: 'warning' });
  }

  const governanceScore = Math.max(0, 100 - blockers.length * 40 - warnings.length * 10);

  return {
    allowed: blockers.length === 0,
    blockers,
    warnings,
    governanceScore,
    checkedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 3. Post-Run Audit — auto-capture feedback from CI
// ---------------------------------------------------------------------------

/**
 * Auto-capture feedback from a completed background agent run.
 * Converts CI pass/fail into structured feedback for the learning loop.
 */
function auditCompletedRun({ runId, agentId, ciPassed, ciOutput, prNumber, branch, filesChanged } = {}, feedbackDir) {
  const signal = ciPassed ? 'positive' : 'negative';
  const context = ciPassed
    ? `Background agent run ${runId || 'unknown'} completed successfully. PR #${prNumber || '?'} on ${branch || '?'}. ${filesChanged || 0} files changed. CI passed.`
    : `Background agent run ${runId || 'unknown'} failed. PR #${prNumber || '?'} on ${branch || '?'}. ${filesChanged || 0} files changed. CI failed.`;

  const whatWentWrong = !ciPassed && ciOutput ? ciOutput.slice(0, 500) : null;

  // Record the completed run
  const run = recordAgentRun({
    agentId,
    runType: 'pr',
    source: 'background',
    branch,
    prNumber,
    status: ciPassed ? 'completed' : 'failed',
    filesChanged,
    ciPassed,
  }, feedbackDir);

  // Auto-capture feedback
  let feedbackResult = null;
  try {
    const { captureFeedback } = require('./feedback-loop');
    feedbackResult = captureFeedback({
      signal: ciPassed ? 'up' : 'down',
      context,
      whatWentWrong,
      whatWorked: ciPassed ? `Agent successfully completed PR #${prNumber || '?'}` : undefined,
      tags: ['background-agent', ciPassed ? 'ci-pass' : 'ci-fail', `agent:${agentId || 'unknown'}`],
    });
  } catch { /* feedback capture is non-critical */ }

  return { run, feedbackResult, signal, context };
}

// ---------------------------------------------------------------------------
// 4. Governance Report
// ---------------------------------------------------------------------------

/**
 * Generate a governance report for background agent runs.
 * Shows: total runs, blocked, pass rate, top failing agents, lessons learned.
 */
function generateGovernanceReport({ periodHours = 24, feedbackDir } = {}) {
  const runs = readJsonl(getRunsPath(feedbackDir));
  const cutoff = Date.now() - periodHours * 60 * 60 * 1000;
  const recent = runs.filter((r) => new Date(r.timestamp).getTime() > cutoff);

  const total = recent.length;
  const completed = recent.filter((r) => r.status === 'completed').length;
  const failed = recent.filter((r) => r.status === 'failed').length;
  const blocked = recent.filter((r) => r.status === 'blocked').length;
  const started = recent.filter((r) => r.status === 'started').length;

  const passRate = (completed + failed) > 0 ? Math.round((completed / (completed + failed)) * 1000) / 10 : 0;
  const totalGatesChecked = recent.reduce((s, r) => s + (r.gatesChecked || 0), 0);
  const totalGatesBlocked = recent.reduce((s, r) => s + (r.gatesBlocked || 0), 0);

  // Per-agent breakdown
  const byAgent = {};
  for (const r of recent) {
    if (!byAgent[r.agentId]) byAgent[r.agentId] = { completed: 0, failed: 0, blocked: 0, total: 0 };
    byAgent[r.agentId].total++;
    if (r.status === 'completed') byAgent[r.agentId].completed++;
    if (r.status === 'failed') byAgent[r.agentId].failed++;
    if (r.status === 'blocked') byAgent[r.agentId].blocked++;
  }

  const agentSummaries = Object.entries(byAgent).map(([id, counts]) => ({
    agentId: id,
    ...counts,
    passRate: (counts.completed + counts.failed) > 0 ? Math.round((counts.completed / (counts.completed + counts.failed)) * 1000) / 10 : 0,
  })).sort((a, b) => a.passRate - b.passRate);

  // By run type
  const byType = {};
  for (const r of recent) {
    if (!byType[r.runType]) byType[r.runType] = 0;
    byType[r.runType]++;
  }

  return {
    periodHours,
    total, completed, failed, blocked, started,
    passRate,
    gatesChecked: totalGatesChecked,
    gatesBlocked: totalGatesBlocked,
    agents: agentSummaries,
    topFailingAgent: agentSummaries.length > 0 && agentSummaries[0].passRate < 80 ? agentSummaries[0] : null,
    byType,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format governance report as a human-readable string.
 */
function formatGovernanceReport(report) {
  const lines = [
    `Background Agent Governance Report (${report.periodHours}h)`,
    `Total runs: ${report.total} | Completed: ${report.completed} | Failed: ${report.failed} | Blocked: ${report.blocked}`,
    `Pass rate: ${report.passRate}%`,
    `Gates checked: ${report.gatesChecked} | Gates blocked: ${report.gatesBlocked}`,
  ];
  if (report.topFailingAgent) {
    lines.push(`Top failing agent: ${report.topFailingAgent.agentId} (${report.topFailingAgent.passRate}% pass rate)`);
  }
  if (Object.keys(report.byType).length > 0) {
    lines.push(`Run types: ${Object.entries(report.byType).map(([t, c]) => `${t}:${c}`).join(', ')}`);
  }
  return lines.join('\n');
}

module.exports = {
  recordAgentRun, checkRunGovernance, auditCompletedRun,
  generateGovernanceReport, formatGovernanceReport, getRunsPath,
};
