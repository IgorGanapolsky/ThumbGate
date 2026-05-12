#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { getAutoGatesPath } = require('./auto-promote-gates');
const { computeBayesErrorRate } = require('./bayes-optimal-gate');
const { sequencePathFor } = require('./risk-scorer');

const PROJECT_ROOT = path.join(__dirname, '..');
const MANUAL_GATES_PATH = path.join(PROJECT_ROOT, 'config', 'gates', 'default.json');

function loadGatesFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return data.gates || [];
  } catch {
    return [];
  }
}

function calculateStats() {
  const autoGatesPath = getAutoGatesPath();
  const manualGates = loadGatesFile(MANUAL_GATES_PATH);
  const autoGates = loadGatesFile(autoGatesPath);
  const allGates = [...manualGates, ...autoGates];

  let autoPromotedData = { promotionLog: [] };
  if (fs.existsSync(autoGatesPath)) {
    try { autoPromotedData = JSON.parse(fs.readFileSync(autoGatesPath, 'utf-8')); } catch {}
  }
  const promotionLog = autoPromotedData.promotionLog || [];

  const blockGates = allGates.filter((g) => g.action === 'block');
  const warnGates = allGates.filter((g) => g.action === 'warn');

  // Count total blocks/warns from occurrences in auto-promoted gates
  const totalBlocked = autoGates
    .filter((g) => g.action === 'block')
    .reduce((sum, g) => sum + (g.occurrences || 0), 0);
  const totalWarned = autoGates
    .filter((g) => g.action === 'warn')
    .reduce((sum, g) => sum + (g.occurrences || 0), 0);

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

  // Time saved estimate: ~15 min per blocked mistake
  const estimatedMinutesSaved = (totalBlocked + totalWarned) * 15;
  const estimatedHoursSaved = (estimatedMinutesSaved / 60).toFixed(1);

  // Bayes error rate: irreducible error floor of the current scorer given its
  // feature set (tag signatures). It is only meaningful when the local sample
  // contains both harmful and safe outcomes; an all-negative or all-positive
  // sample can produce a misleading 0.0% floor.
  const bayesErrorRate = tryComputeBayesErrorRate();

  return {
    totalGates: allGates.length,
    manualGates: manualGates.length,
    autoPromotedGates: autoGates.length,
    blockGates: blockGates.length,
    warnGates: warnGates.length,
    totalBlocked,
    totalWarned,
    topBlocked,
    lastPromotion,
    estimatedHoursSaved,
    bayesErrorRate,
    gates: allGates,
  };
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

function formatStats(stats) {
  const lines = [];
  lines.push('Gate Statistics');
  lines.push('─'.repeat(38));
  lines.push(`  Active gates: ${stats.totalGates} (${stats.manualGates} manual, ${stats.autoPromotedGates} auto-promoted)`);
  lines.push(`  Actions blocked: ${stats.totalBlocked}`);
  lines.push(`  Actions warned: ${stats.totalWarned}`);
  lines.push(`  Top blocked gate: ${stats.topBlocked ? `${stats.topBlocked.id} (${stats.topBlocked.occurrences || 0} blocks)` : 'none'}`);
  lines.push(`  Last promotion: ${formatLastPromotion(stats.lastPromotion)}`);
  lines.push(`  Estimated time saved: ~${stats.estimatedHoursSaved} hours`);
  lines.push(`  Bayes error rate: ${formatBayesErrorRate(stats.bayesErrorRate)}`);
  return lines.join('\n');
}

function formatBayesErrorRate(rate) {
  if (rate === null || rate === undefined) return 'n/a (need both safe and harmful feedback sequences)';
  const pct = (rate * 100).toFixed(1);
  if (rate < 0.02) return `${pct}% — scorer is near-optimal; add features, don't tune thresholds`;
  if (rate < 0.10) return `${pct}% — scorer has modest headroom`;
  return `${pct}% — high irreducible error; the feature set can't discriminate`;
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
  loadGatesFile,
  tryComputeBayesErrorRate,
  MANUAL_GATES_PATH,
};
