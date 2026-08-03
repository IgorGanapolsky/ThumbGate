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
const { withFileLedgerLock } = require('./file-ledger-lock');
const {
  getEscalation,
  getVerifiedApproval,
  requestEscalation,
} = require('./human-escalation');

const LEDGER_FILE = 'financial-control-ledger.jsonl';
const LEDGER_HEAD_FILE = 'financial-control-ledger.head.json';
const LEDGER_JOURNAL_FILE = 'financial-control-ledger.journal.json';
const LEDGER_HEAD_SCHEMA = 'financial-ledger-head-v2';
const LEDGER_JOURNAL_SCHEMA = 'financial-ledger-journal-v2';
const LEDGER_ANCHOR_SCHEMA = 'financial-ledger-anchor-v1';
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

const SCREEN_TOOL_PATTERN = /(?:browser|computer|playwright|puppeteer|selenium|click|tap|press)/i;
const SCREEN_MUTATION_PATTERN = /(?:click|double[_ -]?click|tap|press|select|submit|confirm|activate)/i;
const SCREEN_OBSERVATION_PATTERN = /(?:screenshot|snapshot)/i;

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

function getLedgerJournalPath(options = {}) {
  if (options.inputPath) return `${path.resolve(options.inputPath)}.journal.json`;
  return path.join(getFeedbackPaths(options).FEEDBACK_DIR, LEDGER_JOURNAL_FILE);
}

function financialLedgerId(options = {}) {
  const configured = optionalString(options.financialLedgerId);
  if (configured) return configured;
  return `ledger_${crypto.createHash('sha256').update(getLedgerPath(options)).digest('hex')}`;
}

/**
 * Return the operator-owned monotonic anchor store. The store is deliberately
 * injected by the trusted host instead of selected through tool input. Its
 * state must live outside the agent-writable device filesystem (for example a
 * remote compare-and-set service or a hardware-backed host daemon).
 *
 * A file-backed implementation is available only behind an explicit test-only
 * switch. It exercises crash recovery but is not rollback-resistant and must
 * never be treated as a production control.
 */
function financialLedgerAnchorStore(options = {}) {
  const store = options.financialLedgerAnchorStore;
  if (store && typeof store.read === 'function' && typeof store.compareAndSet === 'function') {
    return store;
  }
  const testPath = optionalString(process.env.THUMBGATE_TEST_ONLY_FINANCIAL_ANCHOR_FILE);
  if (testPath && process.env.THUMBGATE_ALLOW_UNTRUSTED_FILE_ANCHOR_FOR_TESTS === '1') {
    return testOnlyFileAnchorStore(path.resolve(testPath));
  }
  throw financialError('rollback-resistant financial ledger anchor is required');
}

