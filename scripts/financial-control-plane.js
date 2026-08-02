#!/usr/bin/env node
'use strict';

/**
 * Append-only purchase control plane.
 *
 * This module deliberately separates the agent-accessible transaction lifecycle
 * from approval. Requisitions create a human escalation, but only the existing
 * authenticated reviewer API can decide that escalation. Agents can request,
 * inspect, reserve an approved budget, and record the outcome; they cannot
 * manufacture approval.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getFeedbackPaths } = require('./feedback-paths');
const {
  getEscalation,
  requestEscalation,
} = require('./human-escalation');

const LEDGER_FILE = 'financial-control-ledger.jsonl';
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RESERVATION_TTL_MS = 15 * 60 * 1000;
// Match transaction intent, not provider vocabulary. A filename such as
// ~/.resume_secrets/stripe.json or a command that merely reads billing docs is
// not an economic action. The verbs below represent actions that can create,
// change, or settle a financial obligation.
const ECONOMIC_ACTION_PATTERN = /\b(?:add\s+(?:a\s+)?(?:credit\s+)?card|add\s+(?:a\s+)?payment\s+method|buy|charge(?:\s+(?:a\s+)?card)?|checkout|credit\s+purchase|issue\s+(?:a\s+)?refund|refunds?\s+(?:create|issue)|make\s+(?:a\s+)?payment|pay\s+(?:an?\s+)?invoice|paid\s+trial|purchase|renew\s+(?:a\s+)?subscription|(?:re)?send(?:\s+[\w-]+){0,3}\s+invoice(?:\s+email)?|send\s+(?:a\s+)?payout|subscribe|top-?up|transfer\s+(?:money|funds|usd|dollars?)|upgrade(?:\s+(?:a\s+)?plan)?|wire\s+(?:money|funds|usd|dollars?))\b/i;
const SETTLEMENT_STATUSES = new Set(['committed', 'released']);
const CONTROL_PLANE_TOOLS = new Set([
  'create_purchase_requisition',
  'list_purchase_requisitions',
  'reserve_purchase_requisition',
  'settle_purchase_requisition',
  'reconcile_purchase_ledger',
]);

function getLedgerPath(options = {}) {
  return path.join(getFeedbackPaths(options).FEEDBACK_DIR, LEDGER_FILE);
}

function detectEconomicAction(toolName, toolInput = {}) {
  if (CONTROL_PLANE_TOOLS.has(String(toolName || '').trim())) return false;
  const metadata = objectValue(toolInput.metadata);
  const financialControl = objectValue(toolInput.financialControl || toolInput.financial_control);
  if (toolInput.economicAction === true || metadata.economicAction === true) return true;
  if (financialControl.requisitionId || financialControl.reservationId) return true;
  const combined = [
    toolName,
    toolInput.command,
    toolInput.goal,
    toolInput.action,
    toolInput.operation,
    metadata.context,
  ].map((value) => String(value || '')).join(' ');
  return ECONOMIC_ACTION_PATTERN.test(combined);
}

function createPurchaseRequisition(input = {}, options = {}) {
  const now = options.now || new Date();
  const requester = requiredIdentity(input.requester, 'requester');
  const taskId = requiredString(input.taskId, 'taskId');
  const vendor = requiredString(input.vendor, 'vendor');
  const purpose = requiredString(input.purpose, 'purpose');
  const sourceMessageId = requiredString(input.sourceMessageId, 'sourceMessageId');
  const amountUsd = positiveMoney(input.amountUsd, 'amountUsd');
  const evidence = stringArray(input.evidence);
  if (evidence.length === 0) throw financialError('evidence must contain at least one item');
  const ttlMs = boundedTtl(input.ttlMs, DEFAULT_TTL_MS);
  const idempotencyKey = requiredString(input.idempotencyKey || `${taskId}:${sourceMessageId}`, 'idempotencyKey');
  const existing = listPurchaseRequisitions(options).find((entry) => entry.idempotencyKey === idempotencyKey);
  const comparableRequest = {
    idempotencyKey,
    taskId,
    requester,
    vendor,
    purpose,
    sourceMessageId,
    amountUsd,
    evidence,
  };
  if (existing) {
    if (requestComparableHash(existing) !== requestComparableHash(comparableRequest)) {
      const error = financialError(`conflicting requisition for idempotency key '${idempotencyKey}'`);
      error.code = 'THUMBGATE_IDEMPOTENCY_CONFLICT';
      throw error;
    }
    return { recorded: false, duplicate: true, requisition: existing };
  }
  const requisitionId = input.requisitionId || `req_${crypto.randomUUID()}`;
  const escalationResult = requestEscalation({
    taskId,
    reason: `Purchase approval required: $${amountUsd.toFixed(2)} USD to ${vendor} for ${purpose}`,
    severity: 'critical',
    requester,
    evidence: [
      ...evidence,
      `sourceMessageId:${sourceMessageId}`,
      `requisitionId:${requisitionId}`,
    ],
    ttlMs,
    idempotencyKey: `purchase:${idempotencyKey}`,
  }, options);

  const event = withHash({
    schemaVersion: 'financial-control-v1',
    eventType: 'requested',
    status: 'pending_approval',
    requisitionId,
    escalationId: escalationResult.escalation.escalationId,
    idempotencyKey,
    taskId,
    requester,
    vendor,
    purpose,
    sourceMessageId,
    amountUsd,
    currency: 'USD',
    evidence,
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  });

  appendEvent(event, options);
  return { recorded: true, duplicate: false, requisition: projectRequisition(requisitionId, options) };
}

function reservePurchaseRequisition(input = {}, options = {}) {
  const now = options.now || new Date();
  const requisitionId = requiredString(input.requisitionId, 'requisitionId');
  const requester = requiredIdentity(input.requester, 'requester');
  const requisition = projectRequisition(requisitionId, options);
  if (!requisition) throw financialError(`unknown requisition '${requisitionId}'`);
  if (!sameIdentity(requester, requisition.requester)) {
    throw financialError('only the original requester may reserve an approved requisition');
  }
  const escalation = getEscalation(requisition.escalationId, options);
  if (!escalation || escalation.status !== 'approved') {
    throw financialError(`requisition '${requisitionId}' does not have independent human approval`);
  }
  if (sameIdentity(requisition.requester, escalation.actor)) {
    throw financialError('requester cannot approve their own requisition');
  }
  if (Date.parse(requisition.expiresAt) <= now.getTime()) {
    throw financialError(`requisition '${requisitionId}' is expired`);
  }
  if (['reserved', 'committed'].includes(requisition.status)) {
    const requestedKey = optionalString(input.idempotencyKey);
    if (requestedKey && requestedKey === requisition.reservationIdempotencyKey) {
      return { recorded: false, duplicate: true, requisition };
    }
    throw financialError(`requisition '${requisitionId}' is already ${requisition.status}`);
  }
  if (requisition.status === 'released') {
    throw financialError(`requisition '${requisitionId}' was released and cannot be reused`);
  }

  const amountUsd = positiveMoney(input.amountUsd ?? requisition.amountUsd, 'amountUsd');
  if (amountUsd > requisition.amountUsd) {
    throw financialError(`reservation $${amountUsd.toFixed(2)} exceeds approved amount $${requisition.amountUsd.toFixed(2)}`);
  }
  assertScopeMatches(input, requisition);
  const ttlMs = boundedTtl(input.ttlMs, DEFAULT_RESERVATION_TTL_MS);
  const event = withHash({
    schemaVersion: 'financial-control-v1',
    eventType: 'reserved',
    status: 'reserved',
    requisitionId,
    reservationId: input.reservationId || `res_${crypto.randomUUID()}`,
    reservationIdempotencyKey: requiredString(input.idempotencyKey || `${requisitionId}:reserve`, 'idempotencyKey'),
    requester,
    approvedBy: escalation.actor,
    approvalReason: escalation.reason,
    vendor: requisition.vendor,
    purpose: requisition.purpose,
    sourceMessageId: requisition.sourceMessageId,
    amountUsd,
    currency: 'USD',
    reservedAt: now.toISOString(),
    reservationExpiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  });
  appendEvent(event, options);
  return { recorded: true, duplicate: false, requisition: projectRequisition(requisitionId, options) };
}

function settlePurchaseRequisition(input = {}, options = {}) {
  const now = options.now || new Date();
  const requisitionId = requiredString(input.requisitionId, 'requisitionId');
  const reservationId = requiredString(input.reservationId, 'reservationId');
  const requester = requiredIdentity(input.requester, 'requester');
  const status = requiredString(input.status, 'status');
  if (!SETTLEMENT_STATUSES.has(status)) {
    throw financialError('status must be committed or released');
  }
  const requisition = projectRequisition(requisitionId, options);
  if (!requisition) throw financialError(`unknown requisition '${requisitionId}'`);
  if (requisition.status !== 'reserved') {
    throw financialError(`requisition '${requisitionId}' is ${requisition.status}, not reserved`);
  }
  if (reservationId !== requisition.reservationId) {
    throw financialError('reservationId does not match the active reservation');
  }
  if (!sameIdentity(requester, requisition.requester)) {
    throw financialError('only the original requester may settle the reservation');
  }

  const base = {
    schemaVersion: 'financial-control-v1',
    eventType: status,
    status,
    requisitionId,
    reservationId,
    requester,
    settledAt: now.toISOString(),
  };
  if (status === 'committed') {
    const actualAmountUsd = nonNegativeMoney(input.actualAmountUsd, 'actualAmountUsd');
    if (actualAmountUsd > requisition.reservedAmountUsd) {
      throw financialError(`actual amount $${actualAmountUsd.toFixed(2)} exceeds reservation $${requisition.reservedAmountUsd.toFixed(2)}`);
    }
    const evidence = stringArray(input.evidence);
    if (evidence.length === 0) throw financialError('committed spend requires receipt evidence');
    Object.assign(base, { actualAmountUsd, currency: 'USD', evidence });
  } else {
    base.reason = requiredString(input.reason, 'reason');
  }
  appendEvent(withHash(base), options);
  return { recorded: true, requisition: projectRequisition(requisitionId, options) };
}

function listPurchaseRequisitions(options = {}) {
  const ids = [...new Set(readEvents(options).map((event) => event.requisitionId).filter(Boolean))];
  return ids
    .map((id) => projectRequisition(id, options))
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.requestedAt) - Date.parse(left.requestedAt));
}

function projectRequisition(requisitionId, options = {}) {
  const events = readEvents(options).filter((event) => event.requisitionId === requisitionId);
  const requested = events.find((event) => event.eventType === 'requested');
  if (!requested) return null;
  const now = options.now || new Date();
  const state = { ...requested, timeline: events };
  const escalation = getEscalation(requested.escalationId, options);
  if (escalation?.status === 'approved') {
    state.status = 'approved';
    state.approvedBy = escalation.actor;
    state.approvalReason = escalation.reason;
    state.approvedAt = escalation.decidedAt;
  } else if (escalation?.status === 'rejected') {
    state.status = 'rejected';
  } else if (escalation?.status === 'cancelled') {
    state.status = 'cancelled';
  } else if (Date.parse(requested.expiresAt) <= now.getTime() || escalation?.status === 'expired') {
    state.status = 'expired';
  }

  for (const event of events.slice(1)) {
    if (event.eventType === 'reserved') {
      Object.assign(state, {
        status: Date.parse(event.reservationExpiresAt) <= now.getTime() ? 'reservation_expired' : 'reserved',
        reservationId: event.reservationId,
        reservationIdempotencyKey: event.reservationIdempotencyKey,
        reservedAmountUsd: event.amountUsd,
        reservedAt: event.reservedAt,
        reservationExpiresAt: event.reservationExpiresAt,
      });
    } else if (event.eventType === 'committed') {
      Object.assign(state, {
        status: 'committed',
        actualAmountUsd: event.actualAmountUsd,
        settlementEvidence: event.evidence,
        settledAt: event.settledAt,
      });
    } else if (event.eventType === 'released') {
      Object.assign(state, {
        status: 'released',
        releaseReason: event.reason,
        settledAt: event.settledAt,
      });
    }
  }
  return state;
}

function reconcilePurchaseLedger(options = {}) {
  const events = readEvents(options);
  const requisitions = listPurchaseRequisitions(options);
  const invalidEventHashes = events
    .filter((event) => event.eventHash !== hashEvent(event))
    .map((event) => ({ requisitionId: event.requisitionId, eventType: event.eventType }));
  const staleReservations = requisitions
    .filter((entry) => entry.status === 'reservation_expired')
    .map((entry) => entry.requisitionId);
  const totals = requisitions.reduce((acc, entry) => {
    if (entry.status === 'reserved') acc.reservedUsd += entry.reservedAmountUsd || 0;
    if (entry.status === 'committed') acc.committedUsd += entry.actualAmountUsd || 0;
    if (entry.approvedBy) acc.approvedUsd += entry.amountUsd || 0;
    return acc;
  }, { approvedUsd: 0, reservedUsd: 0, committedUsd: 0 });
  return {
    schemaVersion: 'financial-reconciliation-v1',
    generatedAt: (options.now || new Date()).toISOString(),
    ok: invalidEventHashes.length === 0 && staleReservations.length === 0,
    eventCount: events.length,
    requisitionCount: requisitions.length,
    totals: mapMoney(totals),
    statusCounts: requisitions.reduce((acc, entry) => {
      acc[entry.status] = (acc[entry.status] || 0) + 1;
      return acc;
    }, {}),
    staleReservations,
    invalidEventHashes,
  };
}

function evaluateFinancialControl(input = {}, options = {}) {
  const actionProfile = objectValue(input.actionProfile);
  const economicAction = actionProfile.economicAction === true
    || detectEconomicAction(input.toolName, input.toolInput);
  if (!economicAction) {
    return { mode: 'allow', economicAction: false, reasons: [], reasonCodes: [] };
  }

  const reasons = [];
  const reasonCodes = [];
  const budget = objectValue(input.costControl?.budget || input.budget);
  const estimatedCostUsd = finiteNumber(input.costControl?.usage?.estimatedCostUsd, 0);
  const addBlock = (code, message) => {
    reasonCodes.push(code);
    reasons.push(message);
  };

  const hasCostBudget = budget.hasMaxCostUsdPerAction === true || budget.hasRemainingCostUsd === true;
  if (!hasCostBudget) addBlock('missing_financial_budget', 'Economic actions require an explicit USD budget.');
  if ((budget.hasMaxCostUsdPerAction && budget.maxCostUsdPerAction === 0)
    || (budget.hasRemainingCostUsd && budget.remainingCostUsd === 0)) {
    addBlock('zero_spend_budget', 'Configured USD budget is $0.00; spending is prohibited.');
  }
  if (estimatedCostUsd <= 0) {
    addBlock('missing_cost_estimate', 'Economic actions require a positive, explicit cost estimate before approval.');
  }

  const toolInput = objectValue(input.toolInput);
  const control = objectValue(toolInput.financialControl || toolInput.financial_control || input.financialControl);
  const requisitionId = optionalString(control.requisitionId);
  const reservationId = optionalString(control.reservationId);
  if (!requisitionId) addBlock('missing_purchase_requisition', 'No purchase requisition is attached to this action.');
  if (!reservationId) addBlock('missing_budget_reservation', 'No approved budget reservation is attached to this action.');

  let requisition = null;
  if (requisitionId) {
    requisition = projectRequisition(requisitionId, options);
    if (!requisition) {
      addBlock('unknown_purchase_requisition', `Purchase requisition '${requisitionId}' does not exist.`);
    } else {
      if (requisition.status !== 'reserved') {
        addBlock('requisition_not_reserved', `Purchase requisition '${requisitionId}' is ${requisition.status}, not reserved.`);
      }
      if (reservationId && requisition.reservationId !== reservationId) {
        addBlock('reservation_mismatch', 'Attached reservation does not match the requisition ledger.');
      }
      if (!requisition.approvedBy || sameIdentity(requisition.requester, requisition.approvedBy)) {
        addBlock('independent_approval_missing', 'An independently authenticated human approval is required.');
      }
      if (estimatedCostUsd > (requisition.reservedAmountUsd || 0)) {
        addBlock('reservation_amount_exceeded', `Estimated cost $${estimatedCostUsd.toFixed(2)} exceeds the reserved amount.`);
      }
      for (const field of ['vendor', 'purpose', 'sourceMessageId']) {
        const supplied = optionalString(control[field]);
        if (!supplied || normalizeScope(supplied) !== normalizeScope(requisition[field])) {
          addBlock(`${field}_mismatch`, `${field} must exactly match the approved requisition scope.`);
        }
      }
    }
  }

  if (input.costControl?.mode === 'block') {
    addBlock(
      'cost_control_block',
      Array.isArray(input.costControl.reasons) && input.costControl.reasons.length > 0
        ? input.costControl.reasons.join(' ')
        : 'Configured cost control blocked this action.'
    );
  }

  return {
    mode: reasonCodes.length > 0 ? 'block' : 'allow',
    economicAction: true,
    deterministic: true,
    reasons: [...new Set(reasons)],
    reasonCodes: [...new Set(reasonCodes)],
    authorization: requisition ? {
      requisitionId: requisition.requisitionId,
      reservationId: requisition.reservationId || null,
      status: requisition.status,
      vendor: requisition.vendor,
      purpose: requisition.purpose,
      sourceMessageId: requisition.sourceMessageId,
      approvedAmountUsd: requisition.amountUsd,
      reservedAmountUsd: requisition.reservedAmountUsd || 0,
      approvedBy: requisition.approvedBy || null,
    } : null,
  };
}

function assertScopeMatches(input, requisition) {
  for (const field of ['vendor', 'purpose', 'sourceMessageId']) {
    const value = requiredString(input[field] ?? requisition[field], field);
    if (normalizeScope(value) !== normalizeScope(requisition[field])) {
      throw financialError(`${field} does not match the approved requisition`);
    }
  }
}

function readEvents(options = {}) {
  const inputPath = options.inputPath ? path.resolve(options.inputPath) : getLedgerPath(options);
  try {
    return fs.readFileSync(inputPath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
  } catch {
    return [];
  }
}

function appendEvent(event, options = {}) {
  const outputPath = getLedgerPath(options);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.appendFileSync(outputPath, `${JSON.stringify(event)}\n`, 'utf8');
}

function withHash(event) {
  return { ...event, eventHash: hashEvent(event) };
}

function hashEvent(event) {
  const copy = { ...event };
  delete copy.eventHash;
  return crypto.createHash('sha256').update(stableStringify(copy)).digest('hex');
}

function requestComparableHash(event) {
  const comparable = {
    idempotencyKey: event.idempotencyKey,
    taskId: event.taskId,
    requester: event.requester,
    vendor: event.vendor,
    purpose: event.purpose,
    sourceMessageId: event.sourceMessageId,
    amountUsd: event.amountUsd,
    evidence: event.evidence,
  };
  return crypto.createHash('sha256').update(stableStringify(comparable)).digest('hex');
}

function stableStringify(value) {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function requiredIdentity(value, field) {
  if (!value || typeof value !== 'object') throw financialError(`${field} identity is required`);
  const identity = {
    id: requiredString(value.id, `${field}.id`),
    kind: requiredString(value.kind, `${field}.kind`),
  };
  if (!['agent', 'service', 'human'].includes(identity.kind)) {
    throw financialError(`${field}.kind must be agent, service, or human`);
  }
  const displayName = optionalString(value.displayName);
  if (displayName) identity.displayName = displayName;
  return identity;
}

function sameIdentity(left, right) {
  return left?.id === right?.id && left?.kind === right?.kind;
}

function positiveMoney(value, field) {
  const amount = finiteNumber(value, Number.NaN);
  if (!Number.isFinite(amount) || amount <= 0) throw financialError(`${field} must be greater than zero`);
  return roundMoney(amount);
}

function nonNegativeMoney(value, field) {
  const amount = finiteNumber(value, Number.NaN);
  if (!Number.isFinite(amount) || amount < 0) throw financialError(`${field} must be zero or greater`);
  return roundMoney(amount);
}

function roundMoney(value) {
  return Number(Number(value).toFixed(2));
}

function mapMoney(value) {
  return Object.fromEntries(Object.entries(value).map(([key, amount]) => [key, roundMoney(amount)]));
}

function boundedTtl(value, fallback) {
  return Math.min(MAX_TTL_MS, Math.max(1, finiteNumber(value, fallback)));
}

function requiredString(value, field) {
  const clean = String(value ?? '').trim();
  if (!clean) throw financialError(`${field} is required`);
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

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeScope(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function financialError(message) {
  const error = new Error(message);
  error.code = 'THUMBGATE_FINANCIAL_CONTROL_ERROR';
  return error;
}

module.exports = {
  ECONOMIC_ACTION_PATTERN,
  createPurchaseRequisition,
  detectEconomicAction,
  evaluateFinancialControl,
  getLedgerPath,
  listPurchaseRequisitions,
  projectRequisition,
  readEvents,
  reconcilePurchaseLedger,
  reservePurchaseRequisition,
  settlePurchaseRequisition,
};
