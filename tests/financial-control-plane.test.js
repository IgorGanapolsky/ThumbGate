'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const {
  createPurchaseRequisition,
  detectEconomicAction,
  evaluateFinancialControl,
  getLedgerHeadPath,
  getLedgerPath,
  getRuntimePrincipal,
  projectRequisition,
  reconcilePurchaseLedger,
  reservePurchaseRequisition,
  settlePurchaseRequisition,
} = require('../scripts/financial-control-plane');
const {
  decideEscalation,
  getEscalationsHeadPath,
  getEscalationsPath,
  requestEscalation,
  validateEscalationLedger,
} = require('../scripts/human-escalation');
const { finalizeFinancialAuthorization, runHardFloor } = require('../scripts/gates-engine');
const APPROVAL_KEY = 'independent-human-reviewer-signing-key';

function fixture() {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-financial-control-'));
  const requester = { id: 'agent-operator', kind: 'agent' };
  const request = {
    taskId: 'upgrade-task-1',
    vendor: 'Apollo',
    amountUsd: 588,
    purpose: 'Annual data plan',
    sourceMessageId: 'user-message-42',
    evidence: ['Quoted annual price: $588'],
    idempotencyKey: 'apollo-annual-2026',
  };
  return { feedbackDir, requester, request };
}

function authOptions(feedbackDir, requester, extra = {}) {
  return {
    feedbackDir,
    authenticatedPrincipal: requester,
    approvalVerificationKey: APPROVAL_KEY,
    ...extra,
  };
}

function reviewerOptions(feedbackDir) {
  return {
    feedbackDir,
    authenticatedActor: { id: 'finance-reviewer', kind: 'human' },
    approvalSigningKey: APPROVAL_KEY,
  };
}

function hashEscalationEvent(event) {
  const copy = { ...event };
  delete copy.eventHash;
  const stableStringify = (value) => {
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  };
  return require('node:crypto').createHash('sha256').update(stableStringify(copy)).digest('hex');
}