function testOnlyFileAnchorStore(anchorPath) {
  return {
    read() {
      try {
        return JSON.parse(fs.readFileSync(anchorPath, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    compareAndSet({ expected, next }) {
      let current = null;
      try {
        current = JSON.parse(fs.readFileSync(anchorPath, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (!sameHead(current, expected)) return false;
      writeAtomicJson(anchorPath, next);
      return true;
    },
  };
}

function readFinancialLedgerAnchor(options = {}) {
  const anchor = financialLedgerAnchorStore(options).read({
    ledgerId: financialLedgerId(options),
  });
  if (anchor === null || anchor === undefined) return null;
  if (anchor.schemaVersion !== LEDGER_ANCHOR_SCHEMA
    || !Number.isInteger(anchor.sequence)
    || anchor.sequence < 1
    || !/^[a-f0-9]{64}$/i.test(String(anchor.eventHash || ''))) {
    throw financialError('rollback-resistant financial ledger anchor is malformed');
  }
  return anchor;
}

function advanceFinancialLedgerAnchor(previousHead, event, options = {}) {
  const store = financialLedgerAnchorStore(options);
  const ledgerId = financialLedgerId(options);
  const next = {
    schemaVersion: LEDGER_ANCHOR_SCHEMA,
    sequence: event.sequence,
    eventHash: event.eventHash,
  };
  const current = readFinancialLedgerAnchor(options);
  if (sameHead(current, next)) return next;
  if (!sameHead(current, previousHead)) {
    throw financialError('rollback-resistant financial ledger anchor rejected a stale checkpoint');
  }
  const advanced = store.compareAndSet({
    ledgerId,
    expected: previousHead
      ? { schemaVersion: LEDGER_ANCHOR_SCHEMA, sequence: previousHead.sequence, eventHash: previousHead.eventHash }
      : null,
    next,
  });
  if (advanced !== true || !sameHead(readFinancialLedgerAnchor(options), next)) {
    throw financialError('rollback-resistant financial ledger anchor compare-and-set failed');
  }
  return next;
}

function detectEconomicAction(toolName, toolInput = {}) {
  const normalizedToolName = String(toolName || '').trim();
  if ([...CONTROL_PLANE_TOOLS].some((name) => (
    normalizedToolName === name || normalizedToolName.endsWith(`__${name}`)
  ))) return false;
  const metadata = objectValue(toolInput.metadata);
  const financialControl = objectValue(toolInput.financialControl || toolInput.financial_control);
  if (toolInput.economicAction === true || metadata.economicAction === true) return true;
  if (financialControl.requisitionId || financialControl.reservationId) return true;
  // Native browser/computer-use locators do not reveal what a click will do.
  // Treat them as economic until the exact screen mutation is independently
  // approved; caller-supplied prose must never downgrade a blind click.
  if (detectOpaqueScreenMutation(normalizedToolName, toolInput)) return true;
  const command = shellEconomicText(normalizedToolName, toolInput.command || toolInput.cmd);
  const combined = [
    normalizedToolName.replace(/[_-]+/g, ' '),
    command,
    toolInput.goal,
    toolInput.action,
    toolInput.operation,
    metadata.context,
  ].map((value) => String(value || '')).join(' ');
  return ECONOMIC_ACTION_PATTERNS.some((pattern) => pattern.test(combined));
}

function detectOpaqueScreenMutation(toolName, toolInput = {}) {
  const normalizedToolName = String(toolName || '').trim();
  const input = objectValue(toolInput);
  const declaredOperation = [input.action, input.operation, input.type]
    .map((value) => String(value || ''))
    .join(' ');
  const toolDeclaresMutation = SCREEN_MUTATION_PATTERN.test(normalizedToolName);
  const declaredMutation = SCREEN_MUTATION_PATTERN.test(declaredOperation);
  const toolDeclaresObservation = SCREEN_OBSERVATION_PATTERN.test(normalizedToolName);
  const declaredObservation = SCREEN_OBSERVATION_PATTERN.test(declaredOperation);
  if (toolDeclaresObservation || (!toolDeclaresMutation && !declaredMutation && declaredObservation)) {
    return false;
  }
  const hasCoordinate = Object.hasOwn(input, 'coordinate') || Object.hasOwn(input, 'coordinates')
    || (Object.hasOwn(input, 'x') && Object.hasOwn(input, 'y'));
  const hasOpaqueLocator = hasCoordinate
    || Object.hasOwn(input, 'selector')
    || Object.hasOwn(input, 'element')
    || Object.hasOwn(input, 'ref')
    || Object.hasOwn(input, 'elementId')
    || Object.hasOwn(input, 'element_id')
    || Object.hasOwn(input, 'nodeId')
    || Object.hasOwn(input, 'node_id')
    || (Object.hasOwn(input, 'ref_id') && Object.hasOwn(input, 'id'));
  if (!hasOpaqueLocator || !SCREEN_TOOL_PATTERN.test(normalizedToolName)) return false;
  return toolDeclaresMutation || declaredMutation
    || /(?:browser|computer|playwright|puppeteer|selenium)/i.test(normalizedToolName);
}

function shellEconomicText(toolName, rawCommand) {
  if (!/^(?:bash|shell|terminal|execute_command|exec_command)$/i.test(toolName)) {
    return rawCommand;
  }
  const command = String(rawCommand || '');
  return command
    .split(/(?:&&|\|\||[;\n]|(?<!\|)\|(?!\|))/)
    .map((segment) => {
      const clean = segment.trim().replace(/^(?:sudo\s+)?(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*/, '');
      const executable = clean.match(/^([A-Za-z0-9_.\/-]+)/)?.[1]?.split('/').at(-1)?.toLowerCase();
      if (['rg', 'grep', 'git', 'cat', 'head', 'tail', 'less', 'more', 'echo', 'printf'].includes(executable)) return '';
      return clean;
    })
    .join(' ');
}

function createPurchaseRequisition(input = {}, options = {}) {
  rejectCallerSelectedRequester(input);
  const now = options.now || new Date();
  const requester = authenticatedPrincipal(options);
  const taskId = requiredString(input.taskId, 'taskId');
  const vendor = requiredString(input.vendor, 'vendor');
  const purpose = requiredString(input.purpose, 'purpose');
  const sourceMessageId = requiredString(input.sourceMessageId, 'sourceMessageId');
  const amountUsd = positiveMoney(input.amountUsd, 'amountUsd');
  const approvedAction = buildActionAuthorization(input.toolName, input.toolInput, amountUsd);
  if (!detectEconomicAction(approvedAction.toolName, objectValue(input.toolInput))) {
    throw financialError('purchase requisitions must bind an exact economic tool action');
  }
  const evidence = stringArray(input.evidence);
  if (evidence.length === 0) throw financialError('evidence must contain at least one item');
  const ttlMs = boundedTtl(input.ttlMs, DEFAULT_TTL_MS);
  const idempotencyKey = requiredString(input.idempotencyKey || `${taskId}:${sourceMessageId}`, 'idempotencyKey');
  const requestIntent = {
    idempotencyKey,
    taskId,
    requester,
    vendor,
    purpose,
    sourceMessageId,
    amountUsd,
    approvedToolName: approvedAction.toolName,
    actionFingerprint: approvedAction.fingerprint,
    evidence,
  };
  // The financial and escalation ledgers are separate durable resources. A
  // retry after the escalation append but before the financial append must
  // reproduce the same identity and signed digest instead of stranding the
  // already-recorded approval behind an idempotency conflict.
  const requisitionId = input.requisitionId || stableRequisitionId(requestIntent);
  const approvalContextDigest = requestComparableHash({ requisitionId, ...requestIntent });
  return withLedgerLock(options, () => {
    const ledger = readLedger(options);
    const chain = validateLedgerChain(ledger.events, ledger.malformedRows, ledger.head, options);
    if (!chain.ok) throw financialError('financial ledger integrity verification failed');
    const existing = requisitionsFromEvents(ledger.events, options)
      .find((entry) => entry.idempotencyKey === idempotencyKey);
    if (existing) {
      if (requestIntentHash(existing) !== requestIntentHash(requestIntent)
        || (input.requisitionId && input.requisitionId !== existing.requisitionId)) {
        const error = financialError(`conflicting requisition for idempotency key '${idempotencyKey}'`);
        error.code = 'THUMBGATE_IDEMPOTENCY_CONFLICT';
        throw error;
      }
      return { recorded: false, duplicate: true, requisition: existing };
    }
    const escalationResult = requestEscalation({
      taskId,
      reason: `Purchase approval required: $${amountUsd.toFixed(2)} USD to ${vendor} for ${purpose}; exact action ${approvedAction.fingerprint}`,
      severity: 'critical',
      requester,
      evidence: [
        ...evidence,
        `sourceMessageId:${sourceMessageId}`,
        `requisitionId:${requisitionId}`,
      ],
      approvalContextDigest,
      ttlMs,
      idempotencyKey: `purchase:${idempotencyKey}`,
    }, options);
    const recorded = appendEventUnlocked({
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
      approvedToolName: approvedAction.toolName,
      actionFingerprint: approvedAction.fingerprint,
      approvalContextDigest,
      currency: 'USD',
      evidence,
      requestedAt: now.toISOString(),
      // Cross-ledger retries must retain the deadline of the original human
      // escalation. Refreshing the financial deadline here would let a retry
      // resurrect an approval whose signed request already expired.
      expiresAt: escalationResult.escalation.expiresAt,
    }, options, ledger.events);
    return {
      recorded: true,
      duplicate: false,
      requisition: projectRequisitionFromEvents([...ledger.events, recorded], requisitionId, options),
    };
  });
}

function reservePurchaseRequisition(input = {}, options = {}) {
  rejectCallerSelectedRequester(input);
  const now = options.now || new Date();
  const requester = authenticatedPrincipal(options);
  const requisitionId = requiredString(input.requisitionId, 'requisitionId');
  return withLedgerLock(options, () => {
    const ledger = readLedger(options);
    assertLedgerHealthyData(ledger, options);
    const requisition = projectRequisitionFromEvents(ledger.events, requisitionId, options);
    if (!requisition) throw financialError(`unknown requisition '${requisitionId}'`);
    assertPrincipalOwnsRequisition(requester, requisition);
    const escalation = verifyPurchaseApprovalBinding(requisition, options);
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
    if (!requisition.actionFingerprint || !requisition.approvedToolName) {
      throw financialError(`requisition '${requisitionId}' predates exact-action authorization and cannot be reserved`);
    }

    const amountUsd = positiveMoney(input.amountUsd ?? requisition.amountUsd, 'amountUsd');
    if (amountUsd > requisition.amountUsd) {
      throw financialError(`reservation $${amountUsd.toFixed(2)} exceeds approved amount $${requisition.amountUsd.toFixed(2)}`);
    }
    assertScopeMatches(input, requisition);
    const ttlMs = boundedTtl(input.ttlMs, DEFAULT_RESERVATION_TTL_MS);
    const recorded = appendEventUnlocked({
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
      approvedToolName: requisition.approvedToolName,
      actionFingerprint: requisition.actionFingerprint,
      amountUsd,
      currency: 'USD',
      reservedAt: now.toISOString(),
      reservationExpiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    }, options, ledger.events);
    return {
      recorded: true,
      duplicate: false,
      requisition: projectRequisitionFromEvents([...ledger.events, recorded], requisitionId, options),
    };
  });
}

function settlePurchaseRequisition(input = {}, options = {}) {
  rejectCallerSelectedRequester(input);
  const now = options.now || new Date();
  const requester = authenticatedPrincipal(options);
  const requisitionId = requiredString(input.requisitionId, 'requisitionId');
  const reservationId = requiredString(input.reservationId, 'reservationId');
  const status = requiredString(input.status, 'status');
  if (!SETTLEMENT_STATUSES.has(status)) {
    throw financialError('status must be committed or released');
  }
  return withLedgerLock(options, () => {
    const ledger = readLedger(options);
    assertLedgerHealthyData(ledger, options);
    const requisition = projectRequisitionFromEvents(ledger.events, requisitionId, options);
    if (!requisition) throw financialError(`unknown requisition '${requisitionId}'`);
    const allowedStates = status === 'committed' ? ['authorized'] : ['reserved', 'authorized'];
    if (!allowedStates.includes(requisition.status)) {
      throw financialError(`requisition '${requisitionId}' is ${requisition.status}, not ${allowedStates.join(' or ')}`);
    }
    if (reservationId !== requisition.reservationId) {
      throw financialError('reservationId does not match the active reservation');
    }
    assertPrincipalOwnsRequisition(requester, requisition);
    verifyPurchaseApprovalBinding(requisition, options);
    assertReservationBoundToApproval(requisition);

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
    const recorded = appendEventUnlocked(base, options, ledger.events);
    return {
      recorded: true,
      requisition: projectRequisitionFromEvents([...ledger.events, recorded], requisitionId, options),
    };
  });
}

function listPurchaseRequisitions(options = {}) {
  const events = readEvents(options);
  return requisitionsFromEvents(events, options);
}

function requisitionsFromEvents(events, options = {}) {
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
  return withLedgerLock(options, () => reconcilePurchaseLedgerUnlocked(options));
}

function reconcilePurchaseLedgerUnlocked(options = {}) {
  const ledger = readLedger(options);
  const chain = validateLedgerChain(ledger.events, ledger.malformedRows, ledger.head, options);
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
    actionBinding: buildActionAuthorization(input.toolName, toolInput, finiteNumber(input.costControl?.usage?.estimatedCostUsd, 0)),
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
    const anchorUnavailable = reconciliation.ledgerHeadMismatches.some(
      (entry) => optionalString(entry.rollbackResistantAnchorError)
    );
    if (anchorUnavailable) {
      addBlock(
        result,
        'financial_ledger_anchor_unavailable',
        'Rollback-resistant financial ledger anchor is unavailable; financial actions fail closed.'
      );
      return;
    }
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
  try {
    verifyPurchaseApprovalBinding(requisition, options);
  } catch (error) {
    addBlock(result, 'financial_approval_binding_invalid', error.message);
  }
  try {
    assertReservationBoundToApproval(requisition);
  } catch (error) {
    addBlock(result, 'reservation_not_bound_to_approval', error.message);
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
  if (!requisition.actionFingerprint
    || result.actionBinding.fingerprint !== requisition.actionFingerprint) {
    addBlock(result, 'financial_action_mismatch', 'Actual tool action or USD amount does not match the independently approved action fingerprint.');
  }
  if (normalizeToolName(result.actionBinding.toolName) !== normalizeToolName(requisition.approvedToolName)) {
    addBlock(result, 'financial_tool_mismatch', 'Actual financial tool does not match the approved tool.');
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
      actionFingerprint: result.actionBinding.fingerprint,
      vendor: result.control.vendor,
      purpose: result.control.purpose,
      sourceMessageId: result.control.sourceMessageId,
    }, options);
    result.requisition = result.authorization;
  } catch (error) {
    addBlock(result, 'reservation_consumption_failed', error.message);
  }
}

function consumeReservation(input, options) {
  return withLedgerLock(options, () => {
    const ledger = readLedger(options);
    const chain = validateLedgerChain(ledger.events, ledger.malformedRows, ledger.head, options);
    if (!chain.ok) throw financialError('financial ledger integrity check failed before authorization');
    const current = projectRequisitionFromEvents(ledger.events, input.requisitionId, options);
    if (!current || current.status !== 'reserved') {
      throw financialError(`purchase requisition '${input.requisitionId}' is not available for single-use authorization`);
    }
    if (current.reservationId !== input.reservationId) {
      throw financialError('reservation changed before authorization');
    }
    assertPrincipalOwnsRequisition(input.principal, current);
    verifyPurchaseApprovalBinding(current, options);
    assertReservationBoundToApproval(current);
    if (input.estimatedCostUsd > current.reservedAmountUsd) {
      throw financialError('estimated cost exceeds the signed purchase reservation');
    }
    if (input.actionFingerprint !== current.actionFingerprint) {
      throw financialError('financial action changed before authorization');
    }
    if (normalizeToolName(input.toolName) !== normalizeToolName(current.approvedToolName)) {
      throw financialError('financial tool changed before authorization');
    }
    assertScopeMatches(input, current);
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
      actionFingerprint: input.actionFingerprint,
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
      actionFingerprint: requisition.actionFingerprint || null,
      approvedToolName: requisition.approvedToolName || null,
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

function appendEventUnlocked(event, options, existingEvents) {
  const outputPath = getLedgerPath(options);
  const previous = existingEvents.at(-1) || null;
  const previousHead = previous
    ? { sequence: previous.sequence, eventHash: previous.eventHash }
    : null;
  // Resolve and verify the rollback-resistant witness before touching local
  // durable state. Missing production witness configuration therefore fails
  // closed without leaving a half-written financial transaction behind.
  const currentAnchor = readFinancialLedgerAnchor(options);
  if (!sameHead(currentAnchor, previousHead)) {
    throw financialError('rollback-resistant financial ledger anchor does not match the current ledger');
  }
  const chained = {
    ...event,
    sequence: existingEvents.length + 1,
    previousEventHash: previous?.eventHash || null,
  };
  chained.eventHash = hashEvent(chained);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const journalPath = getLedgerJournalPath(options);
  const journal = {
    schemaVersion: LEDGER_JOURNAL_SCHEMA,
    previousHead,
    event: chained,
  };
  journal.auth = signIntegrityRecord(journal, ledgerIntegrityKey(options));
  writeAtomicJson(journalPath, journal);
  const ledgerFd = fs.openSync(outputPath, 'a', 0o600);
  try {
    fs.writeSync(ledgerFd, `${JSON.stringify(chained)}\n`, null, 'utf8');
    fs.fsyncSync(ledgerFd);
  } finally {
    fs.closeSync(ledgerFd);
  }
  fsyncDirectoryFor(outputPath);
  writeLedgerHeadFile(chained, options);
  advanceFinancialLedgerAnchor(previousHead, chained, options);
  removeDurableFile(journalPath);
  return chained;
}

function writeLedgerHeadFile(event, options) {
  const headPath = getLedgerHeadPath(options);
  const temporaryPath = `${headPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const head = {
    schemaVersion: LEDGER_HEAD_SCHEMA,
    sequence: event.sequence,
    eventHash: event.eventHash,
  };
  head.auth = signIntegrityRecord(head, ledgerIntegrityKey(options));
  writeAtomicJson(headPath, head, temporaryPath);
}

function withLedgerLock(options, callback) {
  return withFileLedgerLock(`${getLedgerPath(options)}.lock`, callback, {
    now: options.now,
    lockStaleMs: options.lockStaleMs,
    errorFactory: (message) => financialError(message),
    beforeCallback: () => recoverLedgerTransaction(options),
  });
}

function recoverLedgerTransaction(options = {}) {
  const journalPath = getLedgerJournalPath(options);
  let journal;
  try {
    journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw financialError(`cannot recover financial ledger journal: ${error.message}`);
  }
  const integrityKey = ledgerIntegrityKey(options);
  if (journal?.schemaVersion !== LEDGER_JOURNAL_SCHEMA
    || !journal.event
    || journal.event.eventHash !== hashEvent(journal.event)
    || !verifyIntegrityRecord(journal, integrityKey)) {
    throw financialError('financial ledger journal integrity verification failed');
  }

  const ledger = readLedger(options);
  const event = journal.event;
  const currentLast = ledger.events.at(-1) || null;
  const previousHead = journal.previousHead;
  const currentHead = ledger.head;
  const currentAnchor = readFinancialLedgerAnchor(options);
  const eventAlreadyAppended = currentLast?.sequence === event.sequence
    && currentLast?.eventHash === event.eventHash;
  const headAtPrevious = sameHead(currentHead, previousHead);
  const headAtEvent = sameHead(currentHead, { sequence: event.sequence, eventHash: event.eventHash });

  if (eventAlreadyAppended) {
    const preceding = ledger.events.at(-2) || null;
    const expectedPrevious = preceding
      ? { sequence: preceding.sequence, eventHash: preceding.eventHash }
      : null;
    const chain = validateLedgerChain(
      ledger.events,
      ledger.malformedRows,
      null,
      { ...options, skipLedgerHead: true }
    );
    const anchorAtPrevious = sameHead(currentAnchor, previousHead);
    const anchorAtEvent = sameHead(currentAnchor, { sequence: event.sequence, eventHash: event.eventHash });
    if (!sameHead(previousHead, expectedPrevious)
      || !chain.ok
      || (!headAtPrevious && !headAtEvent)
      || (!anchorAtPrevious && !anchorAtEvent)) {
      throw financialError('financial ledger journal does not match the recoverable append');
    }
    if (!headAtEvent) writeLedgerHeadFile(event, options);
    if (!anchorAtEvent) advanceFinancialLedgerAnchor(previousHead, event, options);
    removeDurableFile(journalPath);
    return;
  }

  const currentChain = validateLedgerChain(ledger.events, ledger.malformedRows, ledger.head, options);
  if (currentChain.ok
    && headAtPrevious
    && sameHead(currentAnchor, previousHead)
    && event.sequence === ledger.events.length + 1) {
    // The crash happened before the event append. The caller never received a
    // success response, so discard the prepared transaction instead of
    // executing it during recovery.
    removeDurableFile(journalPath);
    return;
  }
  throw financialError('financial ledger journal cannot be reconciled safely');
}

function sameHead(left, right) {
  if (!left && !right) return true;
  return left?.sequence === right?.sequence && left?.eventHash === right?.eventHash;
}

function writeAtomicJson(targetPath, value, temporaryPath = null) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporary = temporaryPath || `${targetPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const fd = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(value)}\n`, null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, targetPath);
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

function validateLedgerChain(events, malformedRows = [], ledgerHead = null, options = {}) {
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
  const ledgerHeadMismatches = options.skipLedgerHead
    ? []
    : validateLedgerHead(events, ledgerHead, options);
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

function validateLedgerHead(events, ledgerHead, options = {}) {
  const expected = events.at(-1) || { sequence: 0, eventHash: null };
  const key = optionalString(
    options.financialLedgerIntegrityKey
      || options.approvalVerificationKey
      || options.approvalSigningKey
      || process.env.THUMBGATE_FINANCIAL_LEDGER_KEY
      || process.env.THUMBGATE_HUMAN_REVIEWER_KEY
  );
  let anchor = null;
  let anchorError = null;
  try {
    anchor = readFinancialLedgerAnchor(options);
  } catch (error) {
    anchorError = error.message;
  }
  if (events.length === 0 && ledgerHead === null && anchor === null && !anchorError) return [];
  if (key
    && ledgerHead?.schemaVersion === LEDGER_HEAD_SCHEMA
    && ledgerHead.sequence === expected.sequence
    && ledgerHead.eventHash === expected.eventHash
    && verifyIntegrityRecord(ledgerHead, key)
    && sameHead(anchor, expected)) return [];
  return [{
    recordedSequence: ledgerHead?.sequence ?? null,
    expectedSequence: expected.sequence,
    recordedEventHash: ledgerHead?.eventHash ?? null,
    expectedEventHash: expected.eventHash,
    authenticated: Boolean(key && verifyIntegrityRecord(ledgerHead, key)),
    rollbackResistantAnchorSequence: anchor?.sequence ?? null,
    rollbackResistantAnchorEventHash: anchor?.eventHash ?? null,
    rollbackResistantAnchorError: anchorError,
  }];
}

function assertLedgerHealthyData(ledger, options = {}) {
  if (!validateLedgerChain(ledger.events, ledger.malformedRows, ledger.head, options).ok) {
    throw financialError('financial ledger integrity verification failed');
  }
}

function ledgerIntegrityKey(options = {}) {
  const key = optionalString(
    options.financialLedgerIntegrityKey
      || options.approvalVerificationKey
      || options.approvalSigningKey
      || process.env.THUMBGATE_FINANCIAL_LEDGER_KEY
      || process.env.THUMBGATE_HUMAN_REVIEWER_KEY
  );
  if (!key) {
    throw financialError('financial ledger integrity key is required');
  }
  return key;
}

function signIntegrityRecord(record, key) {
  return {
    algorithm: 'hmac-sha256',
    keyId: crypto.createHash('sha256').update(key).digest('hex').slice(0, 16),
    signature: crypto.createHmac('sha256', key).update(integrityPayload(record)).digest('hex'),
  };
}

function verifyIntegrityRecord(record, key) {
  const auth = record?.auth;
  if (!record || !auth || auth.algorithm !== 'hmac-sha256') return false;
  const expectedKeyId = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  if (auth.keyId !== expectedKeyId || !/^[a-f0-9]{64}$/i.test(String(auth.signature || ''))) return false;
  const expected = crypto.createHmac('sha256', key).update(integrityPayload(record)).digest();
  const actual = Buffer.from(auth.signature, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function integrityPayload(record) {
  const copy = { ...record };
  delete copy.auth;
  return stableStringify(copy);
}

function hashEvent(event) {
  const copy = { ...event };
  delete copy.eventHash;
  return crypto.createHash('sha256').update(stableStringify(copy)).digest('hex');
}

function requestComparableHash(event) {
  const comparable = {
    requisitionId: event.requisitionId,
    ...requestIntentComparable(event),
  };
  return crypto.createHash('sha256').update(stableStringify(comparable)).digest('hex');
}

function requestIntentHash(event) {
  return crypto.createHash('sha256').update(stableStringify(requestIntentComparable(event))).digest('hex');
}

function stableRequisitionId(requestIntent) {
  return `req_${requestIntentHash(requestIntent).slice(0, 32)}`;
}

function requestIntentComparable(event) {
  return {
    idempotencyKey: event.idempotencyKey,
    taskId: event.taskId,
    requester: event.requester,
    vendor: event.vendor,
    purpose: event.purpose,
    sourceMessageId: event.sourceMessageId,
    amountUsd: event.amountUsd,
    approvedToolName: event.approvedToolName,
    actionFingerprint: event.actionFingerprint,
    evidence: event.evidence,
  };
}

function stableStringify(value) {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
  const properties = keys.map((key) => [JSON.stringify(key), stableStringify(value[key])].join(':'));
  return ['{', properties.join(','), '}'].join('');
}

function buildActionAuthorization(toolName, toolInput, amountUsd) {
  const normalizedToolName = normalizeToolName(requiredString(toolName, 'toolName'));
  const exactToolInput = objectValue(toolInput);
  if (Object.keys(exactToolInput).length === 0) throw financialError('toolInput for the exact economic action is required');
  const payload = {
    schemaVersion: 'financial-action-authorization-v1',
    toolName: normalizedToolName,
    toolInput: stripControlMetadata(exactToolInput),
    amountUsd: roundMoney(Math.max(0, finiteNumber(amountUsd, 0))),
  };
  return {
    toolName: normalizedToolName,
    fingerprint: crypto.createHash('sha256').update(stableStringify(payload)).digest('hex'),
  };
}

function stripControlMetadata(value, depth = 0) {
  if (Array.isArray(value)) return value.map((entry) => stripControlMetadata(entry, depth + 1));
  if (!value || typeof value !== 'object') return value;
  // Only the explicitly namespaced ThumbGate authorization envelope is
  // transport metadata. Unnamespaced provider fields such as budget and usage
  // are economic inputs even at the tool_input root and must remain inside the
  // signed fingerprint. Hook cost telemetry belongs in costControl, not here.
  const excluded = depth === 0
    ? new Set(['financialControl', 'financial_control'])
    : new Set();
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !excluded.has(key))
    .map(([key, entry]) => [key, stripControlMetadata(entry, depth + 1)]));
}

function verifyPurchaseApprovalBinding(requisition, options) {
  let escalation;
  try {
    escalation = getVerifiedApproval(requisition.escalationId, options);
  } catch (error) {
    throw financialError(`requisition '${requisition.requisitionId}' approval verification failed: ${error.message}`);
  }
  if (!escalation || escalation.status !== 'approved') {
    throw financialError(`requisition '${requisition.requisitionId}' does not have independent human approval`);
  }
  const expectedApprovalContextDigest = requestComparableHash(requisition);
  if (!requisition.approvalContextDigest
    || requisition.approvalContextDigest !== expectedApprovalContextDigest
    || escalation.approvalContextDigest !== expectedApprovalContextDigest) {
    throw financialError(`requisition '${requisition.requisitionId}' approval is not bound to its exact purchase request`);
  }
  if (sameIdentity(requisition.requester, escalation.actor)) {
    throw financialError('requester cannot approve their own requisition');
  }
  return escalation;
}

function assertReservationBoundToApproval(requisition) {
  if (!['reserved', 'authorized', 'committed'].includes(requisition.status)) return;
  const reservation = requisition.timeline.findLast((event) => event.eventType === 'reserved');
  if (!reservation) throw financialError('reserved purchase has no reservation event');
  if (positiveMoney(reservation.amountUsd, 'reserved amount') > requisition.amountUsd) {
    throw financialError('reserved amount exceeds the signed purchase request');
  }
  if (reservation.actionFingerprint !== requisition.actionFingerprint
    || normalizeToolName(reservation.approvedToolName) !== normalizeToolName(requisition.approvedToolName)) {
    throw financialError('reservation action does not match the signed purchase request');
  }
  assertScopeMatches(reservation, requisition);
  if (!sameIdentity(reservation.requester, requisition.requester)) {
    throw financialError('reservation requester does not match the signed purchase request');
  }
}

function normalizeToolName(value) {
  return String(value || '').trim().toLowerCase();
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
  buildActionAuthorization,
  detectEconomicAction,
  detectOpaqueScreenMutation,
  evaluateFinancialControl,
  getLedgerHeadPath,
  getLedgerJournalPath,
  getLedgerPath,
  getRuntimePrincipal,
  listPurchaseRequisitions,
  projectRequisition,
  readEvents,
  reconcilePurchaseLedger,
  reservePurchaseRequisition,
  settlePurchaseRequisition,
};
