#!/usr/bin/env node
'use strict';

/**
 * Fail-closed purchase control plane.
 *
 * Financial lifecycle calls derive their requester from an authenticated
 * runtime principal. Caller arguments cannot select an identity. A reservation
 * is consumed exactly once at the final pre-tool allow boundary, after every
 * other gate passes and before the economic action runs. Ledger events form a
 * global hash chain so deletion and reordering are detectable during
 * reconciliation and before any new authorization.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getFeedbackPaths } = require('./feedback-paths');
const {
  getEscalation,
  getVerifiedApproval,
  requestEscalation,
} = require('./human-escalation');

const LEDGER_FILE = 'financial-control-ledger.jsonl';
const LEDGER_HEAD_FILE = 'financial-control-ledger.head.json';
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RESERVATION_TTL_MS = 15 * 60 * 1000;
const SETTLEMENT_STATUSES = new Set(['committed', 'released']);
const CONTROL_PLANE_TOOLS = new Set([
  'create_purchase_requisition',
  'list_purchase_requisitions',
  'reserve_purchase_requisition',
  'settle_purchase_requisition',
  'reconcile_purchase_ledger',
]);

// Keep these expressions deliberately small and auditable. The second group
// covers provider-native noun-first CLI forms such as `subscriptions create`.
const ECONOMIC_ACTION_PATTERNS = [
  /\badd\s+(?:a\s+)?(?:credit\s+)?card\b/i,
  /\badd\s+(?:a\s+)?payment\s+method\b/i,
  /\b(?:buy|purchase|subscribe|top-?up)\b/i,
  /\b(?:confirm|complete|open|start)\s+(?:the\s+)?checkout\b/i,
  /\bcheckout\s+(?:flow|page|session)\b/i,
  /\b(?:issue|send)\s+(?:a\s+)?(?:invoice|payout|refund)\b/i,
  /\b(?:re)?send\s+(?:\w+\s+){0,3}invoice\b/i,
  /\b(?:make|send)\s+(?:a\s+)?(?:payment|transfer|wire)\b/i,
  /\bpay\s+(?:an?\s+)?invoice\b/i,
  /\bpaid\s+trial\b/i,
  /\brenew\s+(?:a\s+)?subscription\b/i,
  /\btransfer\s+(?:dollars?|funds|money|usd)\b/i,
  /\bupgrade\s+(?:a\s+)?plan\b/i,
  /\b(?:charges?|checkout[\s_-]*sessions?|invoices?|payment[\s_-]*intents?|payment[\s_-]*methods?|payouts?|refunds?|subscriptions?|top[\s_-]*ups?|transfers?)\s+(?:attach|cancel|capture|confirm|create|detach|finalize|pay|refund|send|update)\b/i,
  /\b(?:attach|cancel|capture|confirm|create|detach|finalize|pay|refund|send|update)\s+(?:a\s+)?(?:charge|invoice|payment|payment\s+method|payout|refund|subscription|top-?up|transfer)\b/i,
];

// A process principal cannot be selected through a tool call. Operators that
// need an approved purchase to survive separate MCP/hook processes must set a
// unique THUMBGATE_RUNTIME_PRINCIPAL_ID in the trusted host configuration.
const RUNTIME_PRINCIPAL = Object.freeze({
  id: String(process.env.THUMBGATE_RUNTIME_PRINCIPAL_ID || '').trim()
    || `runtime_${crypto.randomUUID()}`,
  kind: 'agent',
});

function getRuntimePrincipal() {
  return { ...RUNTIME_PRINCIPAL };
}

function getLedgerPath(options = {}) {
  return path.join(getFeedbackPaths(options).FEEDBACK_DIR, LEDGER_FILE);
}

function getLedgerHeadPath(options = {}) {
  if (options.inputPath) return `${path.resolve(options.inputPath)}.head.json`;
  return path.join(getFeedbackPaths(options).FEEDBACK_DIR, LEDGER_HEAD_FILE);
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
  return ECONOMIC_ACTION_PATTERNS.some((pattern) => pattern.test(combined));
}

function createPurchaseRequisition(input = {}, options = {}) {
  rejectCallerSelectedRequester(input);
  assertLedgerHealthy(options);
  const now = options.now || new Date();
  const requester = authenticatedPrincipal(options);
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

  appendEvent({
    schemaVersion: 'financial-control-v2',
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
  }, options);
  return { recorded: true, duplicate: false, requisition: projectRequisition(requisitionId, options) };
}

function reservePurchaseRequisition(input = {}, options = {}) {
  rejectCallerSelectedRequester(input);
  assertLedgerHealthy(options);
  const now = options.now || new Date();
  const requester = authenticatedPrincipal(options);
  const requisitionId = requiredString(input.requisitionId, 'requisitionId');
  const requisition = projectRequisition(requisitionId, options);
  if (!requisition) throw financialError(`unknown requisition '${requisitionId}'`);
  assertPrincipalOwnsRequisition(requester, requisition);
  let escalation;
  try {
    escalation = getVerifiedApproval(requisition.escalationId, options);
  } catch (error) {
    throw financialError(`requisition '${requisitionId}' approval verification failed: ${error.message}`);
  }
  if (!escalation || escalation.status !== 'approved') {
    throw financialError(`requisition '${requisitionId}' does not have independent human approval`);
  }
  if (sameIdentity(requisition.requester, escalation.actor)) {
    throw financialError('requester cannot approve their own requisition');
  }
  if (Date.parse(requisition.expiresAt) <= now.getTime()) {
    throw financialError(`requisition '${requisitionId}' is expired`);
  }
  if (['reserved', 'authorized', 'committed'].includes(requisition.status)) {
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
  appendEvent({
    schemaVersion: 'financial-control-v2',
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
  }, options);
  return { recorded: true, duplicate: false, requisition: projectRequisition(requisitionId, options) };
}

function settlePurchaseRequisition(input = {}, options = {}) {
  rejectCallerSelectedRequester(input);
  assertLedgerHealthy(options);
  const now = options.now || new Date();
  const requester = authenticatedPrincipal(options);
  const requisitionId = requiredString(input.requisitionId, 'requisitionId');
  const reservationId = requiredString(input.reservationId, 'reservationId');
  const status = requiredString(input.status, 'status');
  if (!SETTLEMENT_STATUSES.has(status)) {
    throw financialError('status must be committed or released');
  }
  const requisition = projectRequisition(requisitionId, options);
  if (!requisition) throw financialError(`unknown requisition '${requisitionId}'`);
  const allowedStates = status === 'committed' ? ['authorized'] : ['reserved', 'authorized'];
  if (!allowedStates.includes(requisition.status)) {
    throw financialError(`requisition '${requisitionId}' is ${requisition.status}, not ${allowedStates.join(' or ')}`);
  }
  if (reservationId !== requisition.reservationId) {
    throw financialError('reservationId does not match the active reservation');
  }
  assertPrincipalOwnsRequisition(requester, requisition);

  const base = {
    schemaVersion: 'financial-control-v2',
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
  appendEvent(base, options);
  return { recorded: true, requisition: projectRequisition(requisitionId, options) };
}

function listPurchaseRequisitions(options = {}) {
  const events = readEvents(options);
  const ids = [...new Set(events.map((event) => event.requisitionId).filter(Boolean))];
  return ids
    .map((id) => projectRequisitionFromEvents(events, id, options))
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.requestedAt) - Date.parse(left.requestedAt));
}

function projectRequisition(requisitionId, options = {}) {
  return projectRequisitionFromEvents(readEvents(options), requisitionId, options);
}

function projectRequisitionFromEvents(allEvents, requisitionId, options = {}) {
  const events = allEvents.filter((event) => event.requisitionId === requisitionId);
  const requested = events.find((event) => event.eventType === 'requested');
  if (!requested) return null;
  const now = options.now || new Date();
  const state = { ...requested, timeline: events };
  applyEscalationState(state, requested, now, options);
  for (const event of events.slice(1)) applyFinancialEvent(state, event, now);
  return state;
}

function applyEscalationState(state, requested, now, options) {
  const escalation = getEscalation(requested.escalationId, options);
  if (escalation?.status === 'approved') {
    Object.assign(state, {
      status: 'approved',
      approvedBy: escalation.actor,
      approvalReason: escalation.reason,
      approvedAt: escalation.decidedAt,
    });
  } else if (escalation?.status === 'rejected') {
    state.status = 'rejected';
  } else if (escalation?.status === 'cancelled') {
    state.status = 'cancelled';
  } else if (Date.parse(requested.expiresAt) <= now.getTime() || escalation?.status === 'expired') {
    state.status = 'expired';
  }
}

function applyFinancialEvent(state, event, now) {
  if (event.eventType === 'reserved') {
    Object.assign(state, {
      status: Date.parse(event.reservationExpiresAt) <= now.getTime() ? 'reservation_expired' : 'reserved',
      reservationId: event.reservationId,
      reservationIdempotencyKey: event.reservationIdempotencyKey,
      reservedAmountUsd: event.amountUsd,
      reservedAt: event.reservedAt,
      reservationExpiresAt: event.reservationExpiresAt,
    });
  } else if (event.eventType === 'authorized') {
    Object.assign(state, {
      status: 'authorized',
      authorizationId: event.authorizationId,
      actionId: event.actionId,
      authorizedAt: event.authorizedAt,
      authorizedAmountUsd: event.estimatedCostUsd,
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

function reconcilePurchaseLedger(options = {}) {
  const ledger = readLedger(options);
  const chain = validateLedgerChain(ledger.events, ledger.malformedRows, ledger.head);
  const requisitions = listPurchaseRequisitions(options);
  const staleReservations = requisitions
    .filter((entry) => entry.status === 'reservation_expired')
    .map((entry) => entry.requisitionId);
  const totals = requisitions.reduce((acc, entry) => {
    if (entry.status === 'reserved') acc.reservedUsd += entry.reservedAmountUsd || 0;
    if (entry.status === 'authorized') acc.authorizedUsd += entry.authorizedAmountUsd || 0;
    if (entry.status === 'committed') acc.committedUsd += entry.actualAmountUsd || 0;
    if (entry.approvedBy) acc.approvedUsd += entry.amountUsd || 0;
    return acc;
  }, { approvedUsd: 0, reservedUsd: 0, authorizedUsd: 0, committedUsd: 0 });
  return {
    schemaVersion: 'financial-reconciliation-v2',
    generatedAt: (options.now || new Date()).toISOString(),
    ok: chain.ok && staleReservations.length === 0,
    eventCount: ledger.events.length,
    requisitionCount: requisitions.length,
    totals: mapMoney(totals),
    statusCounts: requisitions.reduce((acc, entry) => {
      acc[entry.status] = (acc[entry.status] || 0) + 1;
      return acc;
    }, {}),
    staleReservations,
    malformedRows: ledger.malformedRows,
    invalidEventHashes: chain.invalidEventHashes,
    invalidChainLinks: chain.invalidChainLinks,
    ledgerHeadMismatches: chain.ledgerHeadMismatches,
  };
}

function evaluateFinancialControl(input = {}, options = {}) {
  const actionProfile = objectValue(input.actionProfile);
  const economicAction = actionProfile.economicAction === true
    || detectEconomicAction(input.toolName, input.toolInput);
  if (!economicAction) return allowNonEconomicAction();

  const result = financialEvaluationContext(input, options);
  validateBudget(result);
  validateAttachedControl(result);
  validateRequisition(result, options);
  validateCostControl(result);
  consumeReservationIfAuthorized(result, input, options);
  return buildFinancialDecision(result);
}

function allowNonEconomicAction() {
  return { mode: 'allow', economicAction: false, reasons: [], reasonCodes: [] };
}

function financialEvaluationContext(input, options) {
  const toolInput = objectValue(input.toolInput);
  const control = objectValue(toolInput.financialControl || toolInput.financial_control || input.financialControl);
  return {
    input,
    toolInput,
    control,
    budget: objectValue(input.costControl?.budget || input.budget),
    estimatedCostUsd: finiteNumber(input.costControl?.usage?.estimatedCostUsd, 0),
    requisitionId: optionalString(control.requisitionId),
    reservationId: optionalString(control.reservationId),
    actionId: optionalString(control.actionId),
    principal: authenticatedPrincipal(options),
    requisition: null,
    authorization: null,
    reasons: [],
    reasonCodes: [],
  };
}

function addBlock(result, code, message) {
  result.reasonCodes.push(code);
  result.reasons.push(message);
}

function validateBudget(result) {
  const { budget, estimatedCostUsd } = result;
  const hasCostBudget = budget.hasMaxCostUsdPerAction === true || budget.hasRemainingCostUsd === true;
  if (!hasCostBudget) addBlock(result, 'missing_financial_budget', 'Economic actions require an explicit USD budget.');
  if ((budget.hasMaxCostUsdPerAction && budget.maxCostUsdPerAction === 0)
    || (budget.hasRemainingCostUsd && budget.remainingCostUsd === 0)) {
    addBlock(result, 'zero_spend_budget', 'Configured USD budget is $0.00; spending is prohibited.');
  }
  if (estimatedCostUsd <= 0) {
    addBlock(result, 'missing_cost_estimate', 'Economic actions require a positive, explicit cost estimate before approval.');
  }
}

function validateAttachedControl(result) {
  if (!result.requisitionId) {
    addBlock(result, 'missing_purchase_requisition', 'No purchase requisition is attached to this action.');
  }
  if (!result.reservationId) {
    addBlock(result, 'missing_budget_reservation', 'No approved budget reservation is attached to this action.');
  }
  if (!result.actionId) {
    addBlock(result, 'missing_action_id', 'A unique actionId is required to consume a financial reservation.');
  }
}

function validateRequisition(result, options) {
  const reconciliation = reconcilePurchaseLedger(options);
  if (!reconciliation.ok && (reconciliation.invalidEventHashes.length > 0
    || reconciliation.invalidChainLinks.length > 0
    || reconciliation.ledgerHeadMismatches.length > 0
    || reconciliation.malformedRows.length > 0)) {
    addBlock(result, 'financial_ledger_tampered', 'Financial ledger integrity verification failed.');
    return;
  }
  if (!result.requisitionId) return;
  const requisition = projectRequisition(result.requisitionId, options);
  result.requisition = requisition;
  if (!requisition) {
    addBlock(result, 'unknown_purchase_requisition', `Purchase requisition '${result.requisitionId}' does not exist.`);
    return;
  }
  if (requisition.status !== 'reserved') {
    addBlock(result, 'requisition_not_reserved', `Purchase requisition '${result.requisitionId}' is ${requisition.status}, not reserved.`);
  }
  if (result.reservationId && requisition.reservationId !== result.reservationId) {
    addBlock(result, 'reservation_mismatch', 'Attached reservation does not match the requisition ledger.');
  }
  if (!sameIdentity(result.principal, requisition.requester)) {
    addBlock(result, 'runtime_principal_mismatch', 'Authenticated runtime principal does not own this purchase requisition.');
  }
  if (!requisition.approvedBy || sameIdentity(requisition.requester, requisition.approvedBy)) {
    addBlock(result, 'independent_approval_missing', 'An independently authenticated human approval is required.');
  }
  if (result.estimatedCostUsd > (requisition.reservedAmountUsd || 0)) {
    addBlock(result, 'reservation_amount_exceeded', `Estimated cost $${result.estimatedCostUsd.toFixed(2)} exceeds the reserved amount.`);
  }
  validateScope(result, requisition);
}

function validateScope(result, requisition) {
  for (const field of ['vendor', 'purpose', 'sourceMessageId']) {
    const supplied = optionalString(result.control[field]);
    if (!supplied || normalizeScope(supplied) !== normalizeScope(requisition[field])) {
      addBlock(result, `${field}_mismatch`, `${field} must exactly match the approved requisition scope.`);
    }
  }
}

function validateCostControl(result) {
  if (result.input.costControl?.mode !== 'block') return;
  const reasons = result.input.costControl.reasons;
  addBlock(
    result,
    'cost_control_block',
    Array.isArray(reasons) && reasons.length > 0
      ? reasons.join(' ')
      : 'Configured cost control blocked this action.'
  );
}

function consumeReservationIfAuthorized(result, input, options) {
  if (result.reasonCodes.length > 0 || options.consumeReservation !== true) return;
  try {
    result.authorization = consumeReservation({
      requisitionId: result.requisitionId,
      reservationId: result.reservationId,
      actionId: result.actionId,
      estimatedCostUsd: result.estimatedCostUsd,
      principal: result.principal,
      toolName: input.toolName,
    }, options);
    result.requisition = result.authorization;
  } catch (error) {
    addBlock(result, 'reservation_consumption_failed', error.message);
  }
}

function consumeReservation(input, options) {
  return withLedgerLock(options, () => {
    const ledger = readLedger(options);
    const chain = validateLedgerChain(ledger.events, ledger.malformedRows, ledger.head);
    if (!chain.ok) throw financialError('financial ledger integrity check failed before authorization');
    const current = projectRequisitionFromEvents(ledger.events, input.requisitionId, options);
    if (!current || current.status !== 'reserved') {
      throw financialError(`purchase requisition '${input.requisitionId}' is not available for single-use authorization`);
    }
    if (current.reservationId !== input.reservationId) {
      throw financialError('reservation changed before authorization');
    }
    assertPrincipalOwnsRequisition(input.principal, current);
    appendEventUnlocked({
      schemaVersion: 'financial-control-v2',
      eventType: 'authorized',
      status: 'authorized',
      requisitionId: input.requisitionId,
      reservationId: input.reservationId,
      authorizationId: `auth_${crypto.randomUUID()}`,
      actionId: input.actionId,
      requester: input.principal,
      toolName: String(input.toolName || 'unknown'),
      estimatedCostUsd: input.estimatedCostUsd,
      currency: 'USD',
      authorizedAt: (options.now || new Date()).toISOString(),
    }, options, ledger.events);
    return projectRequisition(input.requisitionId, options);
  });
}

function buildFinancialDecision(result) {
  const requisition = result.requisition;
  return {
    mode: result.reasonCodes.length > 0 ? 'block' : 'allow',
    economicAction: true,
    deterministic: true,
    reasons: [...new Set(result.reasons)],
    reasonCodes: [...new Set(result.reasonCodes)],
    authorization: requisition ? {
      requisitionId: requisition.requisitionId,
      reservationId: requisition.reservationId || null,
      authorizationId: requisition.authorizationId || null,
      actionId: requisition.actionId || result.actionId || null,
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

function readLedger(options = {}) {
  const inputPath = options.inputPath ? path.resolve(options.inputPath) : getLedgerPath(options);
  let raw;
  try {
    raw = fs.readFileSync(inputPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw financialError(`cannot read financial ledger: ${error.message}`);
    }
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

function readLedgerHead(options = {}) {
  try {
    return JSON.parse(fs.readFileSync(getLedgerHeadPath(options), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return { malformed: true };
  }
}

function readEvents(options = {}) {
  return readLedger(options).events;
}

function appendEvent(event, options = {}) {
  return withLedgerLock(options, () => {
    const ledger = readLedger(options);
    const chain = validateLedgerChain(ledger.events, ledger.malformedRows, ledger.head);
    if (!chain.ok) throw financialError('refusing to append to a damaged financial ledger');
    return appendEventUnlocked(event, options, ledger.events);
  });
}

function appendEventUnlocked(event, options, existingEvents) {
  const outputPath = getLedgerPath(options);
  const previous = existingEvents.at(-1) || null;
  const chained = {
    ...event,
    sequence: existingEvents.length + 1,
    previousEventHash: previous?.eventHash || null,
  };
  chained.eventHash = hashEvent(chained);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.appendFileSync(outputPath, `${JSON.stringify(chained)}\n`, 'utf8');
  writeLedgerHead(chained, options);
  return chained;
}

function writeLedgerHead(event, options) {
  const headPath = getLedgerHeadPath(options);
  const temporaryPath = `${headPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const head = {
    schemaVersion: 'financial-ledger-head-v1',
    sequence: event.sequence,
    eventHash: event.eventHash,
  };
  fs.writeFileSync(temporaryPath, `${JSON.stringify(head)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, headPath);
}

function withLedgerLock(options, callback) {
  const lockPath = `${getLedgerPath(options)}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    fs.mkdirSync(lockPath);
  } catch (error) {
    if (error.code === 'EEXIST') throw financialError('financial ledger is busy; deny and retry only with a fresh reservation');
    throw error;
  }
  try {
    return callback();
  } finally {
    try { fs.rmdirSync(lockPath); } catch { /* process recovery removes stale empty lock */ }
  }
}

