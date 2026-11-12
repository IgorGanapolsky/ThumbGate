#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { getAutoGatesPath } = require('./auto-promote-gates');
const { computeBayesErrorRate } = require('./bayes-optimal-gate');
const { sequencePathFor } = require('./risk-scorer');

const { getAuditLogPath } = require('./audit-trail');
const { readTextTail } = require('./fs-utils');
const PROJECT_ROOT = path.join(__dirname, '..');
const MANUAL_GATES_PATH = path.join(PROJECT_ROOT, 'config', 'gates', 'default.json');
const STATS_PATH = path.join(process.env.HOME || '/tmp', '.thumbgate', 'gate-stats.json');

function loadGatesFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return data.gates || [];
  } catch {
    return [];
  }
}

function calculateStats(options = {}) {
  const autoGatesPath = options.autoGatesPath || getAutoGatesPath();
  const manualGates = loadGatesFile(options.manualGatesPath || MANUAL_GATES_PATH);
  const autoGates = loadGatesFile(autoGatesPath);
  const statsPath = options.statsPath || STATS_PATH;
  const allGates = [...manualGates, ...autoGates];

  let autoPromotedData = { promotionLog: [] };
  if (fs.existsSync(autoGatesPath)) {
    try { autoPromotedData = JSON.parse(fs.readFileSync(autoGatesPath, 'utf-8')); } catch {}
  }
  const promotionLog = autoPromotedData.promotionLog || [];

  const blockGates = allGates.filter((g) => g.action === 'block');
  const warnGates = allGates.filter((g) => g.action === 'warn');

  // Count total blocks/warns from occurrences in auto-promoted gates
  let totalBlocked = autoGates
    .filter((g) => g.action === 'block')
    .reduce((sum, g) => sum + (Number(g.occurrences) || 0), 0);
  let totalWarned = autoGates
    .filter((g) => g.action === 'warn')
    .reduce((sum, g) => sum + (Number(g.occurrences) || 0), 0);

  // Top blocked gate. A configured block rule with zero occurrences is not a
  // "top blocker"; only recorded block events should appear here.
  const topBlocked = [...allGates]
    .filter((g) => g.action === 'block' && Number(g.occurrences || 0) > 0)
    .sort((a, b) => (b.occurrences || 0) - (a.occurrences || 0))
    .at(0) || null;

  // Last promotion event
  const lastPromotion = promotionLog.length > 0
    ? promotionLog[promotionLog.length - 1]
    : null;

  let distinctBlocked = totalBlocked;
  let recurringBlocks = 0;
  try {
    if (fs.existsSync(statsPath)) {
      const persisted = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
      recurringBlocks = Number(persisted.recurringBlocks || persisted.repeatBlocks || 0);
      const pBlocked = Number(persisted.blocked || persisted.blocks || 0);
      if (pBlocked > 0) {
        totalBlocked = Math.max(totalBlocked, pBlocked);
      }
      if (Number.isFinite(persisted.distinctBlocks)) {
        distinctBlocked = Math.max(0, Math.trunc(persisted.distinctBlocks));
      } else {
        distinctBlocked = Math.max(0, totalBlocked - recurringBlocks);
      }
    }
  } catch (_) {}

  // Time saved estimate: ~15 min per blocked mistake
  const estimatedMinutesSaved = (totalBlocked + totalWarned) * 15;
  const estimatedHoursSaved = (estimatedMinutesSaved / 60).toFixed(1);

  // Bayes error rate: irreducible error floor of the current scorer given its
  // feature set (tag signatures). It is only meaningful when the local sample
  // contains both harmful and safe outcomes; an all-negative or all-positive
  // sample can produce a misleading 0.0% floor.
  const bayesErrorRate = tryComputeBayesErrorRate();

  // Calibration: per-gate assessment of whether block actions are well-supported
  // by negative feedback, or potentially over/under-blocking without confirmation.
  const calibration = computeCalibration(allGates);

  // First-time fix rate: 1 - (recurringBlocks / totalBlocksAndWarns)
  // Measures how often a single gate fire resolves the issue vs the agent retrying.
  // Returns null when there is no recorded block/warn data yet.
  const firstTimeFixRate = computeFirstTimeFixRate();

  const activeAllGates = allGates.filter((g) => !isDisabledGateDefinition(g));
  const activeManualCount = manualGates.filter((g) => !isDisabledGateDefinition(g)).length;
  const activeAutoCount = autoGates.filter((g) => !isDisabledGateDefinition(g)).length;
  const bypassStats = computeWeeklyBypassStats({
    allGates,
    auditLogPath: options.auditLogPath,
    now: options.now,
  });
  return {
    totalGates: activeAllGates.length,
    manualGates: activeManualCount,
    autoPromotedGates: activeAutoCount,
    blockGates: activeAllGates.filter((g) => g.action === 'block').length,
    warnGates: activeAllGates.filter((g) => g.action === 'warn').length,
    totalBlocked,
    lifetimeBlocked: totalBlocked,
    distinctBlocked,
    recurringBlocks,
    repeatBlocks: recurringBlocks,
    weeklyBypasses: bypassStats.weeklyTotal,
    weeklyBypassRate: bypassStats.bypassRate,
    bypassStats,
    totalWarned,
    topBlocked,
    lastPromotion,
    estimatedHoursSaved,
    bayesErrorRate,
    calibration,
    firstTimeFixRate,
    gates: allGates,
  };
}

