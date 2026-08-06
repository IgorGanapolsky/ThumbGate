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
const { withFileLedgerLock } = require('./file-ledger-lock');

const ESCALATIONS_FILE = 'human-escalations.jsonl';
const ESCALATIONS_HEAD_FILE = 'human-escalations.head.json';
const ESCALATIONS_JOURNAL_FILE = 'human-escalations.journal.json';
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const DECISIONS = new Set(['approved', 'rejected', 'cancelled']);

function getEscalationsPath(options = {}) {
  return path.join(getFeedbackPaths(options).FEEDBACK_DIR, ESCALATIONS_FILE);
}

function getEscalationsHeadPath(options = {}) {
  if (options.inputPath) return `${path.resolve(options.inputPath)}.head.json`;
  return path.join(getFeedbackPaths(options).FEEDBACK_DIR, ESCALATIONS_HEAD_FILE);
}

function getEscalationsJournalPath(options = {}) {
  if (options.inputPath) return `${path.resolve(options.inputPath)}.journal.json`;
  return path.join(getFeedbackPaths(options).FEEDBACK_DIR, ESCALATIONS_JOURNAL_FILE);
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
  const approvalContextDigest = optionalDigest(input.approvalContextDigest, 'approvalContextDigest');
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
  if (approvalContextDigest) request.approvalContextDigest = approvalContextDigest;
  return withEscalationLock(options, () => {
    const ledger = readLedger(options);
    assertLedgerHealthy(ledger);
    // Compare retries with the immutable request event. A later decision event
    // deliberately carries the reviewer's reason and status, so comparing the
    // projected row would turn an already-approved request into a false
    // idempotency conflict during cross-ledger recovery.
    const existingRequest = ledger.events.find((event) => (
      event.idempotencyKey === idempotencyKey
      && (!event.eventType || event.eventType === 'requested')
    ));
    if (existingRequest) {
      if (eventComparableHash(existingRequest) !== eventComparableHash(request)) {
        const error = escalationError(`conflicting request for idempotency key '${idempotencyKey}'`);
        error.code = 'THUMBGATE_IDEMPOTENCY_CONFLICT';
        throw error;
      }
      const current = projectEscalations(ledger.events, options)
        .find((entry) => entry.escalationId === existingRequest.escalationId);
      return { recorded: false, duplicate: true, escalation: current || existingRequest };
    }
    const recorded = appendEventUnlocked(request, options, ledger.events);
    return { recorded: true, duplicate: false, escalation: recorded };
  });
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
  return withEscalationLock(options, () => {
    const ledger = readLedger(options);
    assertLedgerHealthy(ledger);
    const current = projectEscalations(ledger.events, options)
      .find((entry) => entry.escalationId === escalationId);
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
    if (current.approvalContextDigest) {
      event.approvalContextDigest = current.approvalContextDigest;
    }
    const signingKey = optionalString(options.approvalSigningKey);
    if (signingKey) event.approvalReceipt = signApprovalReceipt(event, signingKey);
    const recorded = appendEventUnlocked(event, options, ledger.events);
    return { recorded: true, escalation: { ...current, ...recorded } };
  });
}

/**
 * Return an approval only when both the append-only history and the reviewer
 * receipt authenticate. Merely appending an `approved` JSON row is not proof
 * that the independently authenticated reviewer API produced it.
 */
function getVerifiedApproval(escalationId, options = {}) {
  return withEscalationLock(options, () => getVerifiedApprovalUnlocked(escalationId, options));
}

function getVerifiedApprovalUnlocked(escalationId, options = {}) {
  const ledger = readLedger(options);
  const integrity = validateEscalationLedger(ledger.events, ledger.malformedRows, ledger.head);
  if (!integrity.ok) throw escalationError('escalation ledger integrity verification failed');
  const events = ledger.events.filter((event) => event.escalationId === escalationId);
  const requested = events.find((event) => event.eventType === 'requested');
  const decided = events.findLast((event) => event.eventType === 'decided');
  if (!requested || !decided || decided.status !== 'approved') return null;
  if (decided.taskId !== requested.taskId) throw escalationError('approval task does not match its request');
  if ((requested.approvalContextDigest || null) !== (decided.approvalContextDigest || null)) {
    throw escalationError('approval context does not match its request');
  }
  if (decided.actor?.kind !== 'human' || sameIdentity(requested.requester, decided.actor)) {
    throw escalationError('approval is not from an independent human actor');
  }
  const verificationKey = optionalString(
    options.approvalVerificationKey || process.env.THUMBGATE_HUMAN_REVIEWER_KEY
  );
  if (!verificationKey || !verifyApprovalReceipt(decided, verificationKey)) {
    throw escalationError('approval receipt is missing or unauthenticated');
  }
  return { ...requested, ...decided };
}

