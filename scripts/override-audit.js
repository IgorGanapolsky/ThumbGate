'use strict';

/**
 * override-audit.js — typed, first-class audit records for gate overrides.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this module, an override left one of two traces:
 *
 *   1. Via the MCP tool  -> a generic tool-call row in audit-trail.jsonl with
 *      toolName "satisfy_gate", indistinguishable by TYPE from every Bash call.
 *   2. Via the CLI       -> `satisfyCondition()` wrote ONLY to the gate state
 *      store. Nothing reached the audit trail at all. The override was invisible.
 *
 * Path 2 is the dangerous one: it is exactly the path an agent falls back to
 * when the MCP tool is unavailable, so the least-supervised override was also
 * the least-recorded one. An override log that misses overrides is worse than
 * none, because it reads as completeness.
 *
 * This module gives overrides a typed shape (decision "override") that can be
 * filtered, counted, and rendered, no matter which path produced them.
 */

const fs = require('node:fs');
const path = require('node:path');

const { recordAuditEvent, getAuditLogPath } = require('./audit-trail');

/** Marker written into every override record. */
const OVERRIDE_DECISION = 'override';
const OVERRIDE_TOOL_NAME = 'gate-override';

/** Where the override came from. Unknown callers are recorded, never dropped. */
const SOURCES = Object.freeze(['mcp', 'cli', 'break-glass', 'api', 'unknown']);

function normalizeSource(source) {
  if (typeof source !== 'string') return 'unknown';
  const lower = source.trim().toLowerCase();
  return SOURCES.includes(lower) ? lower : 'unknown';
}

/**
 * Truncate free text so a pathological evidence blob cannot bloat the log.
 * Truncation is marked so a reader never mistakes a cut string for the whole.
 */
function clip(value, max = 2000) {
  if (typeof value !== 'string') return null;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[truncated ${value.length - max} chars]`;
}

function normalizeReasoning(reasoning) {
  if (!reasoning || typeof reasoning !== 'object' || Array.isArray(reasoning)) return null;
  const out = {
    premise: clip(reasoning.premise, 1000),
    evidence: clip(reasoning.evidence, 1000),
    risk: clip(reasoning.risk, 1000),
    conclusion: clip(reasoning.conclusion, 1000),
  };
  // An object of four nulls is noise, not reasoning.
  return Object.values(out).some((v) => v !== null) ? out : null;
}

/**
 * Record one gate override.
 *
 * Never throws: an audit failure must not also break the caller's control flow,
 * or a broken log would become a reason to skip recording entirely.
 *
 * @returns {object|null} the stored record, or null if recording failed
 */
function recordOverride(params = {}) {
  const gateId = typeof params.gateId === 'string' && params.gateId.trim() ? params.gateId.trim() : null;
  if (!gateId) return null; // an override with no gate is not attributable

  const override = {
    gateId,
    source: normalizeSource(params.source),
    actor: clip(params.actor, 200) || 'agent',
    reason: clip(params.reason),
    evidence: clip(params.evidence),
    structuredReasoning: normalizeReasoning(params.structuredReasoning),
    // A reasoned override is materially different from a bare one. Surface it
    // as a first-class field so the panel can rank unreasoned overrides first.
    reasoned: Boolean(normalizeReasoning(params.structuredReasoning)),
    ttlMs: Number.isFinite(params.ttlMs) ? params.ttlMs : null,
    pathGlobs: Array.isArray(params.pathGlobs) ? params.pathGlobs.slice(0, 50).map(String) : null,
  };

  try {
    return recordAuditEvent({
      toolName: OVERRIDE_TOOL_NAME,
      toolInput: { gateId, source: override.source },
      decision: OVERRIDE_DECISION,
      gateId,
      message: override.reason || `Override of ${gateId}`,
      severity: 'high',
      source: 'override-audit',
      override,
    });
  } catch {
    return null;
  }
}

function resolveLogPath(logPath) {
  if (logPath) return logPath;
  try {
    return getAuditLogPath();
  } catch {
    return null;
  }
}

/**
 * Read typed override records, newest first.
 *
 * Reads the tail of the file rather than the whole thing: audit logs reach
 * hundreds of MB and a panel must not allocate the entire history to show 50 rows.
 */
function readOverrides(options = {}) {
  const logPath = resolveLogPath(options.logPath);
  if (!logPath || !fs.existsSync(logPath)) return [];

  const limit = Number.isFinite(options.limit) ? Math.max(0, options.limit) : 100;
  if (limit === 0) return [];
  const sinceMs = Number.isFinite(options.sinceMs) ? options.sinceMs : null;
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : 8 * 1024 * 1024;

  let text = '';
  let fd;
  try {
    const { size } = fs.statSync(logPath);
    if (size === 0) return [];
    const readBytes = Math.min(size, maxBytes);
    const buf = Buffer.alloc(readBytes);
    fd = fs.openSync(logPath, 'r');
    fs.readSync(fd, buf, 0, readBytes, size - readBytes);
    text = buf.toString('utf8');
    if (readBytes < size) {
      const nl = text.indexOf('\n');
      text = nl === -1 ? '' : text.slice(nl + 1); // drop the partial first record
    }
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }

  const out = [];
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const line = lines[i];
    if (!line) continue;
    // Cheap reject before JSON.parse — most rows are not overrides.
    if (!line.includes(`"${OVERRIDE_DECISION}"`)) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // a corrupt line must not abort the scan
    }
    if (!rec || rec.decision !== OVERRIDE_DECISION || !rec.override) continue;
    if (sinceMs !== null) {
      const ts = Date.parse(rec.timestamp);
      if (Number.isFinite(ts) && ts < sinceMs) continue;
    }
    out.push(rec);
  }
  return out;
}

/**
 * Aggregate overrides for the dashboard panel.
 * Unreasoned overrides are counted separately because they are the ones a
 * reviewer should look at first.
 */
function summarizeOverrides(options = {}) {
  const records = readOverrides({ ...options, limit: options.limit ?? 500 });
  const byGate = {};
  const bySource = {};
  const byActor = {};
  let unreasoned = 0;

  for (const rec of records) {
    const o = rec.override || {};
    byGate[o.gateId] = (byGate[o.gateId] || 0) + 1;
    bySource[o.source] = (bySource[o.source] || 0) + 1;
    byActor[o.actor] = (byActor[o.actor] || 0) + 1;
    if (!o.reasoned) unreasoned += 1;
  }

  return {
    total: records.length,
    unreasoned,
    byGate,
    bySource,
    byActor,
    mostRecent: records[0] || null,
    records,
  };
}

module.exports = {
  recordOverride,
  readOverrides,
  summarizeOverrides,
  OVERRIDE_DECISION,
  OVERRIDE_TOOL_NAME,
  SOURCES,
};
