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
const crypto = require('crypto');
const { resolveFeedbackDir } = require('./feedback-paths');
const { ensureDir } = require('./fs-utils');

const AUDIT_LOG_FILENAME = 'audit-trail.jsonl';
const GATE_EVENTS_LOG_FILENAME = 'gate-events-log.jsonl';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getAuditLogPath() {
  return path.join(resolveFeedbackDir(), AUDIT_LOG_FILENAME);
}

/**
 * Resolve the acting non-human identity for audit attribution. Sessions and
 * worktree leases export THUMBGATE_SESSION_AGENT; THUMBGATE_AGENT_ID is the
 * generic override. Null when the caller cannot be attributed — audit records
 * must never invent an identity.
 */
function resolveAuditAgentId() {
  return process.env.THUMBGATE_SESSION_AGENT
    || process.env.THUMBGATE_AGENT_ID
    || null;
}

// ---------------------------------------------------------------------------
// Agent identity store — registry + observed-agent stream
//
// Lives here (not in org-dashboard) because the gates-engine identity gate and
// audit attribution are public runtime surfaces, while org-dashboard stays out
// of the npm tarball. org-dashboard re-exports these for its Pro reporting.
// ---------------------------------------------------------------------------

const REGISTRY_FILENAME = 'agent-registry.jsonl';
const OBSERVED_FILENAME = 'observed-agents.jsonl';
const OBSERVED_COMPACT_BYTES = 512 * 1024;
const DISPOSABLE_GRANT_FILENAME = 'disposable-task-grants.jsonl';
const DISPOSABLE_GRANT_MAX_MS = 24 * 60 * 60 * 1000;
const DISPOSABLE_TEXT_MAX = 2000;
const DISPOSABLE_SCRATCH_MAX = 8000;

function getRegistryPath() {
  return path.join(resolveFeedbackDir(), REGISTRY_FILENAME);
}

function getObservedAgentsPath() {
  return path.join(resolveFeedbackDir(), OBSERVED_FILENAME);
}

/**
 * Register an agent session. Called on MCP server startup or agent bootstrap.
 */
