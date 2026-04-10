#!/usr/bin/env node
'use strict';

/**
 * Audit Trail — OpenShell-inspired governance layer
 *
 * Records every gate decision (allow/deny/warn) into a structured audit log,
 * then auto-feeds deny/warn decisions into the ThumbGate feedback pipeline as
 * negative signal. This closes the loop: gate blocks → feedback capture →
 * prevention rule generation → stronger gates.
 */

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');

const AUDIT_LOG_FILENAME = 'audit-trail.jsonl';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getAuditLogPath() {
  return path.join(resolveFeedbackDir(), AUDIT_LOG_FILENAME);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Core audit record
// ---------------------------------------------------------------------------

/**
 * @param {object} params
 * @param {string} params.toolName   — tool that was evaluated
 * @param {object} params.toolInput  — the tool input payload
 * @param {string} params.decision   — 'allow' | 'deny' | 'warn'
 * @param {string} [params.gateId]   — which gate matched (null for allow)
 * @param {string} [params.message]  — gate message
 * @param {string} [params.severity] — gate severity
 * @param {number} [params.latencyMs] — tool execution time in milliseconds
 * @param {string} [params.source]   — 'gates-engine' | 'secret-guard' | 'mcp-policy' | 'profile-router' | 'tool-latency'
 * @returns {object} the stored audit record
 */
function recordAuditEvent(params = {}) {
  const logPath = getAuditLogPath();
  ensureDir(path.dirname(logPath));

  const record = {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    toolName: params.toolName || 'unknown',
    toolInput: sanitizeToolInput(params.toolInput || {}),
    decision: params.decision || 'allow',
    gateId: params.gateId || null,
    message: params.message || null,
    severity: params.severity || null,
    latencyMs: typeof params.latencyMs === 'number' ? params.latencyMs : null,
    source: params.source || 'gates-engine',
  };

  fs.appendFileSync(logPath, JSON.stringify(record) + '\n');
  try {
    const { trainAndPersistInterventionPolicy } = require('./intervention-policy');
    trainAndPersistInterventionPolicy(path.dirname(logPath));
  } catch {
    // Keep audit recording resilient even if the learned policy refresh fails.
  }
  return record;
}

/**
 * Strip secrets and large payloads from tool input before audit storage.
 */
function sanitizeToolInput(toolInput) {
  const safe = {};
  const MAX_VALUE_LEN = 200;

  for (const [key, value] of Object.entries(toolInput)) {
    if (typeof value === 'string') {
      // Never log content/new_string/old_string verbatim — could contain secrets
      if (['content', 'new_string', 'old_string'].includes(key)) {
        safe[key] = `[redacted:${value.length} chars]`;
      } else {
        safe[key] = value.length > MAX_VALUE_LEN
          ? value.slice(0, MAX_VALUE_LEN) + '...'
          : value;
      }
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

// ---------------------------------------------------------------------------
// Auto-feedback from audit events
// ---------------------------------------------------------------------------

/**
 * Converts deny/warn audit events into ThumbGate feedback signal.
 * This is the core OpenShell insight: policy decisions ARE training signal.
 */
function auditToFeedback(auditRecord) {
  if (auditRecord.decision === 'allow') return null;

  try {
    const feedbackLoop = require('./feedback-loop');
    const signal = auditRecord.decision === 'deny' ? 'down' : 'down';
    const context = `Gate "${auditRecord.gateId}" ${auditRecord.decision === 'deny' ? 'blocked' : 'warned'} tool "${auditRecord.toolName}": ${auditRecord.message || 'no message'}`;

    return feedbackLoop.captureFeedback({
      signal,
      context,
      what_went_wrong: `Agent attempted action blocked by policy gate: ${auditRecord.gateId}`,
      what_to_change: auditRecord.message || 'Follow safety policy before attempting this action',
      tags: ['audit-trail', 'auto-capture', `gate:${auditRecord.gateId}`, auditRecord.source].filter(Boolean),
      title: `MISTAKE: Policy violation — ${auditRecord.gateId}`,
    });
  } catch {
    // Feedback capture failure should never break the audit trail
    return null;
  }
}

// ---------------------------------------------------------------------------
// Read / query audit log
// ---------------------------------------------------------------------------

function readAuditLog(logPath) {
  const p = logPath || getAuditLogPath();
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').map(line => {
    try { return JSON.parse(line); }
    catch { return null; }
  }).filter(Boolean);
}

function auditStats(logPath) {
  const entries = readAuditLog(logPath);
  const stats = { total: entries.length, allow: 0, deny: 0, warn: 0, byGate: {}, bySource: {} };

  for (const entry of entries) {
    stats[entry.decision] = (stats[entry.decision] || 0) + 1;
    if (entry.gateId) {
      if (!stats.byGate[entry.gateId]) stats.byGate[entry.gateId] = { deny: 0, warn: 0, allow: 0 };
      stats.byGate[entry.gateId][entry.decision] = (stats.byGate[entry.gateId][entry.decision] || 0) + 1;
    }
    if (entry.source) {
      stats.bySource[entry.source] = (stats.bySource[entry.source] || 0) + 1;
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Skill Adherence Measurement (M2.7-inspired)
// ---------------------------------------------------------------------------

/**
 * Computes skill adherence rate per tool from audit trail data.
 * Adherence = allow / (allow + deny + warn) per tool.
 * M2.7 tracks "97% skill adherence across 40+ skills" — this gives us the same metric.
 *
 * @param {string} [logPath]
 * @returns {{ overall: number, byTool: Object<string, { allow: number, deny: number, warn: number, adherence: number }>, totalTools: number }}
 */
function skillAdherence(logPath) {
  const entries = readAuditLog(logPath);
  const byTool = {};

  for (const entry of entries) {
    const tool = entry.toolName || 'unknown';
    if (!byTool[tool]) byTool[tool] = { allow: 0, deny: 0, warn: 0 };
    byTool[tool][entry.decision] = (byTool[tool][entry.decision] || 0) + 1;
  }

  let totalAllow = 0;
  let totalAll = 0;
  for (const [, counts] of Object.entries(byTool)) {
    const all = counts.allow + counts.deny + counts.warn;
    counts.adherence = all > 0 ? Math.round((counts.allow / all) * 10000) / 100 : 100;
    totalAllow += counts.allow;
    totalAll += all;
  }

  return {
    overall: totalAll > 0 ? Math.round((totalAllow / totalAll) * 10000) / 100 : 100,
    byTool,
    totalTools: Object.keys(byTool).length,
  };
}

// ---------------------------------------------------------------------------
// Deny-triggered self-heal (M2.7 self-evolution loop)
// ---------------------------------------------------------------------------

/**
 * Checks if recent audit denials exceed a threshold, triggering autonomous self-heal.
 * This closes the M2.7-inspired loop: audit deny → self-heal → eval → keep/revert.
 *
 * @param {object} [opts]
 * @param {number} [opts.windowMs=300000] — lookback window (default 5 min)
 * @param {number} [opts.denyThreshold=3] — denials in window to trigger heal
 * @param {string} [opts.logPath]
 * @returns {{ triggered: boolean, recentDenials: number, threshold: number, healResult?: object }}
 */
function evaluateSelfHealTrigger(opts = {}) {
  const windowMs = opts.windowMs || 5 * 60 * 1000;
  const denyThreshold = opts.denyThreshold || 3;
  const entries = readAuditLog(opts.logPath);
  const cutoff = Date.now() - windowMs;

  const recentDenials = entries.filter(e =>
    e.decision === 'deny' && new Date(e.timestamp).getTime() > cutoff
  );

  if (recentDenials.length < denyThreshold) {
    return { triggered: false, recentDenials: recentDenials.length, threshold: denyThreshold };
  }

  // Threshold exceeded — trigger self-heal
  let healResult = null;
  try {
    const { runSelfHeal } = require('./self-heal');
    const uniqueGates = [...new Set(recentDenials.map(d => d.gateId).filter(Boolean))];
    healResult = runSelfHeal({
      reason: `audit-trail: ${recentDenials.length} denials in ${windowMs / 1000}s (gates: ${uniqueGates.join(', ')})`,
    });
  } catch {
    healResult = { error: 'self-heal module unavailable' };
  }

  return {
    triggered: true,
    recentDenials: recentDenials.length,
    threshold: denyThreshold,
    gates: [...new Set(recentDenials.map(d => d.gateId).filter(Boolean))],
    healResult,
  };
}

// ---------------------------------------------------------------------------
// Semantic cache threshold auto-tuning
// ---------------------------------------------------------------------------

const CACHE_TUNE_STATE_FILENAME = 'cache-tune-state.json';

/**
 * Auto-tunes THUMBGATE_SEMANTIC_CACHE_THRESHOLD based on audit trail feedback.
 * If deny rate is high → tighten cache (raise threshold, fewer false hits).
 * If deny rate is low → loosen cache (lower threshold, more cache hits).
 *
 * @param {string} [logPath]
 * @returns {{ currentThreshold: number, recommendedThreshold: number, denyRate: number, applied: boolean }}
 */
function tuneCacheThreshold(logPath) {
  const stats = auditStats(logPath);
  const total = stats.total || 1;
  const denyRate = stats.deny / total;

  const currentThreshold = parseFloat(process.env.THUMBGATE_SEMANTIC_CACHE_THRESHOLD || '0.7');
  const MIN_THRESHOLD = 0.5;
  const MAX_THRESHOLD = 0.95;
  const STEP = 0.02;

  // High deny rate (>20%) → agent is hitting gates often → tighten cache to reduce hallucinated recalls
  // Low deny rate (<5%) → agent is compliant → loosen cache for more hits and cost savings
  let recommended = currentThreshold;
  if (denyRate > 0.20) {
    recommended = Math.min(currentThreshold + STEP, MAX_THRESHOLD);
  } else if (denyRate < 0.05 && total > 10) {
    recommended = Math.max(currentThreshold - STEP, MIN_THRESHOLD);
  }
  recommended = Math.round(recommended * 100) / 100;

  // Persist tuning state
  const statePath = path.join(path.dirname(getAuditLogPath()), CACHE_TUNE_STATE_FILENAME);
  const tuneRecord = {
    timestamp: new Date().toISOString(),
    currentThreshold,
    recommendedThreshold: recommended,
    denyRate: Math.round(denyRate * 10000) / 100,
    totalEvents: stats.total,
  };

  try {
    ensureDir(path.dirname(statePath));
    fs.writeFileSync(statePath, JSON.stringify(tuneRecord, null, 2) + '\n');
  } catch { /* non-critical */ }

  return {
    currentThreshold,
    recommendedThreshold: recommended,
    denyRate: Math.round(denyRate * 10000) / 100,
    applied: recommended !== currentThreshold,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  recordAuditEvent,
  auditToFeedback,
  readAuditLog,
  auditStats,
  latencyStats,
  skillAdherence,
  evaluateSelfHealTrigger,
  tuneCacheThreshold,
  getAuditLogPath,
  sanitizeToolInput,
  AUDIT_LOG_FILENAME,
  CACHE_TUNE_STATE_FILENAME,
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Compute latency statistics from audit trail entries that have latencyMs.
 * @param {string} [logPath]
 * @returns {{ count: number, avgMs: number, p50Ms: number, p95Ms: number, p99Ms: number, maxMs: number, slowest: Array }}
 */
function latencyStats(logPath) {
  const entries = readAuditLog(logPath);
  const withLatency = entries.filter(e => typeof e.latencyMs === 'number');
  if (withLatency.length === 0) return { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, slowest: [] };

  const sorted = withLatency.map(e => e.latencyMs).sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const percentile = (arr, p) => arr[Math.min(Math.ceil(arr.length * p) - 1, arr.length - 1)];

  // Per-tool breakdown
  const byTool = {};
  for (const e of withLatency) {
    const tool = e.toolName || 'unknown';
    if (!byTool[tool]) byTool[tool] = [];
    byTool[tool].push(e.latencyMs);
  }
  const toolStats = {};
  for (const [tool, latencies] of Object.entries(byTool)) {
    const s = latencies.sort((a, b) => a - b);
    toolStats[tool] = {
      count: s.length,
      avgMs: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
      p95Ms: percentile(s, 0.95),
      maxMs: s[s.length - 1],
    };
  }

  // Top 5 slowest calls
  const slowest = withLatency
    .sort((a, b) => b.latencyMs - a.latencyMs)
    .slice(0, 5)
    .map(e => ({ tool: e.toolName, latencyMs: e.latencyMs, timestamp: e.timestamp }));

  return {
    count: sorted.length,
    avgMs: Math.round(sum / sorted.length),
    p50Ms: percentile(sorted, 0.50),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted[sorted.length - 1],
    byTool: toolStats,
    slowest,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--stats')) {
    console.log(JSON.stringify(auditStats(), null, 2));
  } else if (args.includes('--adherence')) {
    console.log(JSON.stringify(skillAdherence(), null, 2));
  } else if (args.includes('--self-heal')) {
    console.log(JSON.stringify(evaluateSelfHealTrigger(), null, 2));
  } else if (args.includes('--tune-cache')) {
    console.log(JSON.stringify(tuneCacheThreshold(), null, 2));
  } else if (args.includes('--latency')) {
    console.log(JSON.stringify(latencyStats(), null, 2));
  } else {
    const entries = readAuditLog();
    const adherence = skillAdherence();
    console.log(`Audit trail: ${entries.length} entries`);
    const stats = auditStats();
    console.log(`  allow: ${stats.allow}  warn: ${stats.warn}  deny: ${stats.deny}`);
    console.log(`  skill adherence: ${adherence.overall}% across ${adherence.totalTools} tools`);
    const lat = latencyStats();
    if (lat.count > 0) {
      console.log(`  latency: avg=${lat.avgMs}ms  p95=${lat.p95Ms}ms  max=${lat.maxMs}ms  (${lat.count} samples)`);
    }
  }
}
