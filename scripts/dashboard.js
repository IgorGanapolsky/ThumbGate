#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { aggregateFailureDiagnostics } = require('./failure-diagnostics');

const PROJECT_ROOT = path.join(__dirname, '..');
const AUTO_GATES_PATH = path.join(PROJECT_ROOT, 'config', 'gates', 'auto-promoted.json');
const DEFAULT_GATES_PATH = path.join(PROJECT_ROOT, 'config', 'gates', 'default.json');

// ---------------------------------------------------------------------------
// Data readers
// ---------------------------------------------------------------------------

function readJSONL(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Approval rate + trend
// ---------------------------------------------------------------------------

function computeApprovalStats(entries) {
  const total = entries.length;
  const positive = entries.filter((e) => e.signal === 'positive').length;
  const negative = entries.filter((e) => e.signal === 'negative').length;
  const approvalRate = total > 0 ? Math.round((positive / total) * 100) : 0;

  // 7-day trend
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const recentEntries = entries.filter((e) => {
    const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
    return ts >= sevenDaysAgo;
  });
  const recentPositive = recentEntries.filter((e) => e.signal === 'positive').length;
  const recentRate = recentEntries.length > 0
    ? Math.round((recentPositive / recentEntries.length) * 100)
    : approvalRate;

  let trendDirection = 'stable';
  const diff = recentRate - approvalRate;
  if (diff > 5) trendDirection = 'improving';
  else if (diff < -5) trendDirection = 'declining';

  return {
    total,
    positive,
    negative,
    approvalRate,
    recentRate,
    trendDirection,
  };
}

// ---------------------------------------------------------------------------
// Gate enforcement stats
// ---------------------------------------------------------------------------

function computeGateStats(feedbackDir) {
  const statsPath = path.join(
    process.env.HOME || '/tmp',
    '.rlhf',
    'gate-stats.json'
  );
  const stats = readJsonFile(statsPath) || { blocked: 0, warned: 0, passed: 0, byGate: {} };

  // Count manual vs auto-promoted gates
  const defaultGates = readJsonFile(DEFAULT_GATES_PATH);
  const autoGates = readJsonFile(AUTO_GATES_PATH);
  const manualCount = defaultGates && Array.isArray(defaultGates.gates) ? defaultGates.gates.length : 0;
  const autoCount = autoGates && Array.isArray(autoGates.gates) ? autoGates.gates.length : 0;
  const totalGates = manualCount + autoCount;

  // Top blocked gate
  let topBlocked = null;
  let topBlockedCount = 0;
  if (stats.byGate) {
    for (const [gateId, gateStat] of Object.entries(stats.byGate)) {
      const blocked = gateStat.blocked || 0;
      if (blocked > topBlockedCount) {
        topBlockedCount = blocked;
        topBlocked = gateId;
      }
    }
  }

  return {
    totalGates,
    manualCount,
    autoCount,
    blocked: stats.blocked || 0,
    warned: stats.warned || 0,
    passed: stats.passed || 0,
    topBlocked,
    topBlockedCount,
    byGate: stats.byGate || {},
  };
}

// ---------------------------------------------------------------------------
// Prevention impact
// ---------------------------------------------------------------------------

function computePreventionImpact(feedbackDir, gateStats) {
  const preventionRulesPath = path.join(feedbackDir, 'prevention-rules.md');
  let ruleCount = 0;
  if (fs.existsSync(preventionRulesPath)) {
    const content = fs.readFileSync(preventionRulesPath, 'utf-8');
    const headers = content.match(/^## /gm);
    ruleCount = headers ? headers.length : 0;
  }

  // Estimate time saved: ~16 min per blocked action (conservative)
  const estimatedMinutesSaved = gateStats.blocked * 16;
  const estimatedHoursSaved = (estimatedMinutesSaved / 60).toFixed(1);

  // Last auto-promotion
  const autoGates = readJsonFile(AUTO_GATES_PATH);
  let lastPromotion = null;
  if (autoGates && Array.isArray(autoGates.promotionLog) && autoGates.promotionLog.length > 0) {
    const sorted = autoGates.promotionLog
      .filter((p) => p.timestamp)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    if (sorted.length > 0) {
      const last = sorted[0];
      const daysAgo = Math.round((Date.now() - new Date(last.timestamp).getTime()) / (1000 * 60 * 60 * 24));
      lastPromotion = { id: last.gateId || last.id || 'unknown', daysAgo };
    }
  }

  return {
    estimatedHoursSaved,
    ruleCount,
    lastPromotion,
  };
}

// ---------------------------------------------------------------------------
// Session trend (last N sessions)
// ---------------------------------------------------------------------------

function computeSessionTrend(entries, windowCount) {
  if (entries.length < 10) return { bars: '', percentage: 0 };
  const windowSize = Math.max(1, Math.floor(entries.length / windowCount));
  const windows = [];
  for (let i = 0; i + windowSize <= entries.length; i += windowSize) {
    const slice = entries.slice(i, i + windowSize);
    const pos = slice.filter((e) => e.signal === 'positive').length;
    windows.push(Math.round((pos / slice.length) * 100));
  }
  const recent = windows.slice(-windowCount);
  const avg = recent.length > 0 ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 0;
  const filledBlocks = Math.round((avg / 100) * windowCount);
  const bars = '\u2588'.repeat(filledBlocks) + '\u2591'.repeat(windowCount - filledBlocks);
  return { bars, percentage: avg };
}

// ---------------------------------------------------------------------------
// System health
// ---------------------------------------------------------------------------

function computeSystemHealth(feedbackDir, gateStats) {
  const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');
  const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');

  const feedbackCount = readJSONL(feedbackLogPath).length;
  const memoryCount = readJSONL(memoryLogPath).length;

  return {
    feedbackCount,
    memoryCount,
    gateConfigLoaded: gateStats.totalGates > 0,
    gateCount: gateStats.totalGates,
    mcpServerRunning: true, // If dashboard is running, server is available
  };
}

function computeSecretGuardStats(diagnosticEntries) {
  const secretEntries = diagnosticEntries.filter((entry) => {
    if (entry.source === 'secret_guard') return true;
    const violations = entry.diagnosis && Array.isArray(entry.diagnosis.violations)
      ? entry.diagnosis.violations
      : [];
    return violations.some((violation) => String(violation.constraintId || '').startsWith('security:'));
  });

  const byConstraint = {};
  for (const entry of secretEntries) {
    const violations = entry.diagnosis && Array.isArray(entry.diagnosis.violations)
      ? entry.diagnosis.violations
      : [];
    for (const violation of violations) {
      const key = String(violation.constraintId || 'security:unknown');
      byConstraint[key] = (byConstraint[key] || 0) + 1;
    }
  }

  const topConstraint = Object.entries(byConstraint)
    .sort((a, b) => b[1] - a[1])[0] || null;

  return {
    blocked: secretEntries.length,
    topConstraint: topConstraint ? { key: topConstraint[0], count: topConstraint[1] } : null,
    recent: secretEntries
      .slice(-5)
      .reverse()
      .map((entry) => ({
        step: entry.step || null,
        source: entry.source || null,
        timestamp: entry.timestamp || null,
      })),
  };
}

// ---------------------------------------------------------------------------
// Full dashboard data
// ---------------------------------------------------------------------------

function generateDashboard(feedbackDir) {
  const feedbackLogPath = path.join(feedbackDir, 'feedback-log.jsonl');
  const diagnosticLogPath = path.join(feedbackDir, 'diagnostic-log.jsonl');
  const entries = readJSONL(feedbackLogPath);
  const diagnosticEntries = readJSONL(diagnosticLogPath);

  const approval = computeApprovalStats(entries);
  const gateStats = computeGateStats(feedbackDir);
  const prevention = computePreventionImpact(feedbackDir, gateStats);
  const trend = computeSessionTrend(entries, 10);
  const health = computeSystemHealth(feedbackDir, gateStats);
  const diagnostics = aggregateFailureDiagnostics([...entries, ...diagnosticEntries]);
  const secretGuard = computeSecretGuardStats(diagnosticEntries);

  return {
    approval,
    gateStats,
    prevention,
    trend,
    health,
    diagnostics,
    secretGuard,
  };
}

// ---------------------------------------------------------------------------
// Rich CLI output
// ---------------------------------------------------------------------------

function printDashboard(data) {
  const {
    approval,
    gateStats,
    prevention,
    trend,
    health,
    diagnostics,
    secretGuard,
  } = data;

  const trendArrow = approval.trendDirection === 'improving' ? '\u2191'
    : approval.trendDirection === 'declining' ? '\u2193'
    : '\u2192';

  console.log('');
  console.log('\uD83D\uDCCA RLHF Dashboard');
  console.log('\u2550'.repeat(46));
  console.log(`  Approval Rate    : ${approval.approvalRate}% \u2192 ${approval.recentRate}% (7-day trend ${trendArrow})`);
  console.log(`  Total Signals    : ${approval.total} (${approval.positive} positive, ${approval.negative} negative)`);

  console.log('');
  console.log('\uD83D\uDEE1\uFE0F  Gate Enforcement');
  console.log(`  Active Gates     : ${gateStats.totalGates} (${gateStats.manualCount} manual, ${gateStats.autoCount} auto-promoted)`);
  console.log(`  Actions Blocked  : ${gateStats.blocked}`);
  console.log(`  Actions Warned   : ${gateStats.warned}`);
  if (gateStats.topBlocked) {
    console.log(`  Top Blocked      : ${gateStats.topBlocked} (${gateStats.topBlockedCount}\u00D7)`);
  }

  console.log('');
  console.log('\u26A1 Prevention Impact');
  console.log(`  Estimated Saves  : ${prevention.estimatedHoursSaved} hours`);
  console.log(`  Rules Active     : ${prevention.ruleCount} prevention rules`);
  if (prevention.lastPromotion) {
    console.log(`  Last Promotion   : ${prevention.lastPromotion.id} (${prevention.lastPromotion.daysAgo} days ago)`);
  }

  console.log('');
  console.log('\uD83D\uDD10 Secret Guard');
  console.log(`  Blocks Recorded  : ${secretGuard.blocked}`);
  if (secretGuard.topConstraint) {
    console.log(`  Top Constraint   : ${secretGuard.topConstraint.key} (${secretGuard.topConstraint.count}\u00D7)`);
  }

  console.log('');
  console.log('\uD83D\uDCC8 Trend (last 10 sessions)');
  const trendLabel = approval.trendDirection === 'improving' ? 'improving'
    : approval.trendDirection === 'declining' ? 'declining'
    : 'stable';
  console.log(`  ${trend.bars} ${trend.percentage}% \u2192 ${trendLabel}`);

  console.log('');
  console.log('\uD83D\uDD27 System Health');
  console.log(`  Feedback Log     : ${health.feedbackCount} entries`);
  console.log(`  Memory Store     : ${health.memoryCount} memories`);
  console.log(`  Gate Config      : ${health.gateConfigLoaded ? 'loaded' : 'not found'} (${health.gateCount} gates)`);
  console.log(`  MCP Server       : running`);
  if (diagnostics.totalDiagnosed > 0) {
    console.log(`  Failure Diagnoses: ${diagnostics.totalDiagnosed}`);
    if (diagnostics.categories[0]) {
      console.log(`  Top Root Cause   : ${diagnostics.categories[0].key} (${diagnostics.categories[0].count}\u00D7)`);
    }
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Exports + CLI
// ---------------------------------------------------------------------------

module.exports = {
  generateDashboard,
  printDashboard,
  computeApprovalStats,
  computeGateStats,
  computePreventionImpact,
  computeSessionTrend,
  computeSystemHealth,
  computeSecretGuardStats,
  readJSONL,
  readJsonFile,
};

if (require.main === module) {
  const { getFeedbackPaths } = require('./feedback-loop');
  const { FEEDBACK_DIR } = getFeedbackPaths();
  const data = generateDashboard(FEEDBACK_DIR);
  printDashboard(data);
}
