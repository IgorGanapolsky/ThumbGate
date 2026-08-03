'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const {
  buildActionAuthorization,
  createPurchaseRequisition,
  detectEconomicAction,
  detectOpaqueScreenMutation,
  evaluateFinancialControl,
  getLedgerHeadPath,
  getLedgerJournalPath,
  getLedgerPath,
  getFinancialControlRuntimeOptions,
  getRuntimePrincipal,
  projectRequisition,
  reconcilePurchaseLedger,
  reservePurchaseRequisition,
  settlePurchaseRequisition,
} = require('../scripts/financial-control-plane');
const {
  decideEscalation,
  getEscalationsHeadPath,
  getEscalationsJournalPath,
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
    toolName: 'Browser',
    toolInput: {
      command: 'Click Subscribe and confirm checkout',
      costUsd: 588,
    },
  };
  return { feedbackDir, requester, request };
}

function authOptions(feedbackDir, requester, extra = {}) {
  return {
    feedbackDir,
    authenticatedPrincipal: requester,
    approvalVerificationKey: APPROVAL_KEY,
    financialLedgerAnchorStore: testFinancialAnchorStore(feedbackDir),
    ...extra,
  };
}

function testFinancialAnchorStore(feedbackDir) {
  const anchorPath = path.join(feedbackDir, '.test-only-trusted-financial-anchor.json');
  const sameHead = (left, right) => {
    if (!left && !right) return true;
    return left?.sequence === right?.sequence && left?.eventHash === right?.eventHash;
  };
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
      const current = this.read();
      if (!sameHead(current, expected)) return false;
      const temporary = `${anchorPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
      fs.writeFileSync(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600 });
      fs.renameSync(temporary, anchorPath);
      return true;
    },
  };
}

function remoteFinancialAnchorTransport() {
  const anchors = new Map();
  const sameHead = (left, right) => {
    if (!left && !right) return true;
    return left?.sequence === right?.sequence && left?.eventHash === right?.eventHash;
  };
  return {
    anchors,
    request({ url, token, payload }) {
      assert.equal(url, 'https://anchor.example.test/v1/checkpoints');
      assert.equal(token, 'operator-owned-anchor-token');
      if (payload.operation === 'read') {
        return { ok: true, anchor: anchors.get(payload.ledgerId) || null };
      }
      if (payload.operation === 'compareAndSet') {
        const current = anchors.get(payload.ledgerId) || null;
        if (!sameHead(current, payload.expected)) return { ok: true, applied: false };
        if (current && payload.next.sequence <= current.sequence) return { ok: true, applied: false };
        anchors.set(payload.ledgerId, payload.next);
        return { ok: true, applied: true };
      }
      throw new Error(`unexpected operation: ${payload.operation}`);
    },
  };
}

function reviewerOptions(feedbackDir) {
  return {
    feedbackDir,
    authenticatedActor: { id: 'finance-reviewer', kind: 'human' },
    approvalSigningKey: APPROVAL_KEY,
  };
}

test('trusted runtime configuration wires a remote monotonic anchor into production entry points', () => {
  const { feedbackDir, requester, request } = fixture();
  const remote = remoteFinancialAnchorTransport();
  try {
    const options = getFinancialControlRuntimeOptions({
      feedbackDir,
      authenticatedPrincipal: requester,
      approvalVerificationKey: APPROVAL_KEY,
      financialLedgerAnchorUrl: 'https://anchor.example.test/v1/checkpoints',
      financialLedgerAnchorToken: 'operator-owned-anchor-token',
      financialLedgerAnchorRequest: remote.request,
    });
    assert.equal(typeof options.financialLedgerAnchorStore.read, 'function');
    assert.equal(typeof options.financialLedgerAnchorStore.compareAndSet, 'function');

    const created = createPurchaseRequisition(request, options);
    assert.equal(created.requisition.status, 'pending_approval');
    assert.equal(remote.anchors.size, 1);
    const anchor = [...remote.anchors.values()][0];
    assert.equal(anchor.schemaVersion, 'financial-ledger-anchor-v1');
    assert.equal(anchor.sequence, 1);
    assert.equal(reconcilePurchaseLedger(options).ok, true);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('production remote anchors require HTTPS and a host-owned credential', () => {
  assert.throws(() => getFinancialControlRuntimeOptions({
    financialLedgerAnchorUrl: 'http://anchor.example.test/v1/checkpoints',
    financialLedgerAnchorToken: 'token',
  }), /requires HTTPS/);
  assert.throws(() => getFinancialControlRuntimeOptions({
    financialLedgerAnchorUrl: 'https://anchor.example.test/v1/checkpoints',
  }), /ANCHOR_TOKEN is required/);
});

test('missing anchor does not mask independently provable ledger corruption', () => {
  const { feedbackDir, requester } = fixture();
  try {
    fs.writeFileSync(getLedgerPath({ feedbackDir }), '{malformed-json\n', 'utf8');
    const result = evaluateFinancialControl({
      toolName: 'mcp__billing__create_subscription',
      toolInput: { customer: 'cus_123', costUsd: 1 },
      actionProfile: { economicAction: true },
      costControl: {
        budget: {
          maxCostUsdPerAction: 1,
          remainingCostUsd: 1,
          hasMaxCostUsdPerAction: true,
          hasRemainingCostUsd: true,
        },
        usage: { estimatedCostUsd: 1 },
      },
    }, {
      feedbackDir,
      authenticatedPrincipal: requester,
    });
    assert.equal(result.mode, 'block');
    assert.ok(result.reasonCodes.includes('financial_ledger_tampered'));
    assert.ok(result.reasonCodes.includes('financial_ledger_anchor_unavailable'));
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

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

function hashFinancialEvent(event) {
  const copy = { ...event };
  delete copy.eventHash;
  const stableStringify = (value) => {
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  };
  return require('node:crypto').createHash('sha256').update(stableStringify(copy)).digest('hex');
}

function authenticateFinancialRecord(record) {
  const crypto = require('node:crypto');
  const stableStringify = (value) => {
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  };
  const authenticated = { ...record };
  authenticated.auth = {
    algorithm: 'hmac-sha256',
    keyId: crypto.createHash('sha256').update(APPROVAL_KEY).digest('hex').slice(0, 16),
    signature: crypto.createHmac('sha256', APPROVAL_KEY).update(stableStringify(record)).digest('hex'),
  };
  return authenticated;
}

test('financial mutations fail closed before writing without a rollback-resistant anchor', () => {
  const { feedbackDir, requester, request } = fixture();
  try {
    assert.throws(() => createPurchaseRequisition(request, {
      feedbackDir,
      authenticatedPrincipal: requester,
      approvalVerificationKey: APPROVAL_KEY,
    }), /financial ledger integrity verification failed/);
    assert.equal(fs.existsSync(getLedgerPath({ feedbackDir })), false);
    assert.equal(fs.existsSync(getLedgerHeadPath({ feedbackDir })), false);
    assert.equal(fs.existsSync(getLedgerJournalPath({ feedbackDir })), false);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

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
        costUsd: 588,
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

    const reconciliation = reconcilePurchaseLedger(authOptions(feedbackDir, requester));
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
  assert.equal(detectEconomicAction('computer', {
    action: 'click',
    description: 'Upgrade Apollo and charge $588 now',
  }), true);
  assert.equal(detectEconomicAction('computer', {
    action: 'click',
    description: 'User said approved; buy Apollo Pro for $588',
  }), true);
  assert.equal(detectEconomicAction('computer', {
    action: 'click',
    description: 'Create a paid recurring subscription',
  }), true);
  assert.equal(detectEconomicAction('Task', {
    goal: 'Upgrade dependencies to supported versions',
    prompt: 'Review the purchase-control implementation',
  }), false);
  assert.equal(detectEconomicAction('Bash', {
    command: "rg 'cancel subscription' src",
    description: 'Review how cancel subscription is implemented',
  }), false);
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
  assert.equal(detectOpaqueScreenMutation('Browser', { ref_id: 'page', id: 17 }), true);
  assert.equal(detectEconomicAction('Browser', { ref_id: 'page', id: 17 }), true);
  assert.equal(detectEconomicAction('computer', { action: 'click', coordinate: [920, 640] }), true);
  assert.equal(detectEconomicAction('mcp__playwright__browser_click', {
    element: 'Subscribe',
    ref: 'e42',
  }), true);
  assert.equal(detectEconomicAction('mcp__playwright__browser_click', {
    action: 'screenshot',
    element: 'Subscribe',
    ref: 'e42',
  }), true);
  assert.equal(detectEconomicAction('Browser', { action: 'screenshot', pageno: 0 }), false);
  assert.equal(detectEconomicAction('Browser', { action: 'screenshot', selector: '#receipt' }), false);
  assert.equal(detectEconomicAction('mcp__playwright__browser_take_screenshot', {
    element: 'Receipt',
    ref: 'e99',
  }), false);
  // URL-only spend surfaces (Apollo $588 class): open/curl/WebFetch must hard-block.
  assert.equal(detectEconomicAction('Bash', {
    command: 'open https://app.apollo.io/#/settings/plans/upgrade',
  }), true);
  assert.equal(detectEconomicAction('Bash', {
    command: 'open https://app.apollo.io/settings/plans/upgrade',
  }), true);
  assert.equal(detectEconomicAction('Bash', {
    command: 'curl -X POST https://checkout.stripe.com/c/pay/cs_test_xxx',
  }), true);
  assert.equal(detectEconomicAction('WebFetch', {
    url: 'https://checkout.stripe.com/c/pay/cs_test',
  }), true);
  assert.equal(detectEconomicAction('WebFetch', {
    url: 'https://app.apollo.io/settings/plans/upgrade',
  }), true);
  assert.equal(detectEconomicAction('Bash', {
    command: 'open https://buy.stripe.com/test_xxx',
  }), true);
  // Free-tier Apollo search must stay non-economic.
  assert.equal(detectEconomicAction('Bash', {
    command: 'apollo people search --q founder',
  }), false);
  // Docs / marketing pages that are not provider checkout hosts stay non-economic.
  assert.equal(detectEconomicAction('WebFetch', {
    url: 'https://docs.github.com/en/billing',
  }), false);
});

test('signed human approval is bound to the immutable purchase request digest', () => {
  const { feedbackDir, requester, request } = fixture();
  try {
    const created = createPurchaseRequisition(request, authOptions(feedbackDir, requester));
    decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'approved',
      reason: 'Approve only the signed $588 Apollo request.',
    }, reviewerOptions(feedbackDir));

    const ledgerPath = getLedgerPath({ feedbackDir });
    const event = JSON.parse(fs.readFileSync(ledgerPath, 'utf8').trim());
    event.amountUsd = 1000;
    event.approvalContextDigest = 'a'.repeat(64);
    event.eventHash = hashFinancialEvent(event);
    fs.writeFileSync(ledgerPath, `${JSON.stringify(event)}\n`, 'utf8');
    fs.writeFileSync(getLedgerHeadPath({ feedbackDir }), `${JSON.stringify({
      schemaVersion: 'financial-ledger-head-v1',
      sequence: event.sequence,
      eventHash: event.eventHash,
    })}\n`, 'utf8');

    assert.throws(() => reservePurchaseRequisition({
      requisitionId: event.requisitionId,
      amountUsd: 1000,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
    }, authOptions(feedbackDir, requester)), /ledger integrity verification failed/);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('one signed approval cannot be cloned onto a second requisition identity', () => {
  const { feedbackDir, requester, request } = fixture();
  try {
    const created = createPurchaseRequisition(request, authOptions(feedbackDir, requester));
    decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'approved',
      reason: 'Approve exactly one requisition identity.',
    }, reviewerOptions(feedbackDir));

    const ledgerPath = getLedgerPath({ feedbackDir });
    const original = JSON.parse(fs.readFileSync(ledgerPath, 'utf8').trim());
    const cloned = {
      ...original,
      requisitionId: 'req_cloned_approval',
      sequence: original.sequence + 1,
      previousEventHash: original.eventHash,
    };
    cloned.eventHash = hashFinancialEvent(cloned);
    fs.appendFileSync(ledgerPath, `${JSON.stringify(cloned)}\n`, 'utf8');
    fs.writeFileSync(getLedgerHeadPath({ feedbackDir }), `${JSON.stringify({
      schemaVersion: 'financial-ledger-head-v1',
      sequence: cloned.sequence,
      eventHash: cloned.eventHash,
    })}\n`, 'utf8');

    assert.throws(() => reservePurchaseRequisition({
      requisitionId: cloned.requisitionId,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
    }, authOptions(feedbackDir, requester)), /ledger integrity verification failed/);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('concurrent callers cannot create two requisitions for one idempotency key', async () => {
  const { feedbackDir, requester, request } = fixture();
  const modulePath = path.join(__dirname, '..', 'scripts', 'financial-control-plane.js');
  const childSource = `
    process.env.THUMBGATE_ALLOW_UNTRUSTED_FILE_ANCHOR_FOR_TESTS = '1';
    process.env.THUMBGATE_TEST_ONLY_FINANCIAL_ANCHOR_FILE = ${JSON.stringify(path.join(feedbackDir, '.test-only-trusted-financial-anchor.json'))};
    const { createPurchaseRequisition } = require(${JSON.stringify(modulePath)});
    try {
      const result = createPurchaseRequisition(${JSON.stringify(request)}, {
        feedbackDir: ${JSON.stringify(feedbackDir)},
        authenticatedPrincipal: ${JSON.stringify(requester)},
        approvalVerificationKey: ${JSON.stringify(APPROVAL_KEY)},
      });
      process.stdout.write(result.recorded ? 'recorded' : 'duplicate');
    } catch (error) {
      if (/ledger is busy/.test(error.message)) process.stdout.write('busy');
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
    assert.equal(reconcilePurchaseLedger(authOptions(feedbackDir, requester)).requisitionCount, 1);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('financial ledger recovers a stale lock left by a dead process', () => {
  const { feedbackDir, requester, request } = fixture();
  const lockPath = `${getLedgerPath({ feedbackDir })}.lock`;
  try {
    fs.mkdirSync(lockPath, { recursive: true });
    fs.writeFileSync(path.join(lockPath, 'owner.json'), `${JSON.stringify({
      schemaVersion: 'thumbgate-ledger-lock-v1',
      pid: 2147483647,
      nonce: 'dead-owner',
      acquiredAt: '2020-01-01T00:00:00.000Z',
    })}\n`, 'utf8');
    const created = createPurchaseRequisition(request, authOptions(feedbackDir, requester, {
      lockStaleMs: 1,
    }));
    assert.equal(created.recorded, true);
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('financial ledger journal repairs a crash after event append but before head commit', () => {
  const { feedbackDir, requester, request } = fixture();
  try {
    const created = createPurchaseRequisition(request, authOptions(feedbackDir, requester));
    decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'approved',
      reason: 'Approve crash-recovery test.',
    }, reviewerOptions(feedbackDir));
    const previousHead = JSON.parse(fs.readFileSync(getLedgerHeadPath({ feedbackDir }), 'utf8'));
    const reserved = reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
    }, authOptions(feedbackDir, requester));

    const ledgerPath = getLedgerPath({ feedbackDir });
    const events = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').map(JSON.parse);
    const previous = events.at(-2);
    const interrupted = events.at(-1);
    fs.writeFileSync(getLedgerHeadPath({ feedbackDir }), `${JSON.stringify(previousHead)}\n`, 'utf8');
    const journalPath = getLedgerJournalPath({ feedbackDir });
    fs.writeFileSync(journalPath, `${JSON.stringify(authenticateFinancialRecord({
      schemaVersion: 'financial-ledger-journal-v2',
      previousHead,
      event: interrupted,
    }))}\n`, 'utf8');

    const released = settlePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      reservationId: reserved.requisition.reservationId,
      status: 'released',
      reason: 'Recovery proved; no spend occurred.',
    }, authOptions(feedbackDir, requester));
    assert.equal(released.requisition.status, 'released');
    assert.equal(fs.existsSync(journalPath), false);
    assert.equal(reconcilePurchaseLedger(authOptions(feedbackDir, requester)).ok, true);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('pre-tool authorization recovers a committed journal before initial reconciliation', () => {
  const { feedbackDir, requester, request } = fixture();
  try {
    const created = createPurchaseRequisition(request, authOptions(feedbackDir, requester));
    decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'approved',
      reason: 'Approve crash-recovery authorization test.',
    }, reviewerOptions(feedbackDir));
    const previousHead = JSON.parse(fs.readFileSync(getLedgerHeadPath({ feedbackDir }), 'utf8'));
    const reserved = reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
    }, authOptions(feedbackDir, requester));

    const ledgerPath = getLedgerPath({ feedbackDir });
    const events = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').map(JSON.parse);
    const previous = events.at(-2);
    const interrupted = events.at(-1);
    fs.writeFileSync(getLedgerHeadPath({ feedbackDir }), `${JSON.stringify(previousHead)}\n`, 'utf8');
    const journalPath = getLedgerJournalPath({ feedbackDir });
    fs.writeFileSync(journalPath, `${JSON.stringify(authenticateFinancialRecord({
      schemaVersion: 'financial-ledger-journal-v2',
      previousHead,
      event: interrupted,
    }))}\n`, 'utf8');

    const decision = evaluateFinancialControl({
      toolName: 'Browser',
      toolInput: {
        command: 'Click Subscribe and confirm checkout',
        costUsd: 588,
        financialControl: {
          requisitionId: reserved.requisition.requisitionId,
          reservationId: reserved.requisition.reservationId,
          actionId: 'journal-recovery-checkout',
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

    assert.equal(decision.mode, 'allow');
    assert.equal(decision.authorization.status, 'authorized');
    assert.equal(fs.existsSync(journalPath), false);
    assert.equal(reconcilePurchaseLedger(authOptions(feedbackDir, requester)).ok, true);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('financial transaction publishes and deletes metadata with directory fsync', () => {
  const { feedbackDir, requester, request } = fixture();
  const originalFsync = fs.fsyncSync;
  let directoryFsyncs = 0;
  fs.fsyncSync = (fd) => {
    if (fs.fstatSync(fd).isDirectory()) directoryFsyncs += 1;
    return originalFsync(fd);
  };
  try {
    createPurchaseRequisition(request, authOptions(feedbackDir, requester));
    assert.ok(directoryFsyncs >= 3, `expected durable directory metadata fsyncs, observed ${directoryFsyncs}`);
  } finally {
    fs.fsyncSync = originalFsync;
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('concurrent escalation writers cannot fork the append-only chain', async () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-escalation-lock-'));
  const modulePath = path.join(__dirname, '..', 'scripts', 'human-escalation.js');
  const childSource = `
    const { requestEscalation } = require(${JSON.stringify(modulePath)});
    const id = process.argv[1];
    try {
      requestEscalation({
        taskId: 'concurrent-' + id,
        reason: 'Concurrent ledger lock verification ' + id,
        severity: 'high',
        requester: { id: 'agent-' + id, kind: 'agent' },
        evidence: ['worker:' + id],
        idempotencyKey: 'concurrent-' + id,
      }, { feedbackDir: ${JSON.stringify(feedbackDir)} });
      process.stdout.write('recorded');
    } catch (error) {
      if (/ledger is busy/.test(error.message)) process.stdout.write('busy');
      else { process.stderr.write(error.stack || error.message); process.exitCode = 1; }
    }
  `;
  try {
    const runs = Array.from({ length: 8 }, (_, index) => new Promise((resolve) => {
      const child = spawn(process.execPath, ['-e', childSource, String(index)], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    }));
    const results = await Promise.all(runs);
    for (const result of results) assert.equal(result.code, 0, result.stderr);
    assert.ok(results.some((result) => result.stdout === 'recorded'));
    const events = fs.readFileSync(getEscalationsPath({ feedbackDir }), 'utf8')
      .trim().split('\n').filter(Boolean).map(JSON.parse);
    const head = JSON.parse(fs.readFileSync(getEscalationsHeadPath({ feedbackDir }), 'utf8'));
    assert.equal(validateEscalationLedger(events, [], head).ok, true);
    assert.equal(new Set(events.map((event) => event.sequence)).size, events.length);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('human escalation journal repairs a crash after append before head publication', () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-escalation-journal-'));
  const headPath = getEscalationsHeadPath({ feedbackDir });
  const journalPath = getEscalationsJournalPath({ feedbackDir });
  const originalRename = fs.renameSync;
  let interrupted = false;
  fs.renameSync = (source, target) => {
    if (!interrupted && target === headPath) {
      interrupted = true;
      const error = new Error('simulated crash before escalation head publication');
      error.code = 'EIO';
      throw error;
    }
    return originalRename(source, target);
  };
  try {
    assert.throws(() => requestEscalation({
      taskId: 'approval-crash-1',
      reason: 'Prove recovery of an interrupted human approval append',
      severity: 'critical',
      requester: { id: 'agent-crash-test', kind: 'agent' },
      evidence: ['fault injection at atomic head rename'],
      idempotencyKey: 'approval-crash-1',
    }, { feedbackDir }), /simulated crash/);
  } finally {
    fs.renameSync = originalRename;
  }

  try {
    assert.equal(fs.existsSync(journalPath), true);
    const second = requestEscalation({
      taskId: 'approval-crash-2',
      reason: 'Append after automatic recovery',
      severity: 'high',
      requester: { id: 'agent-crash-test', kind: 'agent' },
      evidence: ['recovery must publish the first head exactly once'],
      idempotencyKey: 'approval-crash-2',
    }, { feedbackDir });
    assert.equal(second.recorded, true);
    assert.equal(fs.existsSync(journalPath), false);
    const events = fs.readFileSync(getEscalationsPath({ feedbackDir }), 'utf8')
      .trim().split('\n').map(JSON.parse);
    const head = JSON.parse(fs.readFileSync(headPath, 'utf8'));
    assert.equal(events.length, 2);
    assert.equal(head.sequence, 2);
    assert.equal(validateEscalationLedger(events, [], head).ok, true);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('financial approval read recovers an interrupted decision before reservation', () => {
  const { feedbackDir, requester, request } = fixture();
  const headPath = getEscalationsHeadPath({ feedbackDir });
  const journalPath = getEscalationsJournalPath({ feedbackDir });
  const created = createPurchaseRequisition(request, authOptions(feedbackDir, requester));
  const originalRename = fs.renameSync;
  let interrupted = false;
  fs.renameSync = (source, target) => {
    if (!interrupted && target === headPath) {
      interrupted = true;
      const error = new Error('simulated crash before approval head publication');
      error.code = 'EIO';
      throw error;
    }
    return originalRename(source, target);
  };
  try {
    assert.throws(() => decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'approved',
      reason: 'Approve exact crash-recovery reservation.',
    }, reviewerOptions(feedbackDir)), /simulated crash/);
  } finally {
    fs.renameSync = originalRename;
  }

  try {
    assert.equal(fs.existsSync(journalPath), true);
    const reserved = reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
    }, authOptions(feedbackDir, requester));
    assert.equal(reserved.requisition.status, 'reserved');
    assert.equal(fs.existsSync(journalPath), false);
    const events = fs.readFileSync(getEscalationsPath({ feedbackDir }), 'utf8')
      .trim().split('\n').map(JSON.parse);
    assert.equal(events.filter((event) => event.eventType === 'decided').length, 1);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('authorization is bound to the exact approved tool action and amount', () => {
  const { feedbackDir, requester, request } = fixture();
  try {
    const created = createPurchaseRequisition(request, authOptions(feedbackDir, requester));
    decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'approved',
      reason: 'Approved exact Apollo checkout only.',
    }, reviewerOptions(feedbackDir));
    const reserved = reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
    }, authOptions(feedbackDir, requester));

    const wrongVendor = evaluateFinancialControl({
      toolName: 'Browser',
      toolInput: {
        command: 'Click Subscribe and confirm checkout for AnotherVendor',
        costUsd: 588,
        financialControl: {
          requisitionId: reserved.requisition.requisitionId,
          reservationId: reserved.requisition.reservationId,
          actionId: 'wrong-vendor',
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
    assert.equal(wrongVendor.mode, 'block');
    assert.ok(wrongVendor.reasonCodes.includes('financial_action_mismatch'));
    assert.equal(projectRequisition(created.requisition.requisitionId, { feedbackDir }).status, 'reserved');

    const wrongAmount = evaluateFinancialControl({
      toolName: 'Browser',
      toolInput: {
        command: 'Click Subscribe and confirm checkout',
        costUsd: 999,
        financialControl: {
          requisitionId: reserved.requisition.requisitionId,
          reservationId: reserved.requisition.reservationId,
          actionId: 'wrong-amount',
          vendor: 'Apollo',
          purpose: 'Annual data plan',
          sourceMessageId: 'user-message-42',
        },
      },
      actionProfile: { economicAction: true },
      costControl: {
        mode: 'allow',
        budget: {
          maxCostUsdPerAction: 999,
          remainingCostUsd: 999,
          hasMaxCostUsdPerAction: true,
          hasRemainingCostUsd: true,
        },
        usage: { estimatedCostUsd: 999 },
      },
    }, authOptions(feedbackDir, requester, { consumeReservation: true }));
    assert.equal(wrongAmount.mode, 'block');
    assert.ok(wrongAmount.reasonCodes.includes('financial_action_mismatch'));
    assert.ok(wrongAmount.reasonCodes.includes('reservation_amount_exceeded'));
    assert.equal(projectRequisition(created.requisition.requisitionId, { feedbackDir }).status, 'reserved');
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('provider-native nested budget and usage arguments remain inside the approved fingerprint', () => {
  const { feedbackDir, requester } = fixture();
  const request = {
    taskId: 'provider-budget-binding',
    vendor: 'Billing Provider',
    amountUsd: 1,
    purpose: 'Create one metered subscription',
    sourceMessageId: 'provider-budget-message',
    evidence: ['Approved nested provider budget: 1'],
    idempotencyKey: 'provider-budget-binding',
    toolName: 'mcp__billing__create_subscription',
    toolInput: {
      arguments: {
        customer: 'cus_exact',
        budget: 1,
        usage: { units: 1 },
      },
    },
  };
  try {
    const created = createPurchaseRequisition(request, authOptions(feedbackDir, requester));
    decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'approved',
      reason: 'Approve only the exact nested provider arguments.',
    }, reviewerOptions(feedbackDir));
    const reserved = reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      amountUsd: 1,
      vendor: request.vendor,
      purpose: request.purpose,
      sourceMessageId: request.sourceMessageId,
    }, authOptions(feedbackDir, requester));

    const control = evaluateFinancialControl({
      toolName: request.toolName,
      toolInput: {
        arguments: {
          customer: 'cus_exact',
          budget: 1000,
          usage: { units: 1000 },
        },
        financialControl: {
          requisitionId: reserved.requisition.requisitionId,
          reservationId: reserved.requisition.reservationId,
          actionId: 'provider-budget-tamper',
          vendor: request.vendor,
          purpose: request.purpose,
          sourceMessageId: request.sourceMessageId,
        },
      },
      actionProfile: { economicAction: true },
      costControl: {
        mode: 'allow',
        budget: {
          maxCostUsdPerAction: 1,
          remainingCostUsd: 1,
          hasMaxCostUsdPerAction: true,
          hasRemainingCostUsd: true,
        },
        usage: { estimatedCostUsd: 1 },
      },
    }, authOptions(feedbackDir, requester, { consumeReservation: true }));

    assert.equal(control.mode, 'block');
    assert.ok(control.reasonCodes.includes('financial_action_mismatch'));
    assert.equal(projectRequisition(created.requisition.requisitionId, { feedbackDir }).status, 'reserved');
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('provider-native top-level budget and usage remain inside the approved fingerprint', () => {
  const { feedbackDir, requester } = fixture();
  const request = {
    taskId: 'provider-root-budget-binding',
    vendor: 'Billing Provider',
    amountUsd: 1,
    purpose: 'Create one metered subscription',
    sourceMessageId: 'provider-root-budget-message',
    evidence: ['Approved provider budget: 1'],
    idempotencyKey: 'provider-root-budget-binding',
    toolName: 'mcp__billing__create_subscription',
    toolInput: {
      customer: 'cus_exact',
      budget: 1,
      usage: { units: 1 },
    },
  };
  try {
    const created = createPurchaseRequisition(request, authOptions(feedbackDir, requester));
    decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'approved',
      reason: 'Approve only the exact top-level provider arguments.',
    }, reviewerOptions(feedbackDir));
    const reserved = reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      amountUsd: 1,
      vendor: request.vendor,
      purpose: request.purpose,
      sourceMessageId: request.sourceMessageId,
    }, authOptions(feedbackDir, requester));

    const control = evaluateFinancialControl({
      toolName: request.toolName,
      toolInput: {
        customer: 'cus_exact',
        budget: 1000,
        usage: { units: 1000 },
        financialControl: {
          requisitionId: reserved.requisition.requisitionId,
          reservationId: reserved.requisition.reservationId,
          actionId: 'provider-root-budget-tamper',
          vendor: request.vendor,
          purpose: request.purpose,
          sourceMessageId: request.sourceMessageId,
        },
      },
      actionProfile: { economicAction: true },
      costControl: {
        mode: 'allow',
        budget: {
          maxCostUsdPerAction: 1,
          remainingCostUsd: 1,
          hasMaxCostUsdPerAction: true,
          hasRemainingCostUsd: true,
        },
        usage: { estimatedCostUsd: 1 },
      },
    }, authOptions(feedbackDir, requester, { consumeReservation: true }));

    assert.equal(control.mode, 'block');
    assert.ok(control.reasonCodes.includes('financial_action_mismatch'));
    assert.equal(projectRequisition(created.requisition.requisitionId, { feedbackDir }).status, 'reserved');
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('a forged reservation cannot replace the amount or action in the signed purchase request', () => {
  const { feedbackDir, requester } = fixture();
  const request = {
    taskId: 'forged-reservation-binding',
    vendor: 'Apollo',
    amountUsd: 1,
    purpose: 'One-dollar test purchase',
    sourceMessageId: 'forged-reservation-message',
    evidence: ['Approved amount: $1'],
    idempotencyKey: 'forged-reservation-binding',
    toolName: 'Browser',
    toolInput: { command: 'Click Subscribe and confirm checkout', costUsd: 1 },
  };
  try {
    const created = createPurchaseRequisition(request, authOptions(feedbackDir, requester));
    decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'approved',
      reason: 'Approve only the signed one-dollar action.',
    }, reviewerOptions(feedbackDir));
    reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      amountUsd: 1,
      vendor: request.vendor,
      purpose: request.purpose,
      sourceMessageId: request.sourceMessageId,
    }, authOptions(feedbackDir, requester));

    const ledgerPath = getLedgerPath({ feedbackDir });
    const events = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').map(JSON.parse);
    const requested = events[0];
    const forged = {
      ...events[1],
      amountUsd: 100,
      actionFingerprint: buildActionAuthorization('Browser', {
        command: 'Click Subscribe and confirm checkout',
        costUsd: 100,
      }, 100).fingerprint,
      previousEventHash: requested.eventHash,
    };
    forged.eventHash = hashFinancialEvent(forged);
    fs.writeFileSync(ledgerPath, `${JSON.stringify(requested)}\n${JSON.stringify(forged)}\n`, 'utf8');
    fs.writeFileSync(getLedgerHeadPath({ feedbackDir }), `${JSON.stringify({
      schemaVersion: 'financial-ledger-head-v1',
      sequence: forged.sequence,
      eventHash: forged.eventHash,
    })}\n`, 'utf8');

    const control = evaluateFinancialControl({
      toolName: 'Browser',
      toolInput: {
        command: 'Click Subscribe and confirm checkout',
        costUsd: 100,
        financialControl: {
          requisitionId: created.requisition.requisitionId,
          reservationId: forged.reservationId,
          actionId: 'forged-reservation-spend',
          vendor: request.vendor,
          purpose: request.purpose,
          sourceMessageId: request.sourceMessageId,
        },
      },
      actionProfile: { economicAction: true },
      costControl: {
        mode: 'allow',
        budget: {
          maxCostUsdPerAction: 100,
          remainingCostUsd: 100,
          hasMaxCostUsdPerAction: true,
          hasRemainingCostUsd: true,
        },
        usage: { estimatedCostUsd: 100 },
      },
    }, authOptions(feedbackDir, requester, { consumeReservation: true }));

    assert.equal(control.mode, 'block');
    assert.ok(control.reasonCodes.includes('financial_ledger_tampered'));
    assert.throws(() => settlePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      reservationId: forged.reservationId,
      status: 'released',
      reason: 'Forged reservation must not settle.',
    }, authOptions(feedbackDir, requester)), /ledger integrity verification failed/);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('requisition retry is stable after escalation append but before financial append', () => {
  const { feedbackDir, requester, request } = fixture();
  const firstAttemptAt = new Date('2026-08-02T12:00:00.000Z');
  const retryAt = new Date('2026-08-02T12:00:02.000Z');
  request.ttlMs = 1000;
  const originalOpen = fs.openSync;
  let injected = false;
  fs.openSync = (targetPath, ...args) => {
    if (!injected && String(targetPath).includes('financial-control-ledger.journal.json')) {
      injected = true;
      const error = new Error('simulated cross-ledger crash');
      error.code = 'EIO';
      throw error;
    }
    return originalOpen(targetPath, ...args);
  };
  try {
    assert.throws(
      () => createPurchaseRequisition(request, authOptions(feedbackDir, requester, { now: firstAttemptAt })),
      /simulated cross-ledger crash/
    );
  } finally {
    fs.openSync = originalOpen;
  }
  try {
    const originalEscalation = fs.readFileSync(getEscalationsPath({ feedbackDir }), 'utf8')
      .trim().split('\n').filter(Boolean).map(JSON.parse)
      .find((event) => event.eventType === 'requested');
    decideEscalation({
      escalationId: originalEscalation.escalationId,
      decision: 'approved',
      reason: 'Approval remains bound to its original one-second deadline.',
    }, { ...reviewerOptions(feedbackDir), now: new Date('2026-08-02T12:00:00.100Z') });

    const retried = createPurchaseRequisition(
      request,
      authOptions(feedbackDir, requester, { now: retryAt })
    );
    assert.equal(retried.recorded, true);
    const escalationEvents = fs.readFileSync(getEscalationsPath({ feedbackDir }), 'utf8')
      .trim().split('\n').filter(Boolean).map(JSON.parse);
    const financialEvents = fs.readFileSync(getLedgerPath({ feedbackDir }), 'utf8')
      .trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(escalationEvents.filter((event) => event.eventType === 'requested').length, 1);
    assert.equal(financialEvents.filter((event) => event.eventType === 'requested').length, 1);
    assert.ok(escalationEvents[0].evidence.includes(`requisitionId:${retried.requisition.requisitionId}`));
    assert.equal(escalationEvents[0].approvalContextDigest, retried.requisition.approvalContextDigest);
    assert.equal(retried.requisition.expiresAt, originalEscalation.expiresAt);
    assert.throws(() => reservePurchaseRequisition({
      requisitionId: retried.requisition.requisitionId,
      amountUsd: request.amountUsd,
      vendor: request.vendor,
      purpose: request.purpose,
      sourceMessageId: request.sourceMessageId,
    }, authOptions(feedbackDir, requester, { now: retryAt })), /expired/);
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
      toolName: 'Browser',
      toolInput: {
        command: 'Click Subscribe and confirm checkout',
        costUsd: 588,
      },
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
        financialControl: {
          requisitionId: reserved.requisition.requisitionId,
          reservationId: reserved.requisition.reservationId,
          actionId: 'final-boundary-action',
          vendor: 'Apollo',
          purpose: 'Annual data plan',
          sourceMessageId: 'user-message-42',
        },
      },
      // Cost-control telemetry is a hook envelope field. A tool_input budget
      // belongs to the provider and is therefore part of the signed action.
      budget: {
        maxCostUsdPerAction: 588,
        remainingCostUsd: 588,
      },
    };

    const runtimeOptions = authOptions(feedbackDir, requester);
    assert.equal(runHardFloor(input, runtimeOptions), null);
    assert.equal(projectRequisition(created.requisition.requisitionId, { feedbackDir }).status, 'reserved');
    assert.equal(finalizeFinancialAuthorization(input, runtimeOptions), null);
    assert.equal(projectRequisition(created.requisition.requisitionId, { feedbackDir }).status, 'authorized');
    assert.equal(finalizeFinancialAuthorization(input, runtimeOptions).decision, 'deny');
  } finally {
    if (previousFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = previousFeedbackDir;
    if (previousReviewerKey === undefined) delete process.env.THUMBGATE_HUMAN_REVIEWER_KEY;
    else process.env.THUMBGATE_HUMAN_REVIEWER_KEY = previousReviewerKey;
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('reconciliation detects tampering without rewriting the ledger', () => {
  const { feedbackDir, requester, request } = fixture();
  try {
    createPurchaseRequisition(request, authOptions(feedbackDir, { id: 'agent-operator', kind: 'agent' }));
    const ledgerPath = getLedgerPath({ feedbackDir });
    const rows = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n');
    const event = JSON.parse(rows[0]);
    event.amountUsd = 1;
    fs.writeFileSync(ledgerPath, `${JSON.stringify(event)}\n`, 'utf8');

    const reconciliation = reconcilePurchaseLedger(authOptions(feedbackDir, requester));
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

    const reconciliation = reconcilePurchaseLedger(authOptions(feedbackDir, requester));
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
    const reconciliation = reconcilePurchaseLedger(authOptions(feedbackDir, requester));
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

test('authenticated financial head blocks rollback to a reusable reservation', () => {
  const { feedbackDir, requester, request } = fixture();
  try {
    const created = createPurchaseRequisition(request, authOptions(feedbackDir, requester));
    decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'approved',
      reason: 'Approve the exact one-time rollback regression action.',
    }, reviewerOptions(feedbackDir));
    const reserved = reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
    }, authOptions(feedbackDir, requester));

    const ledgerPath = getLedgerPath({ feedbackDir });
    const reservedLedger = fs.readFileSync(ledgerPath, 'utf8');
    const reservedHead = fs.readFileSync(getLedgerHeadPath({ feedbackDir }), 'utf8');

    const makeAction = (actionId) => ({
      toolName: 'Browser',
      toolInput: {
        command: 'Click Subscribe and confirm checkout',
        costUsd: 588,
        financialControl: {
          requisitionId: reserved.requisition.requisitionId,
          reservationId: reserved.requisition.reservationId,
          actionId,
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
    });
    const first = evaluateFinancialControl(
      makeAction('authorized-before-rollback'),
      authOptions(feedbackDir, requester, { consumeReservation: true })
    );
    assert.equal(first.mode, 'allow');
    assert.equal(first.authorization.status, 'authorized');

    // Reproduce the stronger rollback: restore the exact, valid signed ledger
    // and head captured while the reservation was reusable. The independent
    // monotonic anchor remains at the later authorized checkpoint.
    fs.writeFileSync(ledgerPath, reservedLedger, 'utf8');
    fs.writeFileSync(getLedgerHeadPath({ feedbackDir }), reservedHead, 'utf8');

    const replay = evaluateFinancialControl(
      makeAction('replay-after-ledger-rollback'),
      authOptions(feedbackDir, requester, { consumeReservation: true })
    );
    assert.equal(replay.mode, 'block');
    assert.ok(replay.reasonCodes.includes('financial_ledger_tampered'));
    assert.equal(fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').length, 2);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});
