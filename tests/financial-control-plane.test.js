'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const {
  buildActionAuthorization,
  createPurchaseRequisition,
  detectEconomicAction,
  detectOpaqueScreenMutation,
  evaluateFinancialControl,
  getBrowserPageStatePath,
  getLedgerHeadPath,
  getLedgerJournalPath,
  getLedgerPath,
  getFinancialControlRuntimeOptions,
  getRuntimePrincipal,
  lookupRecordedBrowserPageUrl,
  projectRequisition,
  reconcilePurchaseLedger,
  recordBrowserPageNavigation,
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
  assert.equal(detectEconomicAction('Browser', { ref_id: 'page', id: 17 }), false);
  assert.equal(detectEconomicAction('computer', { action: 'click', coordinate: [920, 640] }), false);
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

// --- opaque screen-mutation & money-only click detection ------------------
// A native browser locator is still classified as an opaque screen mutation by
// detectOpaqueScreenMutation(), but detectEconomicAction() and
// evaluateFinancialControl() only treat a click or form action as economic
// when there is evidence of money (a spend-surface URL or purchase action text).
test('a coordinate-addressed click is an opaque screen mutation', () => {
  assert.equal(detectOpaqueScreenMutation('mcp__claude-in-chrome__computer', {
    action: 'left_click', coordinate: [120, 240], tabId: 1,
  }), true);
});

test('element-reference and selector locators are equally opaque', () => {
  for (const locator of [{ ref: 'ref_7' }, { selector: '#confirm' }, { elementId: 'e12' }]) {
    assert.equal(
      detectOpaqueScreenMutation('mcp__claude-in-chrome__computer', { action: 'left_click', ...locator }),
      true,
      `expected ${Object.keys(locator)[0]} to be treated as opaque`,
    );
  }
});

test('observation-only screen calls are not mutations', () => {
  assert.equal(detectOpaqueScreenMutation('mcp__claude-in-chrome__computer', {
    action: 'screenshot', tabId: 1,
  }), false);
});

test('a non-screen tool carrying coordinates is not a screen mutation', () => {
  assert.equal(detectOpaqueScreenMutation('Bash', {
    command: 'git status', coordinate: [1, 2],
  }), false);
});

// Regression: on 2026-11-11 a Mac dispatch run (issue #4922) was denied a
// read-only `mcp__browseros-neo__read` of a Google AI Mode page because a
// pre-#4901 checkout treated any browser call with a selector as an opaque
// economic click. Reading page text must never need a purchase requisition.
test('read-only browser page reads with a locator are not economic actions', () => {
  const reads = [
    { page: 60 },
    { page: 60, format: 'markdown', links: true, selector: 'main' },
    { page: 60, ref: 'e5', format: 'markdown' },
    { page: 60, url: 'https://www.google.com/search?q=agentic+graphrag&udm=50' },
  ];
  for (const toolInput of reads) {
    assert.equal(
      detectEconomicAction('mcp__browseros-neo__read', toolInput),
      false,
      `expected read ${JSON.stringify(toolInput)} to be non-economic`,
    );
    assert.equal(runHardFloor({ tool_name: 'mcp__browseros-neo__read', tool_input: toolInput }), null);
  }
  // A read that lands on a real checkout surface still fails closed.
  assert.equal(
    detectEconomicAction('mcp__browseros-neo__read', { page: 60, url: 'https://checkout.stripe.com/c/pay/cs_test_123' }),
    true,
  );
});

