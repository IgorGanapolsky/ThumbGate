#!/usr/bin/env node
'use strict';

/**
 * Human Escalation Queue
 *
 * Agents may request or inspect escalation, but approval decisions require an
 * explicit human actor identity distinct from the requesting agent. Events are
 * append-only so every transition remains auditable.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getFeedbackPaths } = require('./feedback-paths');

const ESCALATIONS_FILE = 'human-escalations.jsonl';
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const DECISIONS = new Set(['approved', 'rejected', 'cancelled']);

function getEscalationsPath(options = {}) {
  return path.join(getFeedbackPaths(options).FEEDBACK_DIR, ESCALATIONS_FILE);
}

function requestEscalation(input = {}, options = {}) {
  const now = options.now || new Date();
  const taskId = requiredString(input.taskId, 'taskId');
  const reason = requiredString(input.reason, 'reason');
  const requester = requiredIdentity(input.requester, 'requester');
  const evidence = stringArray(input.evidence);
  if (evidence.length === 0) throw escalationError('evidence must contain at least one item');
  const severity = input.severity || 'medium';
  if (!SEVERITIES.has(severity)) throw escalationError(`severity must be one of ${Array.from(SEVERITIES).join(', ')}`);
  const ttlMs = Math.min(MAX_TTL_MS, Math.max(1, finiteNumber(input.ttlMs, DEFAULT_TTL_MS)));
  const idempotencyKey = requiredString(input.idempotencyKey || taskId, 'idempotencyKey');
  const existing = listEscalations(options).find((entry) => entry.idempotencyKey === idempotencyKey);

  const request = {
    escalationId: input.escalationId || `esc_${crypto.randomUUID()}`,
    idempotencyKey,
    taskId,
    reason,
    severity,
    requester,
    evidence,
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    status: 'pending',
    eventType: 'requested',
  };
  request.eventHash = eventHash(request);

  if (existing) {
    if (eventComparableHash(existing) !== eventComparableHash(request)) {
      const error = escalationError(`conflicting request for idempotency key '${idempotencyKey}'`);
      error.code = 'THUMBGATE_IDEMPOTENCY_CONFLICT';
      throw error;
    }
    return { recorded: false, duplicate: true, escalation: existing };
  }

  appendEvent(request, options);
  return { recorded: true, duplicate: false, escalation: request };
}

function decideEscalation(input = {}, options = {}) {
  const escalationId = requiredString(input.escalationId, 'escalationId');
  const decision = requiredString(input.decision, 'decision');
  if (!DECISIONS.has(decision)) throw escalationError(`decision must be one of ${Array.from(DECISIONS).join(', ')}`);
  if (Object.hasOwn(input, 'actor')) {
    throw escalationError('decision actor is derived from the authenticated reviewer and must not be supplied by the caller');
  }
  const actor = requiredIdentity(options.authenticatedActor, 'authenticatedActor');
  if (actor.kind !== 'human') throw escalationError('authenticatedActor.kind must be human');
  const reason = requiredString(input.reason, 'reason');
  const current = getEscalation(escalationId, options);
  if (!current) throw escalationError(`unknown escalation '${escalationId}'`);
  if (current.status !== 'pending') throw escalationError(`escalation '${escalationId}' is already ${current.status}`);
  if (sameIdentity(current.requester, actor)) throw escalationError('requester cannot decide their own escalation');

  const now = options.now || new Date();
  const event = {
    escalationId,
    taskId: current.taskId,
    status: decision,
    eventType: 'decided',
    decision,
    actor,
    reason,
    decidedAt: now.toISOString(),
  };
  event.eventHash = eventHash(event);
  appendEvent(event, options);
  return { recorded: true, escalation: { ...current, ...event } };
}

function listEscalations(options = {}) {
  const events = readEvents(options);
  const byId = new Map();
  for (const event of events) {
    const current = byId.get(event.escalationId) || {};
    byId.set(event.escalationId, { ...current, ...event });
  }

  const nowMs = (options.now || new Date()).getTime();
  const rows = Array.from(byId.values()).map((entry) => {
    if (entry.status === 'pending' && Date.parse(entry.expiresAt) <= nowMs) {
      return { ...entry, status: 'expired' };
    }
    return entry;
  });
  const status = options.status;
  return rows
    .filter((entry) => !status || entry.status === status)
    .sort((a, b) => Date.parse(b.requestedAt || b.decidedAt) - Date.parse(a.requestedAt || a.decidedAt));
}

function getEscalation(escalationId, options = {}) {
  return listEscalations(options).find((entry) => entry.escalationId === escalationId) || null;
}

function calculateEscalationMetrics(escalations = [], now = new Date()) {
  const rows = escalations.filter(Boolean);
  const decided = rows.filter((entry) => ['approved', 'rejected'].includes(entry.status));
  const decisionLatencies = decided
    .map((entry) => Date.parse(entry.decidedAt) - Date.parse(entry.requestedAt))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const overdue = rows.filter((entry) => entry.status === 'pending' && Date.parse(entry.expiresAt) <= now.getTime());
  return {
    generatedAt: now.toISOString(),
    sampleSize: rows.length,
    evidenceStatus: rows.length ? 'measured' : 'insufficient_evidence',
    pending: rows.filter((entry) => entry.status === 'pending').length,
    approved: rows.filter((entry) => entry.status === 'approved').length,
    rejected: rows.filter((entry) => entry.status === 'rejected').length,
    expired: rows.filter((entry) => entry.status === 'expired').length,
    overdue: overdue.length,
    medianDecisionLatencyMs: percentile(decisionLatencies, 0.5),
    p95DecisionLatencyMs: percentile(decisionLatencies, 0.95),
  };
}

function readEvents(options = {}) {
  const inputPath = options.inputPath ? path.resolve(options.inputPath) : getEscalationsPath(options);
  let raw = '';
  try {
    raw = fs.readFileSync(inputPath, 'utf8');
  } catch {
    return [];
  }
  return raw.split('\n').map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function appendEvent(event, options) {
  const outputPath = getEscalationsPath(options);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.appendFileSync(outputPath, `${JSON.stringify(event)}\n`, 'utf8');
}

function requiredIdentity(value, field) {
  if (!value || typeof value !== 'object') throw escalationError(`${field} identity is required`);
  const identity = {
    id: requiredString(value.id, `${field}.id`),
    kind: requiredString(value.kind, `${field}.kind`),
  };
  const displayName = optionalString(value.displayName);
  if (displayName) identity.displayName = displayName;
  return identity;
}

function requiredString(value, field) {
  const clean = String(value ?? '').trim();
  if (!clean) throw escalationError(`${field} is required`);
  return clean;
}

function optionalString(value) {
  const clean = String(value ?? '').trim();
  return clean || undefined;
}

function stringArray(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sameIdentity(a, b) {
  return a?.kind === b?.kind && a?.id === b?.id;
}

function eventHash(event) {
  return crypto.createHash('sha256').update(stableStringify(event)).digest('hex');
}

function eventComparableHash(event) {
  const comparable = {
    idempotencyKey: event.idempotencyKey,
    taskId: event.taskId,
    reason: event.reason,
    severity: event.severity,
    requester: event.requester,
    evidence: event.evidence,
  };
  return crypto.createHash('sha256').update(stableStringify(comparable)).digest('hex');
}

function stableStringify(value) {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
  const properties = keys.map((key) => [
    JSON.stringify(key),
    stableStringify(value[key]),
  ].join(':'));
  return ['{', properties.join(','), '}'].join('');
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index];
}

function escalationError(message) {
  const error = new Error(`Invalid human escalation: ${message}`);
  error.code = 'THUMBGATE_ESCALATION_INVALID';
  return error;
}

function isCliInvocation() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;
}

if (isCliInvocation()) {
  const command = process.argv[2] || 'metrics';
  const escalations = listEscalations();
  if (command === 'list') console.log(JSON.stringify(escalations, null, 2));
  else if (command === 'metrics') console.log(JSON.stringify(calculateEscalationMetrics(escalations), null, 2));
  else {
    console.error('Usage: human-escalation.js [list|metrics]');
    process.exitCode = 1;
  }
}

module.exports = {
  calculateEscalationMetrics,
  decideEscalation,
  getEscalation,
  getEscalationsPath,
  listEscalations,
  requestEscalation,
};
