#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_AUTO_GATES = 10;
const WARN_THRESHOLD = 3; // 3+ repeated failures surface a warning gate
const BLOCK_THRESHOLD = 5; // 5+ repeated failures hard-block the action
const WINDOW_DAYS = 30;

const NEG_SIGNALS = new Set(['negative', 'negative_strong', 'down', 'thumbs_down']);

function getFeedbackLogPath() {
  if (process.env.RLHF_FEEDBACK_DIR) {
    return path.join(process.env.RLHF_FEEDBACK_DIR, 'feedback-log.jsonl');
  }
  const localRlhf = path.join(process.cwd(), '.rlhf', 'feedback-log.jsonl');
  const localClaude = path.join(process.cwd(), '.claude', 'memory', 'feedback', 'feedback-log.jsonl');
  if (fs.existsSync(localRlhf)) return localRlhf;
  if (fs.existsSync(localClaude)) return localClaude;
  return localRlhf; // default even if doesn't exist
}

function getAutoGatesPath() {
  return path.join(path.dirname(getFeedbackLogPath()), 'auto-promoted-gates.json');
}

function readJSONL(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function loadAutoGates() {
  const autoGatesPath = getAutoGatesPath();
  if (!fs.existsSync(autoGatesPath)) {
    return { version: 1, gates: [], promotionLog: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(autoGatesPath, 'utf-8'));
  } catch {
    return { version: 1, gates: [], promotionLog: [] };
  }
}

function saveAutoGates(data) {
  const autoGatesPath = getAutoGatesPath();
  const dir = path.dirname(autoGatesPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(autoGatesPath, JSON.stringify(data, null, 2) + '\n');
}

function isNegative(entry) {
  const sig = (entry.signal || entry.feedback || '').toLowerCase();
  return NEG_SIGNALS.has(sig);
}

function extractPatternKey(entry) {
  // Use tags as primary grouping key; fall back to context normalization
  const tags = (entry.tags || []).filter((t) => !['feedback', 'negative', 'positive'].includes(t));
  if (tags.length > 0) return tags.sort().join('+');

  const ctx = (entry.context || entry.whatWentWrong || '').toLowerCase().trim();
  if (ctx.length < 10) return null;
  // Normalize paths and numbers for grouping
  return ctx.replace(/\/Users\/[^\s/]+/g, '~').replace(/:[0-9]+/g, '').replace(/\s+/g, ' ').slice(0, 100);
}

function extractDiagnosticKeys(entry) {
  const keys = [];
  const diagnosis = entry && entry.diagnosis ? entry.diagnosis : null;
  if (!diagnosis) return keys;

  if (diagnosis.rootCauseCategory) {
    keys.push(`diagnosis:${diagnosis.rootCauseCategory}`);
  }

  const violations = Array.isArray(diagnosis.violations) ? diagnosis.violations : [];
  violations.slice(0, 3).forEach((violation) => {
    const key = violation.constraintId || violation.message;
    if (key) {
      keys.push(`constraint:${key}`);
    }
  });

  return keys;
}

function groupNegativeFeedback(entries, windowDays) {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const groups = {};

  for (const entry of entries) {
    if (!isNegative(entry)) continue;

    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
    if (ts < cutoff) continue;

    const keys = [extractPatternKey(entry), ...extractDiagnosticKeys(entry)]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index);
    if (keys.length === 0) continue;

    for (const key of keys) {
      if (!groups[key]) {
        groups[key] = {
          key,
          count: 0,
          entries: [],
          latestContext: '',
          latestTimestamp: '',
        };
      }
      groups[key].count++;
      groups[key].entries.push(entry);
      if (!groups[key].latestTimestamp || (entry.timestamp && entry.timestamp > groups[key].latestTimestamp)) {
        groups[key].latestTimestamp = entry.timestamp || '';
        groups[key].latestContext = entry.context || entry.whatWentWrong || '';
      }
    }
  }

  return groups;
}

function patternToGateId(key) {
  return 'auto-' + key.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50).toLowerCase();
}

function buildGateRule(group) {
  const action = group.count === 'MANUAL' ? group.manualAction || 'block' : (group.count >= BLOCK_THRESHOLD ? 'block' : 'warn');
  const severity = action === 'block' ? 'critical' : 'medium';
  const context = group.latestContext.slice(0, 120);
  const kind = group.key.startsWith('diagnosis:')
    ? 'repeated diagnosis'
    : group.key.startsWith('constraint:')
      ? 'repeated constraint violation'
      : 'repeated pattern';
  
  const occurrencesText = group.count === 'MANUAL' ? 'manual' : `${group.count} occurrences`;
  const suggestedMessage = `Auto-promoted ${kind}: "${context}" (${occurrencesText} in ${WINDOW_DAYS} days)`;

  return {
    id: patternToGateId(group.key),
    trigger: `auto:${group.key}`,
    pattern: group.key.replace(/^diagnosis:|constraint:/, ''),
    action,
    message: suggestedMessage,
    severity,
    occurrences: group.count,
    promotedAt: new Date().toISOString(),
    source: group.source || 'auto-promote',
  };
}