/**
 * Assess each gate's calibration by comparing block occurrences to confirmed
 * negative feedback counts. A gate with many blocks but no confirming negative
 * feedback may be over-blocking; one with matching feedback is well-calibrated.
 *
 * @param {Array} gates - Combined array of manual + auto-promoted gate objects
 * @returns {Array<{gateId: string, occurrences: number, action: string, calibrationNote: string}>}
 */
function computeCalibration(gates) {
  const calibration = [];
  for (const gate of gates || []) {
    if (!gate || !gate.id) continue;
    const occurrences = Number(gate.occurrences || 0);
    const action = gate.action || 'unknown';
    // Only annotate gates with recorded occurrence data
    if (occurrences === 0) continue;

    if (action === 'block') {
      const confirmedNegative = Number(gate.confirmedNegative || gate.negativeCount || 0);
      let calibrationNote;
      if (occurrences > 10 && confirmedNegative === 0) {
        calibrationNote = `over-blocking (${occurrences} blocks, 0 confirmed)`;
      } else if (confirmedNegative > 0) {
        calibrationNote = `well-calibrated (${occurrences} blocks, ${confirmedNegative} confirmed)`;
      } else {
        // Low occurrence count with no feedback — not enough data yet
        calibrationNote = `insufficient data (${occurrences} blocks, 0 confirmed)`;
      }
      calibration.push({ gateId: gate.id, occurrences, action, calibrationNote });
    }
  }
  return calibration;
}

/**
 * Compute the first-time fix rate from the persisted gate-stats.json file.
 *
 * firstTimeFixRate = 1 - (recurringBlocks / totalBlocksAndWarns)
 *
 * Returns null when there are no recorded block/warn events yet.
 * Returns a number in [0, 1] otherwise, where 1.0 means every gate fire
 * was a first-time occurrence and 0.0 means every gate fired at least twice.
 */
function computeFirstTimeFixRate() {
  try {
    if (!fs.existsSync(STATS_PATH)) return null;
    const raw = fs.readFileSync(STATS_PATH, 'utf8');
    const data = JSON.parse(raw);
    const totalBlocksAndWarns = (data.blocked || 0) + (data.warned || 0);
    if (totalBlocksAndWarns === 0) return null;
    const recurring = data.recurringBlocks || 0;
    const rate = 1 - (recurring / totalBlocksAndWarns);
    return Math.max(0, Math.min(1, rate));
  } catch {
    return null;
  }
}

