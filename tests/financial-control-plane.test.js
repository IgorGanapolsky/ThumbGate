'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createPurchaseRequisition,
  detectEconomicAction,
  evaluateFinancialControl,
  getLedgerPath,
  reconcilePurchaseLedger,
  reservePurchaseRequisition,
  settlePurchaseRequisition,
} = require('../scripts/financial-control-plane');
const { decideEscalation } = require('../scripts/human-escalation');

function fixture() {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-financial-control-'));
  const requester = { id: 'agent-operator', kind: 'agent' };
  const request = {
    taskId: 'upgrade-task-1',
    requester,
    vendor: 'Apollo',
    amountUsd: 588,
    purpose: 'Annual data plan',
    sourceMessageId: 'user-message-42',
    evidence: ['Quoted annual price: $588'],
    idempotencyKey: 'apollo-annual-2026',
  };
  return { feedbackDir, requester, request };
}

test('purchase lifecycle requires independent approval, exact scope, reservation, and receipt', () => {
  const { feedbackDir, requester, request } = fixture();
  try {
    const created = createPurchaseRequisition(request, { feedbackDir });
    assert.equal(created.recorded, true);
    assert.equal(created.requisition.status, 'pending_approval');

    const duplicate = createPurchaseRequisition(request, { feedbackDir });
    assert.equal(duplicate.recorded, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.requisition.requisitionId, created.requisition.requisitionId);

    assert.throws(() => reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      requester,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
    }, { feedbackDir }), /does not have independent human approval/);

    decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'approved',
      reason: 'Verified exact vendor, purpose, and amount.',
    }, {
      feedbackDir,
      authenticatedActor: { id: 'finance-reviewer', kind: 'human' },
    });

    assert.throws(() => reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      requester,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'different-message',
    }, { feedbackDir }), /sourceMessageId does not match/);

    const reserved = reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      requester,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
      idempotencyKey: 'apollo-annual-reservation',
    }, { feedbackDir });
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
    }, { feedbackDir });
    assert.equal(control.mode, 'allow');
    assert.equal(control.authorization.reservationId, reserved.requisition.reservationId);

    const settled = settlePurchaseRequisition({
      requisitionId: reserved.requisition.requisitionId,
      reservationId: reserved.requisition.reservationId,
      requester,
      status: 'committed',
      actualAmountUsd: 588,
      evidence: ['provider-receipt:receipt_123'],
    }, { feedbackDir });
    assert.equal(settled.requisition.status, 'committed');

    const reconciliation = reconcilePurchaseLedger({ feedbackDir });
    assert.equal(reconciliation.ok, true);
    assert.deepEqual(reconciliation.totals, {
      approvedUsd: 588,
      reservedUsd: 0,
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
});

test('reconciliation detects tampering without rewriting the ledger', () => {
  const { feedbackDir, request } = fixture();
  try {
    createPurchaseRequisition(request, { feedbackDir });
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
