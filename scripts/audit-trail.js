#!/usr/bin/env node
'use strict';

/**
 * Audit Trail — OpenShell-inspired governance layer
 *
 * Records every gate decision (allow/deny/warn) into a structured audit log,
 * then auto-feeds deny/warn decisions into the RLHF feedback pipeline as
 * negative signal. This closes the loop: gate blocks → feedback capture →
 * prevention rule generation → stronger gates.
 */

const fs = require('fs');
const path = require('path');

const AUDIT_LOG_FILENAME = 'audit-trail.jsonl';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getAuditLogPath() {
  const feedbackDir = process.env.RLHF_FEEDBACK_DIR
    || path.join(process.cwd(), '.rlhf');
  return path.join(feedbackDir, AUDIT_LOG_FILENAME);
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
 * @param {string} [params.source]   — 'gates-engine' | 'secret-guard' | 'mcp-policy' | 'profile-router'
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
    source: params.source || 'gates-engine',
  };

  fs.appendFileSync(logPath, JSON.stringify(record) + '\n');
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
 * Converts deny/warn audit events into RLHF feedback signal.
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
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  recordAuditEvent,
  auditToFeedback,
  readAuditLog,
  auditStats,
  getAuditLogPath,
  sanitizeToolInput,
  AUDIT_LOG_FILENAME,
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--stats')) {
    console.log(JSON.stringify(auditStats(), null, 2));
  } else {
    const entries = readAuditLog();
    console.log(`Audit trail: ${entries.length} entries`);
    const stats = auditStats();
    console.log(`  allow: ${stats.allow}  warn: ${stats.warn}  deny: ${stats.deny}`);
  }
}