function tryComputeBayesErrorRate() {
  try {
    const seqPath = sequencePathFor();
    if (!fs.existsSync(seqPath)) return null;
    const rows = fs.readFileSync(seqPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
    if (!hasMixedOutcomeClasses(rows)) return null;
    return computeBayesErrorRate(rows);
  } catch {
    return null;
  }
}

function hasMixedOutcomeClasses(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return false;
  let harmful = 0;
  let safe = 0;
  for (const row of rows) {
    if (sequenceIsHarmful(row)) harmful += 1;
    else safe += 1;
    if (harmful > 0 && safe > 0) return true;
  }
  return false;
}

function sequenceIsHarmful(row) {
  if (!row || typeof row !== 'object') return false;
  if (typeof row.targetRisk === 'number') return row.targetRisk > 0;
  if (typeof row.accepted === 'boolean' && row.accepted === false) return true;
  const label = String(row.label || row.signal || '').toLowerCase();
  return label === 'negative';
}

function formatLastPromotion(promo) {
  if (!promo) return 'none';
  const ts = promo.timestamp ? new Date(promo.timestamp) : null;
  if (!ts) return `${promo.gateId || 'unknown'}`;
  const now = Date.now();
  const diffMs = now - ts.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const ago = diffDays === 0 ? 'today' : diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
  const label = promo.type === 'upgrade'
    ? `${promo.gateId} -> ${promo.to} (${ago})`
    : `${promo.gateId} (${ago})`;
  return label;
}

function toCount(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;
}

function formatStats(stats) {
  const lines = [];
  lines.push('Gate Statistics');
  lines.push('─'.repeat(38));
  lines.push(`  Active gates: ${stats.totalGates} (${stats.manualGates} manual, ${stats.autoPromotedGates} auto-promoted)`);
  lines.push(`  Actions blocked: ${stats.totalBlocked}`);
  if (stats.bypassStats) {
    const b = stats.bypassStats;
    const rateLabel = b.bypassRate !== null ? ` (${(b.bypassRate * 100).toFixed(1)}% of gated decisions)` : '';
    lines.push(`  Gates bypassed (7d): ${b.weeklyTotal}${rateLabel} [--no-verify: ${b.noVerifyAttempts}, break-glass: ${b.breakGlass}, disabled: ${b.disabledGates}, satisfy_gate: ${b.satisfyGateOverrides}]`);
  }
  if (stats.recurringBlocks !== undefined && stats.recurringBlocks > 0) {
    const fallback = toCount(Math.max(0, stats.totalBlocked - stats.recurringBlocks), 0);
    const distinct = toCount(stats.distinctBlocked, fallback);
    lines.push(`  Repeat blocks: ${stats.recurringBlocks} (${distinct} distinct first-time blocks)`);
  }
  lines.push(`  Actions warned: ${stats.totalWarned}`);
  lines.push(`  Top blocked gate: ${stats.topBlocked ? `${stats.topBlocked.id} (${stats.topBlocked.occurrences || 0} blocks)` : 'none'}`);
  lines.push(`  Last promotion: ${formatLastPromotion(stats.lastPromotion)}`);
  lines.push(`  Estimated time saved: ~${stats.estimatedHoursSaved} hours`);
  lines.push(`  Bayes error rate: ${formatBayesErrorRate(stats.bayesErrorRate)}`);
  lines.push(`  First-time fix rate: ${formatFirstTimeFixRate(stats.firstTimeFixRate)}`);
  if (Array.isArray(stats.calibration) && stats.calibration.length > 0) {
    lines.push('Calibration:');
    for (const entry of stats.calibration) {
      lines.push(`  - ${entry.gateId}: ${entry.calibrationNote}`);
    }
  }
  return lines.join('\n');
}

function formatBayesErrorRate(rate) {
  if (rate === null || rate === undefined) return 'n/a (need both safe and harmful feedback sequences)';
  const pct = (rate * 100).toFixed(1);
  if (rate < 0.02) return `${pct}% — scorer is near-optimal; add features, don't tune thresholds`;
  if (rate < 0.10) return `${pct}% — scorer has modest headroom`;
  return `${pct}% — high irreducible error; the feature set can't discriminate`;
}

function formatFirstTimeFixRate(rate) {
  if (rate === null || rate === undefined) return 'n/a (no blocks or warns recorded yet)';
  const pct = (rate * 100).toFixed(1);
  if (rate >= 0.95) return `${pct}% — agents fix issues on first block (excellent)`;
  if (rate >= 0.80) return `${pct}% — most blocks resolved first time (good)`;
  return `${pct}% — recurring blocks detected; agents may be ignoring gate feedback`;
}
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DISABLED_GATE_MSG_RE = /\[[^\]]*gate disabled\]/i;
const NO_VERIFY_GATE_RE = /^(?:git-no-verify|deploy-skip-ci|no-skip-hooks)$/i;
const BREAK_GLASS_TTL_MS = 5 * 60 * 1000;
const DEDUP_WINDOW_MS = 5000;

