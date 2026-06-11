#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');

const MAX_AUTO_GATES = 10;
// 1+ failure auto-promotes to a warning gate. Cold buyers expect "one 👎 → blocked next time"
// — a 2-capture threshold made first-capture invisible and broke the activation loop. Block
// escalation still requires 3 captures (BLOCK_THRESHOLD) so noise doesn't auto-hard-block.
const WARN_THRESHOLD = 1;
const BLOCK_THRESHOLD = 3; // 3+ repeated failures hard-block the action
const WINDOW_DAYS = 30;

// Default TTL on auto-promoted gates. Reddit reviewer @MomSausageandPeppers
// (2026-05-13) flagged that without expiry, "accidental dislikes become policy
// forever." Gates expire 90 days after promotion UNLESS they keep firing —
// every fire refreshes lastFiredAt, and expireGates() keeps any gate fired
// within the last TTL window regardless of original promotion date. Manual
// force-promote bypasses TTL (operator says "permanent"). Override via
// THUMBGATE_RULE_TTL_DAYS env var.
const DEFAULT_RULE_TTL_DAYS = 90;
function getRuleTtlDays() {
  const raw = Number(process.env.THUMBGATE_RULE_TTL_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RULE_TTL_DAYS;
}
function getRuleTtlMs() {
  return getRuleTtlDays() * 24 * 60 * 60 * 1000;
}

const NEG_SIGNALS = new Set(['negative', 'negative_strong', 'down', 'thumbs_down']);

function getFeedbackLogPath() {
  if (process.env.THUMBGATE_FEEDBACK_DIR) {
    return path.join(process.env.THUMBGATE_FEEDBACK_DIR, 'feedback-log.jsonl');
  }
  const localFallback = path.join(process.cwd(), '.thumbgate', 'feedback-log.jsonl');
  const localClaude = path.join(process.cwd(), '.claude', 'memory', 'feedback', 'feedback-log.jsonl');
  if (fs.existsSync(localFallback)) return localFallback;
  if (fs.existsSync(localClaude)) return localClaude;
  // Fall back to resolveFeedbackDir() for proper home-dir resolution
  const resolved = path.join(resolveFeedbackDir(), 'feedback-log.jsonl');
  if (fs.existsSync(resolved)) return resolved;
  return localFallback; // default even if doesn't exist
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

// --- Self-Harness stage 3: regression-gated promotion -----------------------
// Inspired by "Self-Harness: Harnesses That Improve Themselves" (arXiv 2606.09498).
// Stages 1-2 (weakness mining -> rule extraction) already exist via lesson
// inference + this promoter. Stage 3 — accept a harness change only after
// regression-testing it does not degrade behavior — was missing: a noisy 3x
// capture could hard-block an over-broad pattern with no check that it wouldn't
// have wrongly blocked actions that were previously ALLOWED. This replays a
// candidate BLOCK rule against the audit trail's prior `allow` decisions; if it
// would have blocked safe actions, the caller quarantines it to `warn` instead.
const REGRESSION_FALSE_BLOCK_LIMIT = 0; // any prior safe action it would block => quarantine

function getAuditTrailPath() {
  return path.join(path.dirname(getFeedbackLogPath()), 'audit-trail.jsonl');
}

// Returns { falseBlocks, allowSampleSize } or null when there is no history /
// matcher available — in which case the caller promotes as usual (fail-open to
// existing behavior, since regression gating is an enhancement, not a hard gate).
function regressionCheck(gate, options = {}) {
  const auditPath = options.auditTrailPath || getAuditTrailPath();
  const entries = readJSONL(auditPath);
  if (!entries.length) return null;
  // Lazy-require to avoid the gates-engine <-> auto-promote-gates require cycle.
  let matchesGate;
  try { ({ matchesGate } = require('./gates-engine')); } catch { return null; }
  if (typeof matchesGate !== 'function') return null;
  const allowed = entries.filter((e) => e && e.decision === 'allow' && e.toolName);
  if (!allowed.length) return null;
  let falseBlocks = 0;
  for (const e of allowed) {
    try {
      if (matchesGate(gate, e.toolName, e.toolInput || {})) falseBlocks += 1;
    } catch { /* a bad pattern/entry never counts as a false block */ }
  }
  return { falseBlocks, allowSampleSize: allowed.length };
}

function safeRegressionCheck(gate, options) {
  try { return regressionCheck(gate, options); } catch { return null; }
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

/**
 * Normalize a captured command/context string so trivial variants collapse
 * to the same gate signature.
 *
 * Reddit critique (MomSausageandPeppers, 2026-05-17): "commands are matched
 * by string equality, so `rm -rf node_modules` and `rm -rf ./node_modules`
 * create separate gates."
 *
 * Conservative — only collapse variants that are *unambiguously* the same
 * intent. Does NOT reorder flags, strip `&&` chains, or canonicalize
 * subcommands (each can change semantics).
 *
 *  1. Lowercase
 *  2. Strip `/Users/<name>` and `/home/<name>` home-dir prefixes (→ `~`)
 *  3. Drop `:LINE` and `:LINE:COL` refs
 *  4. Per-token: strip one layer of matching outer quotes/backticks
 *  5. Per-token: drop leading `./`
 *  6. Collapse whitespace + trim
 */
function normalizeCommandSignature(input) {
  let text = String(input || '');
  if (!text) return '';
  text = text.toLowerCase();
  text = text.replace(/\/users\/[^\s/]+/g, '~').replace(/\/home\/[^\s/]+/g, '~');
  text = text.replace(/:\d+(?::\d+)?\b/g, '');
  const tokens = text.split(/\s+/).filter(Boolean).map((tok) => {
    let t = tok;
    if (t.length >= 2) {
      const first = t[0];
      const last = t[t.length - 1];
      if ((first === '"' || first === "'" || first === '`') && first === last) {
        t = t.slice(1, -1);
      }
    }
    if (t.startsWith('./')) t = t.slice(2);
    return t;
  }).filter(Boolean);
  return tokens.join(' ').trim();
}

function extractPatternKey(entry) {
  // Use tags as primary grouping key; fall back to context normalization
  const tags = (entry.tags || []).filter((t) => !['feedback', 'negative', 'positive'].includes(t));
  if (tags.length > 0) return tags.sort().join('+');

  const ctx = (entry.context || entry.whatWentWrong || '').trim();
  if (ctx.length < 10) return null;
  return normalizeCommandSignature(ctx).slice(0, 100);
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

function buildGateRule(group, actionOverride) {
  const action = actionOverride || (group.count === 'MANUAL' ? group.manualAction || 'block' : (group.count >= BLOCK_THRESHOLD ? 'block' : 'warn'));
  const severity = action === 'block' ? 'critical' : action === 'approve' ? 'high' : 'medium';
  const context = group.latestContext.slice(0, 120);
  const kind = group.key.startsWith('diagnosis:')
    ? 'repeated diagnosis'
    : group.key.startsWith('constraint:')
      ? 'repeated constraint violation'
      : 'repeated pattern';

  const occurrencesText = group.count === 'MANUAL' ? 'manual' : `${group.count} occurrences`;
  const suggestedMessage = `Auto-promoted ${kind}: "${context}" (${occurrencesText} in ${WINDOW_DAYS} days)`;

  // TTL: auto-promoted rules expire after the configured window unless
  // refreshed by a fresh fire. Manual force-promote bypasses TTL — operator
  // says "permanent" by going through the force path.
  const nowMs = Date.now();
  const isManual = group.count === 'MANUAL';
  const expiresAt = isManual ? null : new Date(nowMs + getRuleTtlMs()).toISOString();

  return {
    id: patternToGateId(group.key),
    trigger: `auto:${group.key}`,
    pattern: group.key.replace(/^diagnosis:|constraint:/, ''),
    action,
    message: suggestedMessage,
    severity,
    occurrences: group.count,
    promotedAt: new Date().toISOString(),
    expiresAt,
    lastFiredAt: null,
    source: group.source || 'auto-promote',
  };
}

/**
 * Drop expired gates from the data and return the gates removed.
 *
 * A gate is expired when its `expiresAt` is in the past AND its
 * `lastFiredAt` (if set) is also outside the TTL window — high-signal
 * gates that keep firing get continuously renewed and never expire.
 *
 * `expiresAt: null` is treated as "permanent" (used by force-promote /
 * legacy gates without TTL data).
 */
function expireGates(data, now = Date.now()) {
  const safeData = data && typeof data === 'object'
    ? { version: data.version || 1, gates: Array.isArray(data.gates) ? data.gates : [], promotionLog: Array.isArray(data.promotionLog) ? data.promotionLog : [] }
    : { version: 1, gates: [], promotionLog: [] };
  const ttlMs = getRuleTtlMs();
  const kept = [];
  const expired = [];
  for (const gate of safeData.gates) {
    if (!gate || typeof gate !== 'object') continue;
    // No expiresAt → treat as permanent (manual force-promote, legacy gates).
    if (gate.expiresAt == null) {
      kept.push(gate);
      continue;
    }
    const expiresMs = Date.parse(gate.expiresAt);
    if (!Number.isFinite(expiresMs)) {
      kept.push(gate);
      continue;
    }
    // If last fire is within TTL window, refresh the gate (extend expiresAt).
    const lastFiredMs = gate.lastFiredAt ? Date.parse(gate.lastFiredAt) : NaN;
    if (Number.isFinite(lastFiredMs) && now - lastFiredMs < ttlMs) {
      kept.push({ ...gate, expiresAt: new Date(lastFiredMs + ttlMs).toISOString() });
      continue;
    }
    if (now < expiresMs) {
      kept.push(gate);
    } else {
      expired.push({ id: gate.id, expiresAt: gate.expiresAt, lastFiredAt: gate.lastFiredAt });
    }
  }
  safeData.gates = kept;
  if (expired.length > 0) {
    safeData.promotionLog.push(
      ...expired.map((e) => ({ type: 'expired', gateId: e.id, expiredAt: e.expiresAt, timestamp: new Date(now).toISOString() }))
    );
  }
  return { data: safeData, expired };
}

/**
 * Mark a gate as fired now. Refreshes lastFiredAt AND extends expiresAt by
 * the full TTL — a gate that keeps catching repeats sharpens, doesn't
 * decay. Caller passes the gate ID; returns the updated gate (or null).
 */
function recordGateFire(data, gateId, now = Date.now()) {
  if (!data || !Array.isArray(data.gates)) return null;
  const idx = data.gates.findIndex((g) => g && g.id === gateId);
  if (idx === -1) return null;
  const gate = data.gates[idx];
  const lastFiredAtIso = new Date(now).toISOString();
  const updated = {
    ...gate,
    lastFiredAt: lastFiredAtIso,
    expiresAt: gate.expiresAt == null ? null : new Date(now + getRuleTtlMs()).toISOString(),
  };
  data.gates[idx] = updated;
  return updated;
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

function promote(feedbackLogPath, options) {
  const opts = options || {};
  const logPath = feedbackLogPath || getFeedbackLogPath();
  const entries = readJSONL(logPath);
  const groups = groupNegativeFeedback(entries, WINDOW_DAYS);
  // Expire stale gates BEFORE running the promotion loop so an expiring
  // gate that's about to be re-promoted gets a fresh TTL via the normal
  // path rather than carrying a near-stale expiresAt.
  const { data: expiredData, expired } = expireGates(loadAutoGates());
  const data = expiredData;
  if (expired.length > 0) {
    saveAutoGates(data);
  }
  const promotions = expired.map((e) => ({ type: 'expired', gateId: e.id, expiredAt: e.expiresAt }));

  for (const group of Object.values(groups)) {
    if (group.count < WARN_THRESHOLD) continue;

    const gateId = patternToGateId(group.key);

    // Check for existing gate — possibly upgrade
    const existingIdx = data.gates.findIndex((g) => g.id === gateId);
    if (existingIdx !== -1) {
      const existing = data.gates[existingIdx];
      const newAction = group.count >= BLOCK_THRESHOLD ? 'block' : 'warn';
      if (existing.action !== newAction && newAction === 'block') {
        // Self-Harness stage 3: regression-test before upgrading warn -> block.
        const regression = opts.skipRegression ? null : safeRegressionCheck(buildGateRule(group, 'block'), opts);
        if (regression && regression.falseBlocks > REGRESSION_FALSE_BLOCK_LIMIT) {
          // Would block prior safe actions — hold at warn instead of upgrading.
          promotions.push({ type: 'upgrade-quarantined', gateId, from: existing.action, occurrences: group.count, falseBlocks: regression.falseBlocks });
        } else {
          // Upgrade from warn to block
          data.gates[existingIdx] = { ...existing, action: 'block', severity: 'critical', occurrences: group.count, upgradedAt: new Date().toISOString() };
          promotions.push({ type: 'upgrade', gateId, from: existing.action, to: 'block', occurrences: group.count });
        }
      }
      // Update occurrence count even if no action change
      data.gates[existingIdx].occurrences = group.count;
      continue;
    }

    // New gate — respect explicit gateAction override (e.g. 'approve' for human-approval rules)
    const gate = buildGateRule(group, opts.gateAction);

    // Self-Harness stage 3: before a feedback rule goes live as a hard block,
    // regression-test it against prior allowed actions. If it would have blocked
    // safe actions, quarantine it to `warn` instead of `block`.
    let regression = null;
    if (gate.action === 'block' && !opts.gateAction && !opts.skipRegression) {
      regression = safeRegressionCheck(gate, opts);
      if (regression && regression.falseBlocks > REGRESSION_FALSE_BLOCK_LIMIT) {
        gate.action = 'warn';
        gate.severity = 'medium';
        gate.quarantined = true;
        gate.regression = regression;
      }
    }

    // Enforce max limit — rotate oldest
    if (data.gates.length >= MAX_AUTO_GATES) {
      const removed = data.gates.shift();
      promotions.push({ type: 'rotated', removedGateId: removed.id });
    }

    data.gates.push(gate);
    promotions.push({
      type: gate.quarantined ? 'new-quarantined' : 'new',
      gateId: gate.id,
      action: gate.action,
      occurrences: group.count,
      ...(gate.quarantined ? { falseBlocks: regression.falseBlocks, allowSampleSize: regression.allowSampleSize } : {}),
    });
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
  regressionCheck,
  getAuditTrailPath,
  REGRESSION_FALSE_BLOCK_LIMIT,
  extractPatternKey,
  normalizeCommandSignature,
  isNegative,
  expireGates,
  recordGateFire,
  getRuleTtlDays,
  getRuleTtlMs,
  MAX_AUTO_GATES,
  WARN_THRESHOLD,
  BLOCK_THRESHOLD,
  WINDOW_DAYS,
  DEFAULT_RULE_TTL_DAYS,
};