function registerAgent({ agentId, source, project, branch, metadata } = {}) {
  const id = agentId || `agent_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const record = {
    id,
    registeredAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    source: source || 'unknown',
    project: project || path.basename(process.cwd()),
    branch: branch || null,
    toolCalls: 0,
    gateBlocks: 0,
    gateWarns: 0,
    metadata: { lifecycleStatus: 'active', ...(metadata || {}) },
  };
  const registryPath = getRegistryPath();
  ensureDir(path.dirname(registryPath));
  fs.appendFileSync(registryPath, JSON.stringify(record) + '\n');
  return record;
}

/**
 * Record agent activity — called after each tool call evaluation.
 */
function recordAgentActivity(agentId, decision) {
  const registryPath = getRegistryPath();
  if (!fs.existsSync(registryPath)) return;
  const lines = fs.readFileSync(registryPath, 'utf-8').trim().split('\n');
  const updated = [];
  let found = false;
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (record.id === agentId && !found) {
        record.lastSeenAt = new Date().toISOString();
        record.toolCalls = (record.toolCalls || 0) + 1;
        if (decision === 'deny') record.gateBlocks = (record.gateBlocks || 0) + 1;
        if (decision === 'warn') record.gateWarns = (record.gateWarns || 0) + 1;
        found = true;
      }
      updated.push(JSON.stringify(record));
    } catch {
      updated.push(line);
    }
  }
  fs.writeFileSync(registryPath, updated.join('\n') + '\n');
}

/**
 * Load all registered agent sessions.
 */
function loadAgentRegistry() {
  const registryPath = getRegistryPath();
  if (!fs.existsSync(registryPath)) return [];
  const raw = fs.readFileSync(registryPath, 'utf-8').trim();
  if (!raw) return [];
  const records = [];
  for (const line of raw.split('\n')) {
    try {
      records.push(JSON.parse(line));
    } catch {
      // Skip corrupt rows; identity checks fail open, never crash.
    }
  }
  return records;
}

/**
 * Retire an agent identity. A retired agent that keeps acting is flagged by
 * the gates-engine identity gate (deny under strict enforcement).
 */
function retireAgent(agentId, reason) {
  const registryPath = getRegistryPath();
  if (!fs.existsSync(registryPath)) return false;
  const lines = fs.readFileSync(registryPath, 'utf-8').trim().split('\n');
  const updated = [];
  let found = false;
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (record.id === agentId) {
        record.metadata = record.metadata || {};
        record.metadata.lifecycleStatus = 'retired';
        record.metadata.retiredAt = new Date().toISOString();
        if (reason) record.metadata.retireReason = String(reason);
        found = true;
      }
      updated.push(JSON.stringify(record));
    } catch {
      updated.push(line);
    }
  }
  if (found) fs.writeFileSync(registryPath, updated.join('\n') + '\n');
  return found;
}

/**
 * Record one observation of an acting agent — the producer side of shadow-AI
 * detection, called from the gates-engine evaluation path on every attributed
 * tool call. Appends are plain (never lost to a busy lock); compaction runs
 * only under the cross-process ledger lock so a concurrent agent's append can
 * never be truncated by the read-aggregate-rewrite window.
 */
function recordObservedAgent(agentId) {
  const id = String(agentId || '').trim();
  if (!id) return null;
  const observedPath = getObservedAgentsPath();
  ensureDir(path.dirname(observedPath));
  const event = { id, seenAt: new Date().toISOString() };
  fs.appendFileSync(observedPath, JSON.stringify(event) + '\n');
  try {
    if (fs.statSync(observedPath).size > OBSERVED_COMPACT_BYTES) {
      const { withFileLedgerLock } = require('./file-ledger-lock');
      withFileLedgerLock(observedPath + '.lock', () => {
        const compacted = loadObservedAgents()
          .map((row) => JSON.stringify(row))
          .join('\n');
        fs.writeFileSync(observedPath, compacted + '\n');
      });
    }
  } catch {
    // Busy lock or read error: skip compaction, never drop the observation.
  }
  return event;
}

/**
 * Aggregate observation events into one row per agent id:
 * { id, firstSeenAt, lastSeenAt, observations }.
 */
function loadObservedAgents() {
  const observedPath = getObservedAgentsPath();
  if (!fs.existsSync(observedPath)) return [];
  const byId = new Map();
  const raw = fs.readFileSync(observedPath, 'utf-8').trim();
  if (!raw) return [];
  for (const line of raw.split('\n')) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const id = String(event.id || '').trim();
    if (!id) continue;
    const seenAt = event.seenAt || event.lastSeenAt || new Date().toISOString();
    const row = byId.get(id) || {
      id,
      firstSeenAt: event.firstSeenAt || seenAt,
      lastSeenAt: seenAt,
      observations: 0,
    };
    if (seenAt < row.firstSeenAt) row.firstSeenAt = seenAt;
    if (seenAt > row.lastSeenAt) row.lastSeenAt = seenAt;
    row.observations += Number(event.observations) > 0 ? Number(event.observations) : 1;
    byId.set(id, row);
  }
  return [...byId.values()];
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
    agentId: params.agentId || resolveAuditAgentId(),
    decision: params.decision || 'allow',
    gateId: params.gateId || null,
    message: params.message || null,
    severity: params.severity || null,
    latencyMs: typeof params.latencyMs === 'number' ? params.latencyMs : null,
    source: params.source || 'gates-engine',
  };

  // Typed override payload (see scripts/override-audit.js). Carried verbatim so
  // an override is filterable by decision === 'override' rather than having to
  // be inferred from toolName, which cannot distinguish it from a normal call.
  if (params.override && typeof params.override === 'object') {
    record.override = params.override;
  }

  // Safe stringify: never let circular/toxic tool inputs crash the gate path
  // (Antithesis-style invariant: evaluation + audit must not throw).
  let line;
  try {
    line = JSON.stringify(record);
  } catch (err) {
    line = JSON.stringify({
      ...record,
      toolInput: { _unserializable: true, reason: String(err.message || err).slice(0, 120) },
    });
  }
  fs.appendFileSync(logPath, `${line}\n`);
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
 * Drop circular references so JSON.stringify never throws mid-gate evaluation.
 */
function sanitizeToolInput(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return {};
  const safe = {};
  const MAX_VALUE_LEN = 200;
  const seen = new WeakSet();

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
    } else if (value && typeof value === 'object') {
      if (seen.has(value)) {
        safe[key] = '[Circular]';
        continue;
      }
      seen.add(value);
      try {
        safe[key] = JSON.parse(JSON.stringify(value, getCircularReplacer()));
      } catch {
        safe[key] = `[unserializable:${typeof value}]`;
      }
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

function getCircularReplacer() {
  const seen = new WeakSet();
  return function circularReplacer(_key, value) {
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
}

// ---------------------------------------------------------------------------
// Auto-feedback from audit events
// ---------------------------------------------------------------------------

/**
 * Converts deny/warn audit events into a separate gate-events log.
 *
 * IMPORTANT: Gate denials are NOT user feedback. Writing them to the main
 * feedback-log.jsonl inflated user-facing stats ~18x (1,943 synthetic entries
 * vs ~300 real). Gate events are now logged to gate-events-log.jsonl for
 * internal analytics only — they never pollute thumbs-up/thumbs-down counts.
 */
function auditToFeedback(auditRecord) {
  if (auditRecord.decision === 'allow') return null;

  try {
    const { getFeedbackPaths } = require('./feedback-paths');
    const { FEEDBACK_DIR } = getFeedbackPaths();
    const gateLogPath = path.join(FEEDBACK_DIR, GATE_EVENTS_LOG_FILENAME);
    ensureDir(path.dirname(gateLogPath));
    const entry = {
      id: `gate_${crypto.randomUUID()}`,
      gateId: auditRecord.gateId,
      decision: auditRecord.decision,
      toolName: auditRecord.toolName,
      message: auditRecord.message || null,
      source: auditRecord.source || null,
      timestamp: new Date().toISOString(),
    };
    fs.appendFileSync(gateLogPath, JSON.stringify(entry) + '\n');
    return entry;
  } catch {
    // Gate event logging failure should never break the audit trail
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
// Disposable task grants
//
// A grant is authority for one task: named tools, named child roles, and a
// caller-supplied deadline. Working notes live only on the active record.
// Retirement rewrites that record down to the lesson (or an explicit discard)
// and retires the agent id, so a later call under the same id is denied.
// A child deadline is capped by the parent grant's remaining time.
// ---------------------------------------------------------------------------

function disposableGrantPath() {
  return path.join(resolveFeedbackDir(), DISPOSABLE_GRANT_FILENAME);
}

function resolveNowMs(input) {
  return Number.isFinite(input && input.nowMs) ? input.nowMs : Date.now();
}

function denyGrant(reason) {
  return { ok: false, decision: 'deny', reason };
}

function normalizeNameList(values) {
  if (!Array.isArray(values)) return null;
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const name = String(value || '').trim();
    if (!name || name.length > 80 || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function snapshotScratch(scratch) {
  if (scratch == null) return { ok: true, scratch: {} };
  if (typeof scratch !== 'object' || Array.isArray(scratch)) {
    return { ok: false, reason: 'scratch_invalid' };
  }
  let encoded;
  try {
    encoded = JSON.stringify(scratch);
  } catch {
    return { ok: false, reason: 'scratch_invalid' };
  }
  if (encoded.length > DISPOSABLE_SCRATCH_MAX) return { ok: false, reason: 'scratch_too_large' };
  return { ok: true, scratch: JSON.parse(encoded) };
}

function looksLikeTranscript(text) {
  return (String(text).match(/^(?:user|assistant|system|human|tool)\s*:/gim) || []).length >= 3;
}

function readGrantLines() {
  const grantPath = disposableGrantPath();
  if (!fs.existsSync(grantPath)) return [];
  return fs.readFileSync(grantPath, 'utf8').split('\n').filter((line) => line.trim());
}

function currentGrantMap() {
  const byId = new Map();
  for (const line of readGrantLines()) {
    try {
      const record = JSON.parse(line);
      if (record && record.grantId) byId.set(record.grantId, record);
    } catch {
      // Keep the raw line on rewrite; a bad row never becomes authority.
    }
  }
  return byId;
}

function currentGrant(grantId) {
  const id = String(grantId || '').trim();
  if (!id) return null;
  return currentGrantMap().get(id) || null;
}

function viewGrant(record) {
  if (!record) return null;
  const view = { ...record };
  delete view.scratch;
  return view;
}

function appendGrant(record) {
  const grantPath = disposableGrantPath();
  ensureDir(path.dirname(grantPath));
  fs.appendFileSync(grantPath, `${JSON.stringify(record)}\n`);
}

function replaceGrantRecords(replacements) {
  const kept = [];
  for (const line of readGrantLines()) {
    let grantId = null;
    try {
      grantId = JSON.parse(line).grantId;
    } catch {
      kept.push(line);
      continue;
    }
    if (!replacements.has(grantId)) kept.push(line);
  }
  for (const record of replacements.values()) kept.push(JSON.stringify(record));
  const grantPath = disposableGrantPath();
  ensureDir(path.dirname(grantPath));
  fs.writeFileSync(grantPath, kept.length ? `${kept.join('\n')}\n` : '');
}

function ancestorGrants(parent) {
  const chain = [];
  const seen = new Set();
  let cursor = parent;
  while (cursor && cursor.grantId && !seen.has(cursor.grantId)) {
    seen.add(cursor.grantId);
    chain.push(cursor);
    cursor = cursor.parentGrantId ? currentGrant(cursor.parentGrantId) : null;
  }
  return chain;
}

function resolveGrantExpiry(input, nowMs, parent) {
  const parentCap = parent ? parent.expiresAtMs : null;
  let expiresAtMs = null;
  if (input.ttlMs != null) {
    const ttlMs = Number(input.ttlMs);
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return { error: 'ttl_required' };
    if (ttlMs > DISPOSABLE_GRANT_MAX_MS && parentCap == null) return { error: 'ttl_too_long' };
    expiresAtMs = nowMs + ttlMs;
  } else if (input.expiresAtMs != null) {
    expiresAtMs = Number(input.expiresAtMs);
    if (!Number.isFinite(expiresAtMs)) return { error: 'ttl_required' };
  } else if (parentCap != null) {
    expiresAtMs = parentCap;
  } else {
    return { error: 'ttl_required' };
  }
  if (parentCap != null && expiresAtMs > parentCap) expiresAtMs = parentCap;
  if (!(expiresAtMs > nowMs)) return { error: parent ? 'no_time_left' : 'expires_in_the_past' };
  if (expiresAtMs - nowMs > DISPOSABLE_GRANT_MAX_MS) return { error: 'ttl_too_long' };
  return { expiresAtMs };
}

function retiredGrantRecord(grant, nowMs, extracted) {
  return {
    grantId: grant.grantId,
    agentId: grant.agentId,
    taskId: grant.taskId,
    parentGrantId: grant.parentGrantId || null,
    role: grant.role || null,
    allowedTools: grant.allowedTools,
    allowedChildRoles: grant.allowedChildRoles,
    status: 'retired',
    createdAtMs: grant.createdAtMs,
    expiresAtMs: grant.expiresAtMs,
    retiredAtMs: nowMs,
    extracted,
  };
}

/**
 * Equip one agent for one task. No deadline means no grant: authority here
 * cannot be standing. Pass parentGrantId only for a child of a live grant.
 */
function issueDisposableTaskGrant(input = {}) {
  const nowMs = resolveNowMs(input);
  const agentId = String(input.agentId || '').trim();
  const taskId = String(input.taskId || '').trim();
  if (!agentId || !taskId) return denyGrant('agent_and_task_required');
  const allowedTools = normalizeNameList(input.allowedTools);
  if (!allowedTools || allowedTools.length === 0) return denyGrant('allowed_tools_required');
  const allowedChildRoles = input.allowedChildRoles == null
    ? []
    : normalizeNameList(input.allowedChildRoles);
  if (!allowedChildRoles) return denyGrant('child_roles_invalid');
  const scratch = snapshotScratch(input.scratch);
  if (!scratch.ok) return denyGrant(scratch.reason);

  let parent = null;
  let role = null;
  if (input.parentGrantId) {
    parent = currentGrant(input.parentGrantId);
    if (!parent || parent.status !== 'active') return denyGrant('parent_not_active');
    if (nowMs >= parent.expiresAtMs) return denyGrant('parent_expired');
    role = String(input.role || '').trim();
    if (!role || !parent.allowedChildRoles.includes(role)) return denyGrant('role_not_allowed');
    if (allowedTools.some((tool) => !parent.allowedTools.includes(tool))) {
      return denyGrant('child_tools_exceed_parent');
    }
    if (allowedChildRoles.some((childRole) => !parent.allowedChildRoles.includes(childRole))) {
      return denyGrant('child_roles_exceed_parent');
    }
    const ancestors = ancestorGrants(parent);
    if (ancestors.some((grant) => grant.agentId === agentId)) return denyGrant('shared_agent_id');
  }

  const expiry = resolveGrantExpiry(input, nowMs, parent);
  if (expiry.error) return denyGrant(expiry.error);

  const record = {
    grantId: `grant_${crypto.randomUUID()}`,
    agentId,
    taskId,
    parentGrantId: parent ? parent.grantId : null,
    role,
    allowedTools,
    allowedChildRoles,
    status: 'active',
    createdAtMs: nowMs,
    expiresAtMs: expiry.expiresAtMs,
    scratch: scratch.scratch,
    extracted: null,
  };
  appendGrant(record);
  registerAgent({
    agentId,
    source: 'disposable-task-grant',
    project: 'disposable-task',
    metadata: { grantId: record.grantId, taskId },
  });
  return { ok: true, decision: 'allow', reason: 'issued', grant: viewGrant(record) };
}

function authorizeDisposableTool(input = {}) {
  const nowMs = resolveNowMs(input);
  const grant = currentGrant(input.grantId);
  if (!grant) return denyGrant('unknown_grant');
  if (grant.status === 'retired') return denyGrant('retired');
  if (nowMs >= grant.expiresAtMs) return denyGrant('expired');
  const tool = String(input.tool || '').trim();
  if (!grant.allowedTools.includes(tool)) return denyGrant('tool_not_in_grant');
  return {
    ok: true,
    decision: 'allow',
    reason: 'in_grant',
    expiresAtMs: grant.expiresAtMs,
  };
}

function readDisposableWorkingScratch(grantId, nowMs = Date.now()) {
  const when = Number.isFinite(nowMs) ? nowMs : Date.now();
  const grant = currentGrant(grantId);
  if (!grant || grant.status !== 'active' || when >= grant.expiresAtMs) return null;
  return grant.scratch && typeof grant.scratch === 'object' ? { ...grant.scratch } : null;
}

function spawnDisposableChild(input = {}) {
  const parent = currentGrant(input.parentGrantId);
  const agentId = String(input.agentId || '').trim()
    || (parent ? `${parent.agentId}:child:${crypto.randomUUID()}` : '');
  return issueDisposableTaskGrant({
    agentId,
    taskId: input.taskId || (parent ? parent.taskId : ''),
    allowedTools: input.allowedTools,
    allowedChildRoles: input.allowedChildRoles,
    ttlMs: input.ttlMs,
    expiresAtMs: input.expiresAtMs,
    nowMs: input.nowMs,
    parentGrantId: input.parentGrantId,
    role: input.role,
    scratch: input.scratch,
  });
}

function activeDescendantIds(rootGrantId, byId) {
  const ids = [];
  const stack = [rootGrantId];
  const seen = new Set([rootGrantId]);
  while (stack.length) {
    const id = stack.pop();
    for (const [grantId, record] of byId) {
      if (record.parentGrantId !== id || seen.has(grantId)) continue;
      seen.add(grantId);
      if (record.status === 'active') ids.push(grantId);
      stack.push(grantId);
    }
  }
  return ids;
}

/**
 * Keep the lesson, drop working notes, and retire this grant plus any child
 * that has not already extracted its own lesson. A second call returns the
 * lesson already stored.
 */
function extractAndRetireDisposableGrant(input = {}) {
  const nowMs = resolveNowMs(input);
  const grant = currentGrant(input.grantId);
  if (!grant) return denyGrant('unknown_grant');
  if (grant.status === 'retired') {
    return {
      ok: true,
      decision: 'allow',
      reason: 'already_retired',
      extracted: grant.extracted || null,
      grant: viewGrant(grant),
    };
  }

  const discard = input.discard === true;
  const lesson = String(input.lesson || '').trim();
  const evidence = String(input.evidence || '').trim();
  if (!discard && !lesson) return denyGrant('lesson_required');
  if (lesson.length > DISPOSABLE_TEXT_MAX || evidence.length > DISPOSABLE_TEXT_MAX) {
    return denyGrant('extract_too_long');
  }
  if (looksLikeTranscript(lesson) || looksLikeTranscript(evidence)) {
    return denyGrant('transcript_not_a_lesson');
  }

  const extracted = {
    lesson: lesson || null,
    evidence: evidence || null,
    discarded: discard && !lesson,
    taskId: grant.taskId,
    grantId: grant.grantId,
    agentId: grant.agentId,
    extractedAtMs: nowMs,
  };
  const replacements = new Map();
  replacements.set(grant.grantId, retiredGrantRecord(grant, nowMs, extracted));
  const agentIds = [grant.agentId];
  for (const childId of activeDescendantIds(grant.grantId, currentGrantMap())) {
    const child = currentGrant(childId);
    if (!child || child.status !== 'active') continue;
    replacements.set(child.grantId, retiredGrantRecord(child, nowMs, {
      lesson: null,
      evidence: null,
      discarded: true,
      reason: 'parent_retired',
      taskId: child.taskId,
      grantId: child.grantId,
      agentId: child.agentId,
      extractedAtMs: nowMs,
    }));
    agentIds.push(child.agentId);
  }
  replaceGrantRecords(replacements);
  for (const agentId of agentIds) {
    retireAgent(agentId, agentId === grant.agentId ? 'disposable_task_extracted' : 'parent_grant_retired');
  }
  return {
    ok: true,
    decision: 'allow',
    reason: 'extracted',
    extracted,
    grant: viewGrant(replacements.get(grant.grantId)),
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  recordAuditEvent,
  auditToFeedback,
  readAuditLog,
  registerAgent,
  recordAgentActivity,
  loadAgentRegistry,
  retireAgent,
  issueDisposableTaskGrant,
  authorizeDisposableTool,
  readDisposableWorkingScratch,
  spawnDisposableChild,
  extractAndRetireDisposableGrant,
  DISPOSABLE_GRANT_FILENAME,
  recordObservedAgent,
  loadObservedAgents,
  getRegistryPath,
  getObservedAgentsPath,
  REGISTRY_FILENAME,
  OBSERVED_FILENAME,
  auditStats,
  latencyStats,
  skillAdherence,
  evaluateSelfHealTrigger,
  tuneCacheThreshold,
  getAuditLogPath,
  sanitizeToolInput,
  AUDIT_LOG_FILENAME,
  GATE_EVENTS_LOG_FILENAME,
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