function safeDefaultAuditPath() {
  try { return getAuditLogPath(); } catch { return null; }
}

function parseAuditLine(line, sinceMs) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const rec = JSON.parse(trimmed);
    const ts = Date.parse(rec?.timestamp || '');
    return rec && Number.isFinite(ts) && ts >= sinceMs ? { rec, ts } : null;
  } catch {
    return null;
  }
}

function readRecentAuditRows(auditLogPath, sinceMs) {
  const resolved = auditLogPath || safeDefaultAuditPath();
  if (!resolved || !fs.existsSync(resolved)) return [];
  try {
    const { text } = readTextTail(resolved, 8 * 1024 * 1024);
    const rows = [];
    for (const line of text.split('\n')) {
      const parsed = parseAuditLine(line, sinceMs);
      if (parsed) rows.push(parsed);
    }
    return rows;
  } catch {
    return [];
  }
}

function isDisabledGateDefinition(gate) {
  if (!gate || typeof gate !== 'object') return false;
  return gate.enabled === false || gate.disabled === true || gate.action === 'disabled' || gate.action === 'off';
}

function commandSegmentHasNoVerify(segment) {
  const unquoted = segment.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ' ');
  if (/(?:^|\s)--no-verify(?:\s|$)/.test(unquoted)) return true;
  if (!/\bgit\s+commit\b/.test(unquoted)) return false;
  return /\s-n(?:\s|$)/.test(unquoted);
}

function isNoVerifyRecord(rec) {
  const gateId = String(rec?.gateId || '');
  if (NO_VERIFY_GATE_RE.test(gateId) || /no-verify/i.test(gateId)) return true;
  const cmd = String(rec?.toolInput?.command || rec?.inputSummary || '');
  if (!cmd) return false;
  for (const segment of cmd.split(/&&|\|\||;|\||\n/)) {
    if (commandSegmentHasNoVerify(segment)) return true;
  }
  return false;
}

function resolveOverrideGateKey(rec) {
  return String(rec?.gateId || rec?.toolInput?.gate || rec?.toolInput?.gateId || rec?.toolInput?.gate_id || 'gate');
}

function isRecentTimestamp(lastTs, ts, windowMs) {
  return lastTs !== undefined && Math.abs(ts - lastTs) <= windowMs;
}

function matchBreakGlassBypass(rec, ts, state) {
  const isBg = rec.override?.source === 'break-glass' || rec.gateId === 'thumbgate_break_glass' || rec.toolName === 'break_glass_emergency';
  if (!isBg) return false;
  if (rec.override?.reason === 'grant revoked before expiry') return true;
  if (rec.decision === 'allow' && isRecentTimestamp(state.lastBreakGlassTs, ts, BREAK_GLASS_TTL_MS)) return true;
  if (isRecentTimestamp(state.lastBreakGlassTs, ts, DEDUP_WINDOW_MS)) return true;
  state.lastBreakGlassTs = ts;
  state.counts.breakGlass += 1;
  return true;
}

