'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SPEND_CONTROL_GATE_ID,
  capturePromptSpendAuthorization,
  classifyFinancialAction,
  evaluateSpendControl,
  getSpendControlPaths,
  getSpendControlStatus,
  parsePromptSpendAuthorization,
} = require('../scripts/spend-control');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-spend-control-'));
}

function purchaseInput(overrides = {}) {
  return {
    session_id: 'session-spend-1',
    tool_name: 'Browser',
    tool_input: {
      action: 'click',
      description: 'Confirm Apollo credits purchase',
      thumbgateSpend: {
        vendor: 'Apollo',
        amount: '99.00',
        currency: 'USD',
        operation: 'credit_purchase',
      },
    },
    ...overrides,
  };
}

test('human spend authorization requires explicit authority, session, vendor, and amount', () => {
  const accepted = parsePromptSpendAuthorization(
    'I explicitly authorize you to spend up to $100 on Apollo credits.',
    { sessionId: 'session-spend-1', nowMs: 1_000 },
  );
  assert.ok(accepted);
  assert.equal(accepted.vendor, 'Apollo');
  assert.equal(accepted.currency, 'USD');
  assert.equal(accepted.maxAmountCents, 10_000);
  assert.equal(accepted.source, 'human_user_prompt');

  assert.equal(parsePromptSpendAuthorization('We should probably upgrade Apollo for $100.', { sessionId: 's' }), null);
  assert.equal(parsePromptSpendAuthorization('I do not authorize spending $100 on Apollo.', { sessionId: 's' }), null);
  assert.equal(parsePromptSpendAuthorization('I authorize upgrading Apollo.', { sessionId: 's' }), null);
  assert.equal(parsePromptSpendAuthorization('I authorize spending $100.', { sessionId: 's' }), null);
  assert.equal(parsePromptSpendAuthorization('I authorize spending $100 on Apollo.', {}), null);
});