function validateLedgerChain(events, malformedRows = [], ledgerHead = null) {
  const invalidEventHashes = [];
  const invalidChainLinks = [];
  let previousHash = null;
  events.forEach((event, index) => {
    const sequence = index + 1;
    if (event.eventHash !== hashEvent(event)) {
      invalidEventHashes.push({ sequence, requisitionId: event.requisitionId, eventType: event.eventType });
    }
    if (event.sequence !== sequence || event.previousEventHash !== previousHash) {
      invalidChainLinks.push({
        sequence,
        recordedSequence: event.sequence,
        expectedPreviousEventHash: previousHash,
        recordedPreviousEventHash: event.previousEventHash,
      });
    }
    previousHash = event.eventHash || null;
  });
  const ledgerHeadMismatches = validateLedgerHead(events, ledgerHead);
  return {
    ok: malformedRows.length === 0
      && invalidEventHashes.length === 0
      && invalidChainLinks.length === 0
      && ledgerHeadMismatches.length === 0,
    invalidEventHashes,
    invalidChainLinks,
    ledgerHeadMismatches,
  };
}

function validateLedgerHead(events, ledgerHead) {
  if (events.length === 0 && ledgerHead === null) return [];
  const expected = events.at(-1) || { sequence: 0, eventHash: null };
  if (ledgerHead?.schemaVersion === 'financial-ledger-head-v1'
    && ledgerHead.sequence === expected.sequence
    && ledgerHead.eventHash === expected.eventHash) return [];
  return [{
    recordedSequence: ledgerHead?.sequence ?? null,
    expectedSequence: expected.sequence,
    recordedEventHash: ledgerHead?.eventHash ?? null,
    expectedEventHash: expected.eventHash,
  }];
}