function matchSatisfyBypass(rec, ts, state) {
  if (rec.toolName === 'satisfy_gate' && (rec.source === 'tool-latency' || rec.source === 'structured-reasoning')) return true;
  const isOverride = rec.decision === 'override' || (rec.decision === 'allow' && rec.source === 'gates-engine-admin-override');
  if (!isOverride && rec.toolName !== 'satisfy_gate') return false;
  if (rec.override?.reason === 'grant revoked before expiry') return true;
  const gateKey = resolveOverrideGateKey(rec);
  if (isRecentTimestamp(state.lastSatisfyByGate.get(gateKey), ts, DEDUP_WINDOW_MS)) return true;
  state.lastSatisfyByGate.set(gateKey, ts);
  state.counts.satisfyGateOverrides += 1;
  return true;
}

function recordBypassAuditRow(rec, ts, state) {
  const isDeny = rec.decision === 'deny';
  if (isDeny) state.weeklyBlocks += 1;
  if (matchBreakGlassBypass(rec, ts, state)) return;
  if (matchSatisfyBypass(rec, ts, state)) return;
  if (rec.decision === 'skip' || rec.disabledGate === true || DISABLED_GATE_MSG_RE.test(String(rec.message || ''))) {
    state.counts.disabledGateSkips += 1;
    return;
  }
  if (isNoVerifyRecord(rec)) {
    state.counts.noVerifyAttempts += 1;
    if (isDeny) state.deniedBypassAttempts += 1;
  }
}

function resolveGatesList(options) {
  if (Array.isArray(options.allGates)) return options.allGates;
  const manual = loadGatesFile(options.manualGatesPath || MANUAL_GATES_PATH);
  const auto = loadGatesFile(options.autoGatesPath || getAutoGatesPath());
  return [...manual, ...auto];
}

function computeWeeklyBypassStats(options = {}) {
  const parsedNow = options.now ? new Date(options.now).getTime() : Date.now();
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  const sinceMs = nowMs - WEEK_MS;
  const disabledGateDefinitions = resolveGatesList(options).filter(isDisabledGateDefinition).length;
  const state = {
    counts: { noVerifyAttempts: 0, breakGlass: 0, disabledGateSkips: 0, satisfyGateOverrides: 0 },
    weeklyBlocks: 0,
    deniedBypassAttempts: 0,
    lastBreakGlassTs: undefined,
    lastSatisfyByGate: new Map(),
  };
  for (const { rec, ts } of readRecentAuditRows(options.auditLogPath, sinceMs)) {
    recordBypassAuditRow(rec, ts, state);
  }
  const disabledGates = disabledGateDefinitions + state.counts.disabledGateSkips;
  const eventBypasses = state.counts.noVerifyAttempts + state.counts.breakGlass + state.counts.disabledGateSkips + state.counts.satisfyGateOverrides;
  const weeklyTotal = eventBypasses + disabledGateDefinitions;
  const nonBypassBlocks = Math.max(0, state.weeklyBlocks - state.deniedBypassAttempts);
  const denom = eventBypasses + nonBypassBlocks;
  return {
    windowDays: 7,
    since: new Date(sinceMs).toISOString(),
    weeklyTotal,
    eventBypasses,
    weeklyBlocks: state.weeklyBlocks,
    bypassRate: denom > 0 ? Math.round((eventBypasses / denom) * 10000) / 10000 : null,
    noVerifyAttempts: state.counts.noVerifyAttempts,
    breakGlass: state.counts.breakGlass,
    disabledGates,
    disabledGateDefinitions,
    disabledGateSkips: state.counts.disabledGateSkips,
    satisfyGateOverrides: state.counts.satisfyGateOverrides,
  };
}

if (require.main === module) {
  try {
    const stats = calculateStats();
    console.log('\n' + formatStats(stats) + '\n');
  } catch (err) {
    console.error('gate-stats error:', err.message);
    process.exit(1);
  }
}

module.exports = {
  calculateStats,
  formatStats,
  formatLastPromotion,
  formatBayesErrorRate,
  formatFirstTimeFixRate,
  computeFirstTimeFixRate,
  loadGatesFile,
  tryComputeBayesErrorRate,
  computeCalibration,
  computeWeeklyBypassStats,
  MANUAL_GATES_PATH,
  STATS_PATH,
};