test('purchase lifecycle requires independent approval, exact scope, reservation, and receipt', () => {
  const { feedbackDir, requester, request } = fixture();
  try {
    const created = createPurchaseRequisition(request, authOptions(feedbackDir, requester));
    assert.equal(created.recorded, true);
    assert.equal(created.requisition.status, 'pending_approval');

    const duplicate = createPurchaseRequisition(request, authOptions(feedbackDir, requester));
    assert.equal(duplicate.recorded, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.requisition.requisitionId, created.requisition.requisitionId);

    assert.throws(() => reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
    }, authOptions(feedbackDir, requester)), /does not have independent human approval/);

    decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'approved',
      reason: 'Verified exact vendor, purpose, and amount.',
    }, reviewerOptions(feedbackDir));

    assert.throws(() => reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'different-message',
    }, authOptions(feedbackDir, requester)), /sourceMessageId does not match/);

    const reserved = reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
      idempotencyKey: 'apollo-annual-reservation',
    }, authOptions(feedbackDir, requester));
    assert.equal(reserved.requisition.status, 'reserved');
    assert.equal(reserved.requisition.reservedAmountUsd, 588);
    assert.deepEqual(reserved.requisition.approvedBy, { id: 'finance-reviewer', kind: 'human' });

    const control = evaluateFinancialControl({
      toolName: 'Browser',
      toolInput: {
        command: 'Click Subscribe and confirm checkout',
        financialControl: {
          requisitionId: reserved.requisition.requisitionId,
          reservationId: reserved.requisition.reservationId,
          actionId: 'apollo-checkout-once',
          vendor: 'Apollo',
          purpose: 'Annual data plan',
          sourceMessageId: 'user-message-42',
        },
      },
      actionProfile: { economicAction: true },
      costControl: {
        mode: 'allow',
        budget: {
          maxCostUsdPerAction: 588,
          remainingCostUsd: 588,
          hasMaxCostUsdPerAction: true,
          hasRemainingCostUsd: true,
        },
        usage: { estimatedCostUsd: 588 },
      },
    }, authOptions(feedbackDir, requester, { consumeReservation: true }));
    assert.equal(control.mode, 'allow');
    assert.equal(control.authorization.reservationId, reserved.requisition.reservationId);
    assert.equal(control.authorization.status, 'authorized');

    const replay = evaluateFinancialControl({
      toolName: 'Browser',
      toolInput: {
        command: 'Click Subscribe and confirm checkout',
        financialControl: {
          requisitionId: reserved.requisition.requisitionId,
          reservationId: reserved.requisition.reservationId,
          actionId: 'apollo-checkout-retry',
          vendor: 'Apollo',
          purpose: 'Annual data plan',
          sourceMessageId: 'user-message-42',
        },
      },
      actionProfile: { economicAction: true },
      costControl: {
        mode: 'allow',
        budget: {
          maxCostUsdPerAction: 588,
          remainingCostUsd: 588,
          hasMaxCostUsdPerAction: true,
          hasRemainingCostUsd: true,
        },
        usage: { estimatedCostUsd: 588 },
      },
    }, authOptions(feedbackDir, requester, { consumeReservation: true }));
    assert.equal(replay.mode, 'block');
    assert.ok(replay.reasonCodes.includes('requisition_not_reserved'));

    const settled = settlePurchaseRequisition({
      requisitionId: reserved.requisition.requisitionId,
      reservationId: reserved.requisition.reservationId,
      status: 'committed',
      actualAmountUsd: 588,
      evidence: ['provider-receipt:receipt_123'],
    }, authOptions(feedbackDir, requester));
    assert.equal(settled.requisition.status, 'committed');

    const reconciliation = reconcilePurchaseLedger({ feedbackDir });
    assert.equal(reconciliation.ok, true);
    assert.deepEqual(reconciliation.totals, {
      approvedUsd: 588,
      reservedUsd: 0,
      authorizedUsd: 0,
      committedUsd: 588,
    });
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('financial control fails closed on zero budgets and missing authorization', () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-zero-budget-'));
  try {
    const control = evaluateFinancialControl({
      toolName: 'Browser',
      toolInput: { command: 'upgrade Apollo, add payment method, click Subscribe' },
      actionProfile: { economicAction: true },
      costControl: {
        mode: 'block',
        budget: {
          maxCostUsdPerAction: 0,
          remainingCostUsd: 0,
          hasMaxCostUsdPerAction: true,
          hasRemainingCostUsd: true,
        },
        usage: { estimatedCostUsd: 588 },
        reasons: ['Estimated cost exceeds zero budget.'],
      },
    }, { feedbackDir });

    assert.equal(control.mode, 'block');
    assert.ok(control.reasonCodes.includes('zero_spend_budget'));
    assert.ok(control.reasonCodes.includes('missing_purchase_requisition'));
    assert.ok(control.reasonCodes.includes('missing_budget_reservation'));
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('provider names in credential paths and read-only billing commands are not transactions', () => {
  assert.equal(detectEconomicAction('Bash', {
    command: 'chmod 600 ~/.resume_secrets/stripe.json',
  }), false);
  assert.equal(detectEconomicAction('Bash', {
    command: 'cat docs/billing-and-paypal.md',
  }), false);
  assert.equal(detectEconomicAction('Browser', {
    command: 'upgrade Apollo, add payment method, click Subscribe',
  }), true);
  assert.equal(detectEconomicAction('Bash', {
    command: 'stripe subscriptions create --customer cus_123',
  }), true);
  assert.equal(detectEconomicAction('Bash', {
    command: 'stripe charges create --amount 5000',
  }), true);
  assert.equal(detectEconomicAction('Bash', {
    command: 'stripe subscriptions cancel sub_123',
  }), true);
  assert.equal(detectEconomicAction('Bash', {
    command: 'git checkout main',
  }), false);
  assert.equal(detectEconomicAction('Bash', {
    command: "rg 'cancel subscription' src",
  }), false);
  assert.equal(detectEconomicAction('Bash', {
    command: "git commit -m 'create subscription UI'",
  }), false);
  assert.equal(detectEconomicAction('Bash', {
    command: "rg 'cancel subscription' src && stripe subscriptions create --customer cus_123",
  }), true);
  assert.equal(detectEconomicAction('Bash', {
    command: "bash -lc 'stripe subscriptions create --customer cus_123'",
  }), true);
  assert.equal(detectEconomicAction('mcp__thumbgate__create_purchase_requisition', {
    purpose: 'Approve a subscription before execution',
  }), false);
  assert.equal(detectEconomicAction('mcp__billing__create_subscription', {
    customer: 'cus_123',
  }), true);
});

test('concurrent callers cannot create two requisitions for one idempotency key', async () => {
  const { feedbackDir, requester, request } = fixture();
  const modulePath = path.join(__dirname, '..', 'scripts', 'financial-control-plane.js');
  const childSource = `
    const { createPurchaseRequisition } = require(${JSON.stringify(modulePath)});
    try {
      const result = createPurchaseRequisition(${JSON.stringify(request)}, {
        feedbackDir: ${JSON.stringify(feedbackDir)},
        authenticatedPrincipal: ${JSON.stringify(requester)},
      });
      process.stdout.write(result.recorded ? 'recorded' : 'duplicate');
    } catch (error) {
      if (/financial ledger is busy/.test(error.message)) process.stdout.write('busy');
      else { process.stderr.write(error.stack || error.message); process.exitCode = 1; }
    }
  `;
  try {
    const runs = Array.from({ length: 8 }, () => new Promise((resolve) => {
      const child = spawn(process.execPath, ['-e', childSource], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    }));
    const results = await Promise.all(runs);
    for (const result of results) assert.equal(result.code, 0, result.stderr);
    assert.equal(results.filter((result) => result.stdout === 'recorded').length, 1);

    const events = fs.readFileSync(getLedgerPath({ feedbackDir }), 'utf8')
      .trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(events.filter((event) => event.eventType === 'requested').length, 1);
    assert.equal(reconcilePurchaseLedger({ feedbackDir }).requisitionCount, 1);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('caller cannot select or impersonate the authenticated requester', () => {
  const { feedbackDir, requester, request } = fixture();
  try {
    assert.throws(() => createPurchaseRequisition({
      ...request,
      requester: { id: 'victim-agent', kind: 'agent' },
    }, authOptions(feedbackDir, requester)), /must not be supplied by the caller/);

    const created = createPurchaseRequisition(request, authOptions(feedbackDir, requester));
    decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'approved',
      reason: 'Approved for identity binding test.',
    }, reviewerOptions(feedbackDir));

    assert.throws(() => reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
    }, authOptions(feedbackDir, { id: 'other-agent', kind: 'agent' })), /does not own/);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('financial reservation rejects a validly chained but unauthenticated approval row', () => {
  const { feedbackDir, requester, request } = fixture();
  try {
    const created = createPurchaseRequisition(request, authOptions(feedbackDir, requester));
    // The generic queue may record a human decision without a financial
    // signing key, but that row must never authorize a purchase.
    decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'approved',
      reason: 'Unsigned local row must not authorize funds.',
    }, {
      feedbackDir,
      authenticatedActor: { id: 'fabricated-reviewer', kind: 'human' },
    });

    assert.throws(() => reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
    }, authOptions(feedbackDir, requester)), /approval receipt is missing or unauthenticated/);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('the first v2 decision seals a valid legacy escalation prefix without losing it', () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-legacy-escalation-'));
  try {
    const requested = requestEscalation({
      taskId: 'legacy-escalation-task',
      reason: 'Existing operator decision still needs review',
      severity: 'high',
      requester: { id: 'legacy-agent', kind: 'agent' },
      evidence: ['legacy audit evidence'],
      idempotencyKey: 'legacy-escalation-key',
    }, { feedbackDir }).escalation;
    const legacy = { ...requested };
    delete legacy.schemaVersion;
    delete legacy.sequence;
    delete legacy.previousEventHash;
    legacy.eventHash = hashEscalationEvent(legacy);
    fs.writeFileSync(getEscalationsPath({ feedbackDir }), `${JSON.stringify(legacy)}\n`, 'utf8');
    fs.unlinkSync(getEscalationsHeadPath({ feedbackDir }));

    decideEscalation({
      escalationId: legacy.escalationId,
      decision: 'approved',
      reason: 'Authenticated reviewer sealed the legacy prefix.',
    }, reviewerOptions(feedbackDir));

    const events = fs.readFileSync(getEscalationsPath({ feedbackDir }), 'utf8')
      .trim().split('\n').map(JSON.parse);
    const head = JSON.parse(fs.readFileSync(getEscalationsHeadPath({ feedbackDir }), 'utf8'));
    assert.equal(events.length, 2);
    assert.equal(events[0].schemaVersion, undefined);
    assert.equal(events[1].schemaVersion, 'human-escalation-v2');
    assert.equal(events[1].sequence, 2);
    assert.equal(events[1].previousEventHash, events[0].eventHash);
    assert.equal(validateEscalationLedger(events, [], head).ok, true);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('hard-floor preview preserves a reservation until the final allow boundary', () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-final-authorization-'));
  const previousFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const previousReviewerKey = process.env.THUMBGATE_HUMAN_REVIEWER_KEY;
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  process.env.THUMBGATE_HUMAN_REVIEWER_KEY = APPROVAL_KEY;
  const requester = getRuntimePrincipal();
  try {
    const created = createPurchaseRequisition({
      taskId: 'upgrade-task-final-boundary',
      vendor: 'Apollo',
      amountUsd: 588,
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
      evidence: ['Quoted annual price: $588'],
      idempotencyKey: 'final-boundary-request',
    }, authOptions(feedbackDir, requester));
    decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'approved',
      reason: 'Approved only for the exact final-boundary test action.',
    }, reviewerOptions(feedbackDir));
    const reserved = reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
    }, authOptions(feedbackDir, requester));
    const input = {
      tool_name: 'Browser',
      tool_input: {
        command: 'Click Subscribe and confirm checkout',
        costUsd: 588,
        budget: {
          maxCostUsdPerAction: 588,
          remainingCostUsd: 588,
        },
        financialControl: {
          requisitionId: reserved.requisition.requisitionId,
          reservationId: reserved.requisition.reservationId,
          actionId: 'final-boundary-action',
          vendor: 'Apollo',
          purpose: 'Annual data plan',
          sourceMessageId: 'user-message-42',
        },
      },
    };

    assert.equal(runHardFloor(input), null);
    assert.equal(projectRequisition(created.requisition.requisitionId, { feedbackDir }).status, 'reserved');
    assert.equal(finalizeFinancialAuthorization(input), null);
    assert.equal(projectRequisition(created.requisition.requisitionId, { feedbackDir }).status, 'authorized');
    assert.equal(finalizeFinancialAuthorization(input).decision, 'deny');
  } finally {
    if (previousFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = previousFeedbackDir;
    if (previousReviewerKey === undefined) delete process.env.THUMBGATE_HUMAN_REVIEWER_KEY;
    else process.env.THUMBGATE_HUMAN_REVIEWER_KEY = previousReviewerKey;
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('reconciliation detects tampering without rewriting the ledger', () => {
  const { feedbackDir, request } = fixture();
  try {
    createPurchaseRequisition(request, authOptions(feedbackDir, { id: 'agent-operator', kind: 'agent' }));
    const ledgerPath = getLedgerPath({ feedbackDir });
    const rows = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n');
    const event = JSON.parse(rows[0]);
    event.amountUsd = 1;
    fs.writeFileSync(ledgerPath, `${JSON.stringify(event)}\n`, 'utf8');

    const reconciliation = reconcilePurchaseLedger({ feedbackDir });
    assert.equal(reconciliation.ok, false);
    assert.equal(reconciliation.invalidEventHashes.length, 1);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('reconciliation detects ledger row deletion and reordering through hash chaining', () => {
  const { feedbackDir, requester, request } = fixture();
  try {
    const created = createPurchaseRequisition(request, authOptions(feedbackDir, requester));
    decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'approved',
      reason: 'Approved for chain test.',
    }, reviewerOptions(feedbackDir));
    reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
    }, authOptions(feedbackDir, requester));

    const ledgerPath = getLedgerPath({ feedbackDir });
    const rows = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n');
    fs.writeFileSync(ledgerPath, `${rows[1]}\n`, 'utf8');

    const reconciliation = reconcilePurchaseLedger({ feedbackDir });
    assert.equal(reconciliation.ok, false);
    assert.equal(reconciliation.invalidChainLinks.length, 1);
    assert.equal(reconciliation.ledgerHeadMismatches.length, 0);
    assert.throws(() => reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
    }, authOptions(feedbackDir, requester)), /integrity verification failed/);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('reconciliation detects deletion of the final ledger event through the head checkpoint', () => {
  const { feedbackDir, requester, request } = fixture();
  try {
    const created = createPurchaseRequisition(request, authOptions(feedbackDir, requester));
    decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'approved',
      reason: 'Approved for tail truncation test.',
    }, reviewerOptions(feedbackDir));
    reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
    }, authOptions(feedbackDir, requester));

    const ledgerPath = getLedgerPath({ feedbackDir });
    const rows = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n');
    fs.writeFileSync(ledgerPath, `${rows[0]}\n`, 'utf8');

    const head = JSON.parse(fs.readFileSync(getLedgerHeadPath({ feedbackDir }), 'utf8'));
    assert.equal(head.sequence, 2);
    const reconciliation = reconcilePurchaseLedger({ feedbackDir });
    assert.equal(reconciliation.ok, false);
    assert.equal(reconciliation.invalidChainLinks.length, 0);
    assert.equal(reconciliation.ledgerHeadMismatches.length, 1);
    assert.throws(() => createPurchaseRequisition({
      ...request,
      idempotencyKey: 'second-request-after-truncation',
    }, authOptions(feedbackDir, requester)), /integrity verification failed/);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});