function listEscalations(options = {}) {
  return projectEscalations(readEvents(options), options);
}

function projectEscalations(events, options = {}) {
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
  const taskId = options.taskId;
  const escalationId = options.escalationId;
  return rows
    .filter((entry) => (!status || entry.status === status)
      && (!taskId || entry.taskId === taskId)
      && (!escalationId || entry.escalationId === escalationId))
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
  return readLedger(options).events;
}

function readLedger(options = {}) {
  const inputPath = options.inputPath ? path.resolve(options.inputPath) : getEscalationsPath(options);
  let raw = '';
  try {
    raw = fs.readFileSync(inputPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { events: [], malformedRows: [], head: readLedgerHead(options) };
  }
  const events = [];
  const malformedRows = [];
  raw.split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    try {
      events.push(JSON.parse(line));
    } catch {
      malformedRows.push(index + 1);
    }
  });
  return { events, malformedRows, head: readLedgerHead(options) };
}

function appendEventUnlocked(event, options, existingEvents) {
  const outputPath = getEscalationsPath(options);
  const previous = existingEvents.at(-1) || null;
  const chained = {
    ...event,
    schemaVersion: 'human-escalation-v2',
    sequence: existingEvents.length + 1,
    previousEventHash: previous?.eventHash || null,
  };
  chained.eventHash = eventHash(chained);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const journalPath = getEscalationsJournalPath(options);
  writeAtomicJson(journalPath, {
    schemaVersion: 'human-escalation-journal-v1',
    previousHead: readLedgerHead(options),
    event: chained,
  });
  const ledgerFd = fs.openSync(outputPath, 'a', 0o600);
  try {
    fs.writeSync(ledgerFd, `${JSON.stringify(chained)}\n`, null, 'utf8');
    fs.fsyncSync(ledgerFd);
  } finally {
    fs.closeSync(ledgerFd);
  }
  fsyncDirectoryFor(outputPath);
  writeLedgerHead(chained, options);
  removeDurableFile(journalPath);
  return chained;
}

function assertLedgerHealthy(ledger) {
  if (!validateEscalationLedger(ledger.events, ledger.malformedRows, ledger.head).ok) {
    throw escalationError('refusing to append to a damaged escalation ledger');
  }
}

function withEscalationLock(options, callback) {
  return withFileLedgerLock(`${getEscalationsPath(options)}.lock`, callback, {
    now: options.now,
    lockStaleMs: options.lockStaleMs,
    errorFactory: (message) => escalationError(message),
    beforeCallback: () => recoverEscalationTransaction(options),
  });
}