function assertLedgerHealthy(options) {
  const ledger = readLedger(options);
  if (!validateLedgerChain(ledger.events, ledger.malformedRows, ledger.head).ok) {
    throw financialError('financial ledger integrity verification failed');
  }
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
  const properties = keys.map((key) => [JSON.stringify(key), stableStringify(value[key])].join(':'));
  return ['{', properties.join(','), '}'].join('');
}

function rejectCallerSelectedRequester(input) {
  if (Object.hasOwn(input, 'requester')) {
    throw financialError('requester is derived from the authenticated runtime and must not be supplied by the caller');
  }
}

function authenticatedPrincipal(options) {
  return requiredIdentity(options.authenticatedPrincipal || RUNTIME_PRINCIPAL, 'authenticatedPrincipal');
}

function assertPrincipalOwnsRequisition(principal, requisition) {
  if (!sameIdentity(principal, requisition.requester)) {
    throw financialError('authenticated runtime principal does not own this purchase requisition');
  }
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
  ECONOMIC_ACTION_PATTERNS,
  createPurchaseRequisition,
  detectEconomicAction,
  evaluateFinancialControl,
  getLedgerHeadPath,
  getLedgerPath,
  getRuntimePrincipal,
  listPurchaseRequisitions,
  projectRequisition,
  readEvents,
  reconcilePurchaseLedger,
  reservePurchaseRequisition,
  settlePurchaseRequisition,
};