test('ordinary and OAuth account-chooser clicks without payment controls are allowed', () => {
  assert.equal(detectEconomicAction('mcp__claude-in-chrome__computer', {
    action: 'left_click', coordinate: [10, 20], tabId: 1,
  }), false);
  assert.equal(detectEconomicAction('mcp__browseros-neo__act', {
    page: 62, kind: 'click', ref: 'e2', session: 'bf3a78ee-2030-44e1-848d-2f72e6984ee2', diff: 1500,
  }), false);
  const chooserClick = { page: 62, kind: 'click', ref: 'e2', url: 'https://accounts.google.com/o/oauth2/v2/auth', text: 'Choose an account' };
  assert.equal(detectEconomicAction('mcp__browseros-neo__act', chooserClick), false);
  assert.equal(runHardFloor({ tool_name: 'mcp__browseros-neo__act', tool_input: chooserClick }), null);
  // BrowserOS act clicks on linkedin.com and Gmail send buttons are allowed.
  const linkedinSave = { page: 64, kind: 'click', ref: 'e12', url: 'https://www.linkedin.com/feed/update/urn:li:activity:7526253985255817216/', text: 'Save' };
  assert.equal(detectEconomicAction('mcp__browseros-neo__act', linkedinSave), false);
  assert.equal(runHardFloor({ tool_name: 'mcp__browseros-neo__act', tool_input: linkedinSave }), null);
  const gmailSend = { page: 65, kind: 'click', ref: 'e18', url: 'https://mail.google.com/mail/u/0/#inbox?compose=new', text: 'Send' };
  assert.equal(detectEconomicAction('mcp__browseros-neo__act', gmailSend), false);
  assert.equal(evaluateFinancialControl({ toolName: 'mcp__browseros-neo__act', toolInput: gmailSend }).mode, 'allow');
  assert.equal(runHardFloor({ tool_name: 'mcp__browseros-neo__act', tool_input: gmailSend }), null);
  // Free directory forms and LinkedIn/GitHub/docs URLs with buy/purchase/billing in non-spend slugs stay allowed.
  for (const toolInput of [
    { page: 66, kind: 'submit', ref: 'e21', url: 'https://mcp.so/submit', text: 'Submit listing' },
    { page: 64, kind: 'fill', ref: 'e13', url: 'https://www.linkedin.com/feed/', value: 'ThumbGate blocks unauthorized purchase calls' },
    { page: 64, kind: 'click', ref: 'e14', url: 'https://www.linkedin.com/posts/igorganapolsky_why-teams-buy-guardrails-activity-123/', text: 'Save' },
    { page: 67, kind: 'click', ref: 'e30', url: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/scripts/billing.js', text: 'Raw' },
    { page: 67, kind: 'click', ref: 'e31', url: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/tests/purchase-flow.test.js', text: 'Raw' },
    { page: 67, kind: 'click', ref: 'e32', url: 'https://github.com/acme/billing', text: 'Code' },
    { kind: 'click', ref: 'e1', url: 'https://[::1' },
    { kind: 'click', ref: 'e1', url: 'https://example.com/%ZZ' },
  ]) {
    assert.equal(detectEconomicAction('mcp__browseros-neo__act', toolInput), false, `expected ${JSON.stringify(toolInput)} to be non-economic`);
    assert.equal(runHardFloor({ tool_name: 'mcp__browseros-neo__act', tool_input: toolInput }), null);
  }
  assert.equal(detectEconomicAction('WebFetch', { url: 'https://docs.stripe.com/subscriptions/how-to-subscribe' }), false);
  assert.equal(detectEconomicAction('Bash', {
    command: 'gh issue comment --body "a paid tier"',
    metadata: { context: 'Fix the purchase button' },
  }), false);
});

test('routine shell work and quoted agent prompts mentioning checkout are not economic actions', () => {
  for (const command of [
    'git status',
    'git switch -c wip',
    'npm run test:ops',
    'ls -la',
    'gh issue comment --body "a paid tier"',
    'gh issue comment 42 --body "We added a paid tier and purchase flow"',
    'git commit -m "docs: describe paid purchase and subscription flow"',
    'node --test tests/purchase-flow.test.js',
    'python3 scripts/audit.py --tier paid --mode purchase',
    'herdr --session thumbgate agent prompt w1:pN "Bug: PreToolUse blocked a click; the prompt mentioned pay, checkout, purchase, and card."',
    'gh pr comment 4896 --body "Verify Pay now and Complete purchase controls stay denied on checkout."',
    'echo "Click Pay now on checkout"',
    '__proto__ foo',
    'constructor bar',
  ]) {
    assert.equal(detectEconomicAction('Bash', { command }), false, `expected "${command}" to be allowed`);
    assert.equal(runHardFloor({ tool_name: 'Bash', tool_input: { command } }), null);
  }
});

test('control plane denies payment-control clicks, spend-surface clicks, and payment provider CLI/API charges', () => {
  for (const toolInput of [
    { page: 62, kind: 'click', ref: 'e5', text: 'Pay now' },
    { action: 'click', element: 'Complete purchase', ref: 'e9' },
    { page: 63, kind: 'fill', ref: 'e6', placeholder: 'Add a payment method', value: '4242' },
    { page: 63, kind: 'fill', ref: 'e6', value: '4242', description: 'Add a payment method and complete purchase' },
    { page: 63, fields: [{ ref: 'e6', placeholder: 'Add a payment method', value: '4242' }] },
    { page: 63, fields: [{ ref: 'e6', kind: 'click', text: 'Pay now' }] },
    { page: 63, kind: 'click', ref: 'e7', url: 'https://checkout.stripe.com/c/pay/cs_live_123' },
    { page: 63, kind: 'click', ref: 'e7', url: 'https://stripe.com/%63heckout' },
    { page: 63, kind: 'click', ref: 'e7', url: 'https://dashboard.stripe.com/acct_123/payments' },
    { page: 63, kind: 'click', ref: 'e8', pageUrl: 'https://console.cloud.google.com/billing/012345-6789AB-CDEF01' },
    { page: 63, kind: 'click', ref: 'e8', pageUrl: 'https://us-east-1.console.aws.amazon.com/cost-management/home' },
    { page: 63, kind: 'click', ref: 'e8', pageUrl: 'https://portal.azure.com/#view/Microsoft_Azure_Billing/SubscriptionsBlade' },
    { page: 63, kind: 'click', ref: 'e8', pageUrl: 'https://dash.cloudflare.com/abc123/billing' },
    { page: 63, kind: 'click', ref: 'e9', tabUrl: 'https://ads.linkedin.com/campaignmanager/accounts/123/campaigns' },
    { page: 63, kind: 'click', ref: 'e9', tabUrl: 'https://www.linkedin.com/campaignmanager/accounts/123' },
    { page: 63, kind: 'click', ref: 'e9', tabUrl: 'https://business.facebook.com/adsmanager/manage/campaigns' },
    { page: 63, kind: 'click', ref: 'e10', url: 'https://apps.apple.com./us/app/example/id123?action=buy' },
    { page: 63, kind: 'click', ref: 'e10', url: 'https://play.google.com/store/apps/details?id=com.example&action=purchase' },
    { page: 63, kind: 'click', ref: 'e10', url: 'https://appstoreconnect.apple.com/agreements' },
    { page: 63, kind: 'click', ref: 'e11', url: 'https://github.com/settings/billing' },
    { page: 63, kind: 'click', ref: 'e11', url: 'https://acme.example.com/account/upgrade' },
    { page: 63, kind: 'click', ref: 'e12', url: 'https://api-m.paypal.com/v2/checkout/orders' },
    { page: 63, kind: 'click', ref: 'e12', url: 'https://connect.squareup.com/v2/payments' },
  ]) {
    assert.equal(detectEconomicAction('mcp__browseros-neo__act', toolInput), true, `expected ${JSON.stringify(toolInput)} to be economic`);
    const clicked = evaluateFinancialControl({
      toolName: 'mcp__browseros-neo__act',
      toolInput,
    });
    assert.equal(clicked.mode, 'block');
    assert.equal(clicked.economicAction, true);
    const hardFloor = JSON.parse(runHardFloor({
      tool_name: 'mcp__browseros-neo__act',
      tool_input: toolInput,
    }));
    assert.equal(hardFloor.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(hardFloor.hookSpecificOutput.permissionDecisionReason, /\[GATE:financial-control\]/);
  }
  assert.equal(detectEconomicAction('mcp__browseros-neo__run', {
    code: "await page.goto('https://checkout.stripe.com/c/pay/cs_live_123');",
  }), true);

  for (const command of [
    'stripe charges create',
    'stripe --live charges create --amount 5000 --currency usd',
    'stripe --api-key sk_test_123 refunds create --charge ch_123',
    'stripe payment_links create -d "line_items[0][price]=price_123"',
    'npx stripe@latest charges create --amount 5000',
    'sudo bash -c "stripe charges create"',
    'env FOO=1 sh -c "aws ce get-cost-and-usage"',
    'gcloud --project my-proj billing projects link my-project --billing-account 012345-6789AB-CDEF01',
    'aws ce get-cost-and-usage --time-period Start=2026-11-01,End=2026-11-11 --granularity DAILY --metrics BlendedCost',
    'aws --profile prod --region us-east-1 ec2 purchase-reserved-instances-offering --reserved-instances-offering-id off_1 --instance-count 1',
    'aws budgets create-budget --account-id 123456789012',
    'aws savingsplans create-savings-plan --savings-plan-offering-id sp_1',
    'aws route53domains register-domain --domain-name example.com',
    'az billing account list',
    'heroku addons:create heroku-postgresql:standard-0',
    'flyctl volumes create data_vol --size 10',
    'wrangler billing',
    'vercel domains buy example.com',
    'curl --url="https://app.apollo.io/#/settings/plans/upgrade"',
    'curl --url=http://checkout.stripe.com/c/pay/cs_live_123',
    'curl -X POST https://api.stripe.com/v1/./charges -d amount=5000 -d currency=usd',
    'curl -X POST https://api.stripe.com/v1/%63harges -d amount=5000 -d currency=usd',
    'curl -X POST https://api.stripe.com/v1/checkout/sessions -d mode=payment',
  ]) {
    assert.equal(detectEconomicAction('Bash', { command }), true, `expected "${command}" to be economic`);
    const hardFloor = JSON.parse(runHardFloor({
      tool_name: 'Bash',
      tool_input: { command },
    }));
    assert.equal(hardFloor.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(hardFloor.hookSpecificOutput.permissionDecisionReason, /\[GATE:financial-control\]/);
  }
  // Long pathological URLs evaluate in linear time without stalling the gate.
  const startedAt = Date.now();
  assert.equal(detectEconomicAction('mcp__browseros-neo__act', {
    kind: 'click',
    ref: 'e1',
    url: `https://example.com/${'segment/'.repeat(2000)}profile`,
  }), false);
  assert.ok(Date.now() - startedAt < 250, 'URL spend-surface check must stay linear');

  const observed = evaluateFinancialControl({
    toolName: 'mcp__claude-in-chrome__computer',
    toolInput: { action: 'screenshot', tabId: 1 },
  });
  assert.equal(observed.mode, 'allow');
  assert.equal(observed.economicAction, false);
});

test('recorded browser navigate and tabs-new URLs gate subsequent page-only act clicks', () => {
  const { feedbackDir, requester } = fixture();
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-browser-pages-'));
  const previousRuntimeDir = process.env.THUMBGATE_RUNTIME_DIR;
  const previousFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const hookPath = path.resolve(__dirname, '..', 'scripts', 'hook-pre-tool-use.js');
  const runHook = (toolName, toolInput) => spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
    encoding: 'utf8',
    env: { ...process.env, THUMBGATE_RUNTIME_DIR: runtimeDir, THUMBGATE_FEEDBACK_DIR: feedbackDir },
  });
  process.env.THUMBGATE_RUNTIME_DIR = runtimeDir;
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  try {
    // 1. Navigate page 7 to checkout.stripe.com (passes hook via approved reservation) -> act click page 7 denied.
    const navInput = { page: 7, url: 'https://checkout.stripe.com/c/pay/cs_live_123', costUsd: 19 };
    const created = createPurchaseRequisition({
      taskId: 'open-stripe-checkout-tab', vendor: 'Stripe', amountUsd: 19, purpose: 'Inspect checkout session',
      sourceMessageId: 'user-msg-page-7', evidence: ['Checkout session $19'], idempotencyKey: 'page-7-stripe-nav',
      toolName: 'mcp__browseros-neo__navigate', toolInput: navInput,
    }, authOptions(feedbackDir, requester));
    decideEscalation({
      escalationId: created.requisition.escalationId, decision: 'approved', reason: 'Approved opening checkout page 7.',
    }, reviewerOptions(feedbackDir));
    const reserved = reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId, amountUsd: 19, vendor: 'Stripe',
      purpose: 'Inspect checkout session', sourceMessageId: 'user-msg-page-7',
    }, authOptions(feedbackDir, requester));
    const approvedNavigateCall = {
      tool_name: 'mcp__browseros-neo__navigate',
      tool_input: {
        ...navInput,
        financialControl: {
          requisitionId: reserved.requisition.requisitionId, reservationId: reserved.requisition.reservationId,
          actionId: 'nav-page-7-once', vendor: 'Stripe', purpose: 'Inspect checkout session', sourceMessageId: 'user-msg-page-7',
        },
      },
      budget: { maxCostUsdPerAction: 19, remainingCostUsd: 19, hasMaxCostUsdPerAction: true, hasRemainingCostUsd: true },
    };
    const runtimeOpts = authOptions(feedbackDir, requester, { runtimeDir });
    assert.equal(runHardFloor(approvedNavigateCall, runtimeOpts), null);
    assert.equal(finalizeFinancialAuthorization(approvedNavigateCall, runtimeOpts), null);
    assert.equal(lookupRecordedBrowserPageUrl(7, { runtimeDir }), 'https://checkout.stripe.com/c/pay/cs_live_123');
    assert.equal(fs.existsSync(getBrowserPageStatePath({ runtimeDir })), true);

    const page7Click = { page: 7, kind: 'click', ref: 'e4' };
    assert.equal(detectEconomicAction('mcp__browseros-neo__act', page7Click), true);
    const page7Floor = JSON.parse(runHardFloor({ tool_name: 'mcp__browseros-neo__act', tool_input: page7Click }));
    assert.equal(page7Floor.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(page7Floor.hookSpecificOutput.permissionDecisionReason, /\[GATE:financial-control\]/);
    assert.equal(JSON.parse(runHook('mcp__browseros-neo__act', page7Click).stdout).hookSpecificOutput.permissionDecision, 'deny');

    // 2. Navigate page 8 to linkedin.com through real hook -> act click page 8 allowed.
    const page8NavHook = runHook('mcp__browseros-neo__navigate', { page: 8, url: 'https://www.linkedin.com/feed/' });
    assert.equal(page8NavHook.status, 0);
    assert.notEqual(JSON.parse(page8NavHook.stdout || '{}').hookSpecificOutput?.permissionDecision, 'deny');
    assert.equal(lookupRecordedBrowserPageUrl('8', { runtimeDir }), 'https://www.linkedin.com/feed/');
    const page8Click = { page: 8, kind: 'click', ref: 'e12' };
    assert.equal(detectEconomicAction('mcp__browseros-neo__act', page8Click), false);
    assert.equal(runHardFloor({ tool_name: 'mcp__browseros-neo__act', tool_input: page8Click }), null);
    assert.notEqual(JSON.parse(runHook('mcp__browseros-neo__act', page8Click).stdout || '{}').hookSpecificOutput?.permissionDecision, 'deny');

    // Denied navigate on page 8 does NOT overwrite recorded linkedin.com state.
    const blockedNavHook = runHook('mcp__browseros-neo__navigate', { page: 8, url: 'https://checkout.stripe.com/c/pay/cs_blocked' });
    assert.equal(JSON.parse(blockedNavHook.stdout).hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(lookupRecordedBrowserPageUrl(8, { runtimeDir }), 'https://www.linkedin.com/feed/');

    // 3. Act click on page 99 never seen -> allowed.
    const page99Click = { page: 99, kind: 'click', ref: 'e1' };
    assert.equal(detectEconomicAction('mcp__browseros-neo__act', page99Click), false);
    assert.equal(runHardFloor({ tool_name: 'mcp__browseros-neo__act', tool_input: page99Click }), null);

    // 4. tabs-new recording + navigating page 7 away to non-spend URL + edge guards.
    assert.equal(recordBrowserPageNavigation('mcp__browseros-neo__tabs', {
      action: 'new', page: 17, url: 'https://console.cloud.google.com/billing/012345',
    }, { runtimeDir }), true);
    assert.equal(recordBrowserPageNavigation('mcp__playwright__browser_tab_new', {
      page: 18, url: 'https://checkout.stripe.com/c/pay/cs_tab_18',
    }, { runtimeDir }), true);
    assert.equal(detectEconomicAction('mcp__browseros-neo__act', { page: 17, kind: 'click', ref: 'e3', href: '#submit' }), true);
    assert.equal(detectEconomicAction('mcp__claude-in-chrome__computer', { page: 99, tabId: 18, action: 'left_click', coordinate: [10, 10] }), true);
    assert.equal(recordBrowserPageNavigation('mcp__browseros-neo__tabs', {
      action: 'list', page: 17, url: 'https://www.linkedin.com/feed/',
    }, { runtimeDir }), false);
    assert.equal(recordBrowserPageNavigation('Browser', {
      action: 'navigate', tabId: 7, url: 'https://www.linkedin.com/feed/',
    }, { runtimeDir }), true);
    assert.equal(detectEconomicAction('mcp__browseros-neo__act', page7Click), false);
    assert.equal(recordBrowserPageNavigation('Bash', { command: 'ls' }, { runtimeDir }), false);
    assert.equal(recordBrowserPageNavigation('mcp__browseros-neo__navigate', { page: '__proto__', url: 'https://checkout.stripe.com/c/pay/1' }, { runtimeDir }), false);
    assert.equal(recordBrowserPageNavigation('mcp__browseros-neo__navigate', { page: 19, url: 'javascript:void(0)' }, { runtimeDir }), false);
    assert.equal(lookupRecordedBrowserPageUrl('', { runtimeDir }), '');

    const corruptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-browser-corrupt-'));
    const blockerFile = path.join(corruptDir, 'not-a-dir');
    fs.writeFileSync(blockerFile, 'file', 'utf8');
    fs.writeFileSync(getBrowserPageStatePath({ runtimeDir: corruptDir }), '{not-json', 'utf8');
    try {
      assert.equal(lookupRecordedBrowserPageUrl(7, { runtimeDir: corruptDir }), '');
      assert.equal(recordBrowserPageNavigation('mcp__browseros-neo__navigate', {
        page: 7, url: 'https://www.linkedin.com/feed/',
      }, { runtimeDir: blockerFile }), false);
    } finally {
      fs.rmSync(corruptDir, { recursive: true, force: true });
    }
  } finally {
    if (previousRuntimeDir === undefined) delete process.env.THUMBGATE_RUNTIME_DIR;
    else process.env.THUMBGATE_RUNTIME_DIR = previousRuntimeDir;
    if (previousFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = previousFeedbackDir;
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('withdrawn human approval after reservation fails closed at T=0 execution', () => {
  const { feedbackDir, requester, request } = fixture();
  try {
    const created = createPurchaseRequisition(request, authOptions(feedbackDir, requester));
    decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'approved',
      reason: 'Approved at T1 evaluation.',
    }, reviewerOptions(feedbackDir));

    const reserved = reservePurchaseRequisition({
      requisitionId: created.requisition.requisitionId,
      amountUsd: 588,
      vendor: 'Apollo',
      purpose: 'Annual data plan',
      sourceMessageId: 'user-message-42',
    }, authOptions(feedbackDir, requester));
    assert.equal(reserved.requisition.status, 'reserved');

    // Authority is withdrawn before execution runs at T=0.
    const withdrawn = decideEscalation({
      escalationId: created.requisition.escalationId,
      decision: 'cancelled',
      reason: 'Authority withdrawn before execution.',
    }, reviewerOptions(feedbackDir));
    assert.equal(withdrawn.escalation.status, 'cancelled');

    const control = evaluateFinancialControl({
      toolName: 'Browser',
      toolInput: {
        command: 'Click Subscribe and confirm checkout',
        costUsd: 588,
        financialControl: {
          requisitionId: reserved.requisition.requisitionId,
          reservationId: reserved.requisition.reservationId,
          actionId: 'apollo-checkout-after-withdrawal',
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

    assert.equal(control.mode, 'block');
    assert.ok(control.reasonCodes.includes('financial_approval_binding_invalid'));
    assert.ok(control.reasonCodes.includes('requisition_not_reserved'));
    assert.equal(projectRequisition(created.requisition.requisitionId, authOptions(feedbackDir, requester)).status, 'cancelled');
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});
