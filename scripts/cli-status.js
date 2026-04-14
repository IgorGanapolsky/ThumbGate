#!/usr/bin/env node
'use strict';

/**
 * cli-status.js — agent-friendly health check for ThumbGate.
 *
 * Combines feedback stats, gate stats, lesson count, and agent detection
 * into a single JSON-friendly payload.
 */

const fs = require('fs');
const path = require('path');

function detectAgent(projectDir) {
  if (fs.existsSync(path.join(projectDir, '.claude'))) return 'claude-code';
  if (fs.existsSync(path.join(projectDir, '.cursorrules'))) return 'cursor';
  if (fs.existsSync(path.join(projectDir, '.cursor'))) return 'cursor';
  if (fs.existsSync(path.join(projectDir, '.codex'))) return 'codex';
  if (fs.existsSync(path.join(projectDir, '.gemini'))) return 'gemini';
  if (fs.existsSync(path.join(projectDir, '.amp'))) return 'amp';
  return null;
}

function generateAgentStatus(options = {}) {
  const PKG_ROOT = options.pkgRoot || path.join(__dirname, '..');
  const projectDir = options.projectDir || process.cwd();

  // Feedback paths
  const { getFeedbackPaths, readJSONL, analyzeFeedback } = require(path.join(PKG_ROOT, 'scripts', 'feedback-loop'));
  const paths = getFeedbackPaths();

  // Feedback entries
  const feedbackEntries = readJSONL(paths.FEEDBACK_LOG_PATH);
  const memoryEntries = readJSONL(paths.MEMORY_LOG_PATH);

  // Gate stats
  let gateData = { totalGates: 0, autoPromotedGates: 0, manualGates: 0, totalBlocked: 0 };
  try {
    const { calculateStats } = require(path.join(PKG_ROOT, 'scripts', 'gate-stats'));
    gateData = calculateStats();
  } catch { /* gate-stats not available */ }

  // Prevention rules count
  let preventionRuleCount = 0;
  if (fs.existsSync(paths.PREVENTION_RULES_PATH)) {
    const rulesContent = fs.readFileSync(paths.PREVENTION_RULES_PATH, 'utf-8');
    const ruleHeaders = rulesContent.match(/^## /gm);
    preventionRuleCount = ruleHeaders ? ruleHeaders.length : 0;
  }

  // Last feedback timestamp
  const lastFeedback = feedbackEntries.length > 0
    ? feedbackEntries[feedbackEntries.length - 1]
    : null;
  const lastFeedbackTimestamp = lastFeedback
    ? (lastFeedback.timestamp || lastFeedback.createdAt || null)
    : null;

  // Agent detection
  const agent = detectAgent(projectDir);

  // Enforcement check: is there at least one blocking gate?
  const hasBlockingGates = gateData.totalGates > 0;
  const hasPreToolHook = (() => {
    try {
      const settingsPath = path.join(projectDir, '.claude', 'settings.json');
      if (!fs.existsSync(settingsPath)) return false;
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return Boolean(
        settings.hooks &&
        settings.hooks.PreToolUse &&
        settings.hooks.PreToolUse.length > 0
      );
    } catch { return false; }
  })();
  const enforcementActive = hasBlockingGates || hasPreToolHook;

  // Config
  const configPath = path.join(projectDir, '.thumbgate', 'config.json');
  let config = null;
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch { /* ignore */ }

  // Version
  let version = 'unknown';
  try {
    version = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version;
  } catch { /* ignore */ }

  return {
    version,
    agent,
    enforcementActive,
    gates: {
      total: gateData.totalGates,
      manual: gateData.manualGates,
      autoPromoted: gateData.autoPromotedGates,
      blocking: gateData.blockGates || 0,
      warning: gateData.warnGates || 0,
    },
    lessons: memoryEntries.length,
    feedback: {
      total: feedbackEntries.length,
      positive: feedbackEntries.filter(e => e.signal === 'positive').length,
      negative: feedbackEntries.filter(e => e.signal === 'negative').length,
    },
    preventionRules: preventionRuleCount,
    lastFeedbackTimestamp,
    feedbackDir: paths.FEEDBACK_DIR,
    initialized: Boolean(config),
  };
}

function formatStatus(data) {
  const BD = '\x1b[1m';
  const RST = '\x1b[0m';
  const G = '\x1b[32m';
  const R = '\x1b[31m';
  const C = '\x1b[36m';
  const Y = '\x1b[33m';
  const D = '\x1b[90m';

  const lines = [];
  lines.push('');
  lines.push(`${BD}thumbgate status${RST}  v${data.version}`);
  lines.push('─'.repeat(50));

  // Scope badge
  const scope = '[LOCAL]';
  lines.push(`  ${C}${scope}${RST} ${data.feedbackDir}`);
  lines.push('');

  // Core metrics
  const enfBadge = data.enforcementActive
    ? `${G}[ACTIVE]${RST}`
    : `${Y}[LEARNING]${RST}`;
  lines.push(`  Enforcement     : ${enfBadge}`);
  lines.push(`  Agent           : ${data.agent || 'none detected'}`);
  lines.push(`  Gates           : ${data.gates.total} (${data.gates.blocking} block, ${data.gates.warning} warn)`);
  lines.push(`  Lessons         : ${data.lessons}`);
  lines.push(`  Prevention Rules: ${data.preventionRules}`);
  lines.push('');
  lines.push(`  Feedback        : ${data.feedback.total} total (${G}${data.feedback.positive} up${RST}, ${R}${data.feedback.negative} down${RST})`);
  if (data.lastFeedbackTimestamp) {
    const ago = relativeTime(data.lastFeedbackTimestamp);
    lines.push(`  Last Feedback   : ${ago} ${D}(${data.lastFeedbackTimestamp})${RST}`);
  } else {
    lines.push(`  Last Feedback   : ${D}none${RST}`);
  }
  lines.push('');

  return lines.join('\n');
}

function relativeTime(ts) {
  if (!ts) return '';
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return '1 day ago';
  return `${d} days ago`;
}

module.exports = { generateAgentStatus, formatStatus };