test('financial actions require a structured spend declaration', () => {
  const action = classifyFinancialAction('Bash', {
    command: 'open https://app.apollo.io/billing/checkout',
  });
  assert.ok(action);
  assert.equal(action.operation, 'checkout_entry');

  const dir = makeTmpDir();
  const denied = evaluateSpendControl({
    session_id: 'session-spend-1',
    tool_name: 'Bash',
    tool_input: { command: 'open https://app.apollo.io/billing/checkout' },
  }, { feedbackDir: dir, nowMs: 1_000 });
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.gate, SPEND_CONTROL_GATE_ID);
  assert.match(denied.message, /thumbgateSpend/);
  assert.ok(classifyFinancialAction('Browser', { action: 'navigate', url: 'https://example.com/billing' }));
  assert.ok(classifyFinancialAction('mcp__bank__transfer', { description: 'Wire funds to a vendor' }));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('purpose-built financial mutation tool names fail closed even with sparse input', () => {
  const dir = makeTmpDir();
  for (const toolName of [
    'purchase_domain',
    'stripe.create_checkout_session',
    'payment_intent_confirm',
    'subscription_update',
    'buy_credits',
    'bank_transfer',
    'wire_transfer',
    'create_order',
    'send_money',
  ]) {
    const result = evaluateSpendControl({
      tool_name: toolName,
      tool_input: {},
      session_id: 'session-direct-tool',
    }, { feedbackDir: dir });
    assert.equal(result.decision, 'deny', toolName);
    assert.equal(result.gate, SPEND_CONTROL_GATE_ID, toolName);
    assert.equal(result.spendReceipt.reasonCode, 'structured_spend_declaration_required', toolName);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('read-only financial tools do not become false-positive purchase mutations', () => {
  const dir = makeTmpDir();
  for (const toolName of ['list_invoices', 'get_checkout_session', 'billing_status', 'list_bank_transfers', 'get_order']) {
    assert.equal(evaluateSpendControl({
      tool_name: toolName,
      tool_input: { customerId: 'customer_test' },
      session_id: 'session-read-only',
    }, { feedbackDir: dir }), null, toolName);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ordinary source inspection and edits do not trigger the financial hard floor', () => {
  assert.equal(classifyFinancialAction('Bash', { command: 'rg "upgrade|checkout" src tests' }), null);
  assert.equal(classifyFinancialAction('Edit', {
    file_path: 'public/index.html',
    new_string: 'Upgrade at checkout',
  }), null);
});

test('a same-turn authorization allows one matching purchase and writes an append-only receipt', () => {
  const dir = makeTmpDir();
  const captured = capturePromptSpendAuthorization(
    'I authorize you to spend up to $100 on Apollo credits.',
    { sessionId: 'session-spend-1', promptId: 'prompt-1', nowMs: 1_000 },
    { feedbackDir: dir },
  );
  assert.equal(captured.recorded, true);

  const allowed = evaluateSpendControl(purchaseInput(), { feedbackDir: dir, nowMs: 2_000 });
  assert.equal(allowed, null);
  const status = getSpendControlStatus({ feedbackDir: dir, nowMs: 2_000 });
  assert.equal(status.authorizations[0].remainingAmountCents, 100);
  assert.equal(status.authorizations[0].reservations.length, 1);

  const receipts = fs.readFileSync(getSpendControlPaths({ feedbackDir: dir }).receiptsPath, 'utf8')
    .trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(receipts.length, 2);
  assert.equal(receipts[1].decision, 'allow');
  assert.equal(receipts[1].amountCents, 9_900);
  assert.equal(receipts[1].reservation, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the same purchase cannot execute twice under one authorization', () => {
  const dir = makeTmpDir();
  capturePromptSpendAuthorization(
    'I authorize you to spend up to $200 on Apollo credits.',
    { sessionId: 'session-spend-1', nowMs: 1_000 },
    { feedbackDir: dir },
  );
  assert.equal(evaluateSpendControl(purchaseInput(), { feedbackDir: dir, nowMs: 2_000 }), null);
  const denied = evaluateSpendControl(purchaseInput(), { feedbackDir: dir, nowMs: 3_000 });
  assert.equal(denied.decision, 'deny');
  assert.match(denied.message, /already reserved/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('caller-declared checkout operation cannot disable reservation or duplicate protection', () => {
  const dir = makeTmpDir();
  capturePromptSpendAuthorization(
    'I authorize you to spend up to $200 on Apollo credits.',
    { sessionId: 'session-spend-1', nowMs: 1_000 },
    { feedbackDir: dir },
  );
  const input = purchaseInput({ tool_name: 'buy_credits' });
  input.tool_input.thumbgateSpend.operation = 'checkout';

  const classified = classifyFinancialAction(input.tool_name, input.tool_input);
  assert.equal(classified.operation, 'financial_mutation');
  assert.equal(classified.commit, true);
  assert.equal(evaluateSpendControl(input, { feedbackDir: dir, nowMs: 2_000 }), null);

  const status = getSpendControlStatus({ feedbackDir: dir, nowMs: 2_000 });
  assert.equal(status.authorizations[0].remainingAmountCents, 10_100);
  assert.equal(status.authorizations[0].reservations.length, 1);

  input.tool_input.thumbgateSpend.operation = 'payment_method';
  const denied = evaluateSpendControl(input, { feedbackDir: dir, nowMs: 3_000 });
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.spendReceipt.reasonCode, 'duplicate_financial_action');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a failed allow receipt does not consume the authorization budget', () => {
  const dir = makeTmpDir();
  capturePromptSpendAuthorization(
    'I authorize you to spend up to $100 on Apollo credits.',
    { sessionId: 'session-spend-1', nowMs: 1_000 },
    { feedbackDir: dir },
  );
  const { receiptsPath } = getSpendControlPaths({ feedbackDir: dir });
  fs.unlinkSync(receiptsPath);
  fs.mkdirSync(receiptsPath);

  const denied = evaluateSpendControl(purchaseInput(), { feedbackDir: dir, nowMs: 2_000 });
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.spendReceipt.reasonCode, 'audit_ledger_unavailable');

  const status = getSpendControlStatus({ feedbackDir: dir, nowMs: 2_000 });
  assert.equal(status.authorizations[0].status, 'pending');
  assert.equal(status.authorizations[0].remainingAmountCents, 10_000);
  assert.equal(status.authorizations[0].reservations.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('amount, currency, vendor, session, and expiry mismatches fail closed', () => {
  const cases = [
    {
      name: 'amount',
      mutate: (input) => { input.tool_input.thumbgateSpend.amount = '101.00'; },
      expected: /exceeds/i,
    },
    {
      name: 'currency',
      mutate: (input) => { input.tool_input.thumbgateSpend.currency = 'EUR'; },
      expected: /currency/i,
    },
    {
      name: 'vendor',
      mutate: (input) => { input.tool_input.thumbgateSpend.vendor = 'Not Apollo'; },
      expected: /vendor/i,
    },
    {
      name: 'session',
      mutate: (input) => { input.session_id = 'different-session'; },
      expected: /current human message/i,
    },
  ];

  for (const scenario of cases) {
    const dir = makeTmpDir();
    capturePromptSpendAuthorization(
      'I authorize you to spend up to $100 on Apollo credits.',
      { sessionId: 'session-spend-1', nowMs: 1_000 },
      { feedbackDir: dir },
    );
    const input = purchaseInput();
    scenario.mutate(input);
    const denied = evaluateSpendControl(input, { feedbackDir: dir, nowMs: 2_000 });
    assert.equal(denied.decision, 'deny', scenario.name);
    assert.match(denied.message, scenario.expected, scenario.name);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const expiredDir = makeTmpDir();
  capturePromptSpendAuthorization(
    'I authorize you to spend up to $100 on Apollo credits.',
    { sessionId: 'session-spend-1', nowMs: 1_000 },
    { feedbackDir: expiredDir },
  );
  const expired = evaluateSpendControl(purchaseInput(), { feedbackDir: expiredDir, nowMs: 1_000 + (11 * 60 * 1_000) });
  assert.equal(expired.decision, 'deny');
  assert.match(expired.message, /expired/i);
  fs.rmSync(expiredDir, { recursive: true, force: true });
});

test('a new human prompt revokes the prior turn authorization', () => {
  const dir = makeTmpDir();
  capturePromptSpendAuthorization(
    'I authorize you to spend up to $100 on Apollo credits.',
    { sessionId: 'session-spend-1', promptId: 'prompt-1', nowMs: 1_000 },
    { feedbackDir: dir },
  );
  const superseding = capturePromptSpendAuthorization(
    'Continue with the research, but make no purchase.',
    { sessionId: 'session-spend-1', promptId: 'prompt-2', nowMs: 2_000 },
    { feedbackDir: dir },
  );
  assert.equal(superseding.recorded, false);
  const denied = evaluateSpendControl(purchaseInput(), { feedbackDir: dir, nowMs: 3_000 });
  assert.equal(denied.decision, 'deny');
  assert.match(denied.message, /current human message/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ledger contention fails closed instead of allowing an unreserved purchase', () => {
  const dir = makeTmpDir();
  capturePromptSpendAuthorization(
    'I authorize you to spend up to $100 on Apollo credits.',
    { sessionId: 'session-spend-1', nowMs: 1_000 },
    { feedbackDir: dir },
  );
  fs.mkdirSync(getSpendControlPaths({ feedbackDir: dir }).lockPath);
  const denied = evaluateSpendControl(purchaseInput(), {
    feedbackDir: dir,
    nowMs: 2_000,
    lockTimeoutMs: 5,
  });
  assert.equal(denied.decision, 'deny');
  assert.match(denied.message, /ledger is unavailable/i);
  fs.rmSync(dir, { recursive: true, force: true });
});