function forcePromote(context, action = 'block') {
  if (!context) throw new Error('context is required for force-promote');
  const data = loadAutoGates();
  const gateId = patternToGateId(context);
  
  // Remove existing if any
  data.gates = data.gates.filter(g => g.id !== gateId);
  
  const gate = buildGateRule({
    key: context,
    latestContext: context,
    count: 'MANUAL',
    manualAction: action,
    source: 'force-promote'
  });
  data.gates.unshift(gate);
  
  if (data.gates.length > MAX_AUTO_GATES) {
    data.gates = data.gates.slice(0, MAX_AUTO_GATES);
  }

  data.promotionLog = data.promotionLog || [];
  data.promotionLog.push({
    gateId,
    context,
    action,
    promotedAt: new Date().toISOString(),
    source: 'force-promote'
  });

  saveAutoGates(data);
  return { gateId, action, totalGates: data.gates.length };
}

function promote(feedbackLogPath) {
  const logPath = feedbackLogPath || getFeedbackLogPath();
  const entries = readJSONL(logPath);
  const groups = groupNegativeFeedback(entries, WINDOW_DAYS);
  const data = loadAutoGates();
  const existingIds = new Set(data.gates.map((g) => g.id));
  const promotions = [];

  for (const group of Object.values(groups)) {
    if (group.count < WARN_THRESHOLD) continue;

    const gateId = patternToGateId(group.key);

    // Check for existing gate — possibly upgrade
    const existingIdx = data.gates.findIndex((g) => g.id === gateId);
    if (existingIdx !== -1) {
      const existing = data.gates[existingIdx];
      const newAction = group.count >= BLOCK_THRESHOLD ? 'block' : 'warn';
      if (existing.action !== newAction && newAction === 'block') {
        // Upgrade from warn to block
        data.gates[existingIdx] = { ...existing, action: 'block', severity: 'critical', occurrences: group.count, upgradedAt: new Date().toISOString() };
        promotions.push({ type: 'upgrade', gateId, from: existing.action, to: 'block', occurrences: group.count });
      }
      // Update occurrence count even if no action change
      data.gates[existingIdx].occurrences = group.count;
      continue;
    }

    // New gate
    const gate = buildGateRule(group);

    // Enforce max limit — rotate oldest
    if (data.gates.length >= MAX_AUTO_GATES) {
      const removed = data.gates.shift();
      promotions.push({ type: 'rotated', removedGateId: removed.id });
    }

    data.gates.push(gate);
    promotions.push({ type: 'new', gateId: gate.id, action: gate.action, occurrences: group.count });
  }

  // Log promotions
  for (const p of promotions) {
    data.promotionLog = data.promotionLog || [];
    data.promotionLog.push({ ...p, timestamp: new Date().toISOString() });
  }

  saveAutoGates(data);

  return { promotions, totalGates: data.gates.length, data };
}

function runCli(argv = process.argv.slice(2)) {
  const forceContext = argv.find((arg) => arg.startsWith('--force-block='))?.split('=')[1];
  if (forceContext) {
    const result = forcePromote(forceContext, 'block');
    console.log(`Forced block gate created: ${result.gateId}`);
    console.log(`Total auto-promoted gates: ${result.totalGates}`);
    return 0;
  }

  const logPath = argv[0] && !argv[0].startsWith('--') ? argv[0] : undefined;
  const result = promote(logPath);
  if (result.promotions.length === 0) {
    console.log('No new promotions.');
  } else {
    for (const promotion of result.promotions) {
      if (promotion.type === 'new') {
        console.log(`NEW gate: ${promotion.gateId} (${promotion.action}, ${promotion.occurrences} occurrences)`);
      } else if (promotion.type === 'upgrade') {
        console.log(`UPGRADE: ${promotion.gateId} ${promotion.from} -> ${promotion.to} (${promotion.occurrences} occurrences)`);
      } else if (promotion.type === 'rotated') {
        console.log(`ROTATED out: ${promotion.removedGateId}`);
      }
    }
  }
  console.log(`Total auto-promoted gates: ${result.totalGates}`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = runCli();
  } catch (err) {
    console.error('auto-promote-gates error:', err.message);
    process.exit(1);
  }
}

module.exports = {
  promote,
  forcePromote,
  runCli,
  loadAutoGates,
  saveAutoGates,
  getAutoGatesPath,
  groupNegativeFeedback,
  patternToGateId,
  buildGateRule,
  extractPatternKey,
  isNegative,
  MAX_AUTO_GATES,
  WARN_THRESHOLD,
  BLOCK_THRESHOLD,
  WINDOW_DAYS,
};