function readLedgerHead(options = {}) {
  try {
    return JSON.parse(fs.readFileSync(getEscalationsHeadPath(options), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return { malformed: true };
  }
}

function writeLedgerHead(event, options = {}) {
  const headPath = getEscalationsHeadPath(options);
  const head = {
    schemaVersion: 'human-escalation-head-v1',
    sequence: event.sequence,
    eventHash: event.eventHash,
  };
  writeAtomicJson(headPath, head);
}

function recoverEscalationTransaction(options = {}) {
  const journalPath = getEscalationsJournalPath(options);
  let journal;
  try {
    journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw escalationError(`cannot recover escalation journal: ${error.message}`);
  }
  if (journal?.schemaVersion !== 'human-escalation-journal-v1'
    || !journal.event
    || journal.event.eventHash !== eventHash(journal.event)) {
    throw escalationError('escalation journal integrity verification failed');
  }

  const ledger = readLedger(options);
  const event = journal.event;
  const currentLast = ledger.events.at(-1) || null;
  const eventHead = { sequence: event.sequence, eventHash: event.eventHash };
  const eventAlreadyAppended = sameHead(currentLast, eventHead);
  const headAtPrevious = sameHead(ledger.head, journal.previousHead);
  const headAtEvent = sameHead(ledger.head, eventHead);

  if (eventAlreadyAppended) {
    const preceding = ledger.events.at(-2) || null;
    const precedingMatches = event.sequence === ledger.events.length
      && event.previousEventHash === (preceding?.eventHash || null);
    const syntheticHead = {
      schemaVersion: 'human-escalation-head-v1',
      ...eventHead,
    };
    const integrity = validateEscalationLedger(ledger.events, ledger.malformedRows, syntheticHead);
    if (!precedingMatches || !integrity.ok || (!headAtPrevious && !headAtEvent)) {
      throw escalationError('escalation journal does not match the recoverable append');
    }
    if (!headAtEvent) writeLedgerHead(event, options);
    removeDurableFile(journalPath);
    return;
  }

  const currentIntegrity = validateEscalationLedger(ledger.events, ledger.malformedRows, ledger.head);
  if (currentIntegrity.ok && headAtPrevious && event.sequence === ledger.events.length + 1) {
    // No append became durable, so the caller never received success. Discard
    // the prepared transaction and let the original operation be retried.
    removeDurableFile(journalPath);
    return;
  }
  throw escalationError('escalation journal cannot be reconciled safely');
}

function sameHead(left, right) {
  if (!left && !right) return true;
  return left?.sequence === right?.sequence && left?.eventHash === right?.eventHash;
}

function writeAtomicJson(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const fd = fs.openSync(temporaryPath, 'w', 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(value)}\n`, null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporaryPath, targetPath);
  fsyncDirectoryFor(targetPath);
}

function removeDurableFile(targetPath) {
  fs.unlinkSync(targetPath);
  fsyncDirectoryFor(targetPath);
}

function fsyncDirectoryFor(targetPath) {
  const directoryFd = fs.openSync(path.dirname(targetPath), 'r');
  try {
    fs.fsyncSync(directoryFd);
  } finally {
    fs.closeSync(directoryFd);
  }
}

function validateEscalationLedger(events, malformedRows = [], head = null) {
  const invalidEventHashes = [];
  const invalidChainLinks = [];
  let previousHash = null;
  let chainedEvents = 0;
  events.forEach((event, index) => {
    const sequence = index + 1;
    if (event.eventHash !== eventHash(event)) invalidEventHashes.push(sequence);
    const isLegacy = !event.schemaVersion
      && event.sequence === undefined
      && event.previousEventHash === undefined;
    if (!isLegacy) chainedEvents += 1;
    // Legacy events predate the global chain. They may remain only as a
    // contiguous prefix; the first new event seals their terminal hash into
    // the v2 chain and creates the external head checkpoint.
    if ((!isLegacy && (event.sequence !== sequence || event.previousEventHash !== previousHash))
      || (isLegacy && chainedEvents > 0)) {
      invalidChainLinks.push(sequence);
    }
    previousHash = event.eventHash || null;
  });
  const expected = events.at(-1) || null;
  const headValid = expected === null
    ? head === null
    : chainedEvents === 0
      ? head === null
    : head?.schemaVersion === 'human-escalation-head-v1'
      && head.sequence === expected.sequence
      && head.eventHash === expected.eventHash;
  return {
    ok: malformedRows.length === 0
      && invalidEventHashes.length === 0
      && invalidChainLinks.length === 0
      && headValid,
    malformedRows,
    invalidEventHashes,
    invalidChainLinks,
    headValid,
  };
}

function signApprovalReceipt(event, signingKey) {
  return {
    algorithm: 'hmac-sha256',
    keyId: crypto.createHash('sha256').update(signingKey).digest('hex').slice(0, 16),
    signature: crypto.createHmac('sha256', signingKey).update(approvalPayload(event)).digest('hex'),
  };
}

function verifyApprovalReceipt(event, verificationKey) {
  const receipt = event.approvalReceipt;
  if (!receipt || receipt.algorithm !== 'hmac-sha256') return false;
  const expectedKeyId = crypto.createHash('sha256').update(verificationKey).digest('hex').slice(0, 16);
  if (receipt.keyId !== expectedKeyId) return false;
  const expected = crypto.createHmac('sha256', verificationKey).update(approvalPayload(event)).digest();
  let actual;
  try {
    actual = Buffer.from(String(receipt.signature || ''), 'hex');
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function approvalPayload(event) {
  const payload = {
    escalationId: event.escalationId,
    taskId: event.taskId,
    status: event.status,
    decision: event.decision,
    actor: event.actor,
    reason: event.reason,
    decidedAt: event.decidedAt,
  };
  if (event.approvalContextDigest) payload.approvalContextDigest = event.approvalContextDigest;
  return stableStringify(payload);
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

function optionalDigest(value, field) {
  const digest = optionalString(value);
  if (digest && !/^[a-f0-9]{64}$/i.test(digest)) {
    throw escalationError(`${field} must be a SHA-256 hex digest`);
  }
  return digest?.toLowerCase();
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
  const copy = { ...event };
  delete copy.eventHash;
  return crypto.createHash('sha256').update(stableStringify(copy)).digest('hex');
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
  if (event.approvalContextDigest) comparable.approvalContextDigest = event.approvalContextDigest;
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
  getEscalationsHeadPath,
  getEscalationsJournalPath,
  getEscalationsPath,
  getVerifiedApproval,
  listEscalations,
  requestEscalation,
  validateEscalationLedger,
};
