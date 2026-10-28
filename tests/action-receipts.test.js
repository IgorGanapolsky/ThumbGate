'use strict';

// Explicit signing key required (no default public secret).
process.env.THUMBGATE_RECEIPT_SIGNING_KEY = process.env.THUMBGATE_RECEIPT_SIGNING_KEY || 'test-receipt-signing-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Point the feedback pipeline at an isolated tmp dir BEFORE requiring the
// module so receipts never touch the real project state.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-receipts-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const {
  recordReceipt,
  computeCanonicalRequestDigest,
  signReceiptDigest,
  getReceiptForAction,
  getRecentReceipts,
  pairFeedbackWithReceipt,
  reconstructModelVisibleFacts,
  buildReceiptContextEntries,
  getReceiptsPath,
  verifyReceiptSignature,
  hashOneShotAction,
  evaluateOneShotControl,
  evaluateOneShotGoalDone,
  evaluateOneShotPretool,
} = require('../scripts/action-receipts');
const { createDurableGrantStore, createMemoryGrantStore, evaluateHarnessGrant } = require('../scripts/human-escalation');

test.after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
  delete process.env.THUMBGATE_FEEDBACK_DIR;
});

test('recordReceipt appends a JSONL line and getReceiptForAction returns it with outcome fields', () => {
  const result = recordReceipt({
    actionId: 'act-1',
    toolName: 'Edit',
    toolInput: { file: 'src/api/server.js' },
    outcome: { diff: '@@ -1 +1 @@', exitCode: 0, testOutcome: 'pass', stateHash: 'abc123' },
  });
  assert.equal(result.recorded, true);

  // JSONL line physically written.
  const raw = fs.readFileSync(getReceiptsPath(), 'utf8');
  const lines = raw.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1);

  const found = getReceiptForAction('act-1');
  assert.ok(found, 'receipt should be found');
  assert.equal(found.actionId, 'act-1');
  assert.equal(found.toolName, 'Edit');
  assert.equal(found.outcome.exitCode, 0);
  assert.equal(found.outcome.testOutcome, 'pass');
  assert.equal(found.outcome.stateHash, 'abc123');
});

test('getRecentReceipts(n) returns the last n in chronological order', () => {
  recordReceipt({ actionId: 'act-2', toolName: 'Bash', outcome: { exitCode: 1 } });
  recordReceipt({ actionId: 'act-3', toolName: 'Write', outcome: { exitCode: 0 } });

  const recent = getRecentReceipts(2);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].actionId, 'act-2');
  assert.equal(recent[1].actionId, 'act-3');
});

test('pairFeedbackWithReceipt enriches a matching feedback payload with outcome + outcomePairedLesson', () => {
  const enriched = pairFeedbackWithReceipt({
    signal: 'down',
    lastAction: { actionId: 'act-1', tool: 'Edit' },
  });

  assert.equal(enriched.signal, 'down', 'original keys preserved');
  assert.ok(enriched.outcome, 'outcome attached');
  assert.equal(enriched.outcome.exitCode, 0);
  assert.equal(enriched.outcome.testOutcome, 'pass');
  assert.equal(typeof enriched.outcomePairedLesson, 'string');
  assert.ok(enriched.outcomePairedLesson.length > 0);
  // form: tool(...) -> outcome
  assert.match(enriched.outcomePairedLesson, /Edit\(.*\) -> .+/);
});

test('pairFeedbackWithReceipt returns the original payload unchanged when no receipt matches', () => {
  const payload = { signal: 'up', lastAction: { actionId: 'does-not-exist' } };
  const out = pairFeedbackWithReceipt(payload);
  assert.equal(out, payload, 'same object returned, no enrichment');
  assert.equal(out.outcome, undefined);
  assert.equal(out.outcomePairedLesson, undefined);
});

test('pairFeedbackWithReceipt with no actionId at all does not throw and returns input', () => {
  const payload = { signal: 'up' };
  const out = pairFeedbackWithReceipt(payload);
  assert.equal(out, payload);
});

test('buildReceiptContextEntries returns namespace action-receipts entries whose text references the outcome', () => {
  const entries = buildReceiptContextEntries('server.js Edit', 5);
  assert.ok(Array.isArray(entries));
  assert.ok(entries.length >= 1, 'should match the Edit receipt');
  for (const entry of entries) {
    assert.equal(entry.namespace, 'action-receipts');
    assert.equal(typeof entry.text, 'string');
    assert.equal(typeof entry.score, 'number');
  }
  const top = entries[0];
  assert.match(top.text, /outcome:/);
});

test('buildReceiptContextEntries with empty query surfaces recent receipts without throwing', () => {
  const entries = buildReceiptContextEntries('', 2);
  assert.ok(Array.isArray(entries));
  assert.ok(entries.length <= 2);
  for (const entry of entries) {
    assert.equal(entry.namespace, 'action-receipts');
  }
});

test('recordReceipt generates canonical requestDigest and verifiable HMAC signature', () => {
  const receipt = recordReceipt({
    actionId: 'act-crypto-1',
    toolName: 'deploy',
    toolInput: { environment: 'production' },
    principal: 'agent-cto',
    target: 'thumbgate-production.up.railway.app',
    decision: 'allow',
    idempotencyKey: 'idem-key-100',
    providerEventId: 'aigate-evt-555',
  });

  assert.ok(receipt.requestDigest, 'requestDigest should be generated');
  assert.ok(receipt.signature, 'signature should be generated');
  assert.equal(receipt.principal, 'agent-cto');
  assert.equal(receipt.decision, 'allow');
  assert.equal(receipt.providerEventId, 'aigate-evt-555');

  const isValid = verifyReceiptSignature(receipt);
  assert.equal(isValid, true, 'HMAC signature should be verified');
});

test('verifyReceiptSignature recomputes digest and rejects field tampering', () => {
  const receipt = recordReceipt({
    actionId: 'act-tamper-1',
    toolName: 'deploy',
    toolInput: { environment: 'production' },
    target: 'prod',
    decision: 'allow',
    idempotencyKey: 'idem-tamper',
  });
  assert.equal(verifyReceiptSignature(receipt), true);
  const tampered = { ...receipt, toolName: 'rm' };
  assert.equal(verifyReceiptSignature(tampered), false);
});

test('canonical digest avoids pipe-delimiter collisions', () => {
  const a = computeCanonicalRequestDigest({
    toolName: 't',
    toolInput: 'x',
    target: 'a|b',
    idempotencyKey: 'c',
    recordedAt: 'ts',
  });
  const b = computeCanonicalRequestDigest({
    toolName: 't',
    toolInput: 'x',
    target: 'a',
    idempotencyKey: 'b|c',
    recordedAt: 'ts',
  });
  assert.notEqual(a, b);
});

test('signReceiptDigest fails closed without signing key', () => {
  const prev = process.env.THUMBGATE_RECEIPT_SIGNING_KEY;
  delete process.env.THUMBGATE_RECEIPT_SIGNING_KEY;
  assert.throws(() => signReceiptDigest('abc'), /THUMBGATE_RECEIPT_SIGNING_KEY/);
  process.env.THUMBGATE_RECEIPT_SIGNING_KEY = prev;
});

test('missing or failing approver fails closed and never silent-allows', () => {
  const store = createMemoryGrantStore();
  const missing = evaluateHarnessGrant(
    { grantId: 'g-missing', grantMode: 'once' },
    { grantStore: store, recordReceipt: false }
  );
  assert.equal(missing.allowed, false);
  assert.equal(missing.failClosed, true);
  assert.equal(missing.reason, 'missing_approver');

  const failing = evaluateHarnessGrant({
    grantId: 'g-fail',
    grantMode: 'once',
    approver: () => { throw new Error('approver down'); },
  }, { grantStore: store, recordReceipt: false });
  assert.equal(failing.allowed, false);
  assert.equal(failing.failClosed, true);
  assert.equal(failing.reason, 'approver_failed');

  const denied = evaluateHarnessGrant({
    grantId: 'g-deny',
    grantMode: 'once',
    approver: () => ({ allow: false, reason: 'no' }),
  }, { grantStore: store, recordReceipt: false });
  assert.equal(denied.allowed, false);
  assert.equal(denied.failClosed, true);
  assert.equal(denied.reason, 'no');
});

test('grants are allow-once only and model-visible facts reconstruct from the receipt log', () => {
  const store = createMemoryGrantStore();
  const always = evaluateHarnessGrant({
    grantId: 'g-always',
    grantMode: 'allow-always',
    approver: () => ({ allow: true }),
  }, { grantStore: store, recordReceipt: false });
  assert.equal(always.allowed, false);
  assert.equal(always.reason, 'allow_always_forbidden');

  const first = evaluateHarnessGrant({
    grantId: 'g-once-receipt',
    grantMode: 'allow-once',
    toolName: 'Bash',
    toolInput: { command: 'echo hi' },
    approver: () => ({ allow: true }),
    principal: 'harness',
  }, { grantStore: store });
  assert.equal(first.allowed, true);
  assert.equal(first.grantMode, 'allow-once');
  assert.equal(first.facts.toolName, 'Bash');

  const second = evaluateHarnessGrant({
    grantId: 'g-once-receipt',
    grantMode: 'allow-once',
    approver: () => ({ allow: true }),
  }, { grantStore: store, recordReceipt: false });
  assert.equal(second.allowed, false);
  assert.equal(second.reason, 'grant_already_consumed');

  const reconstructed = reconstructModelVisibleFacts('g-once-receipt');
  assert.equal(reconstructed.ok, true);
  assert.equal(reconstructed.facts.toolName, 'Bash');
  assert.deepEqual(reconstructed.facts.toolInput, { command: 'echo hi' });
  assert.equal(reconstructed.facts.decision, 'allow');
  assert.equal(reconstructed.facts.principal, 'harness');
  assert.ok(reconstructed.facts.requestDigest);
  assert.ok(reconstructed.facts.recordedAt);

  const missing = reconstructModelVisibleFacts('does-not-exist');
  assert.equal(missing.ok, false);
  assert.equal(missing.failClosed, true);
  assert.equal(missing.reason, 'missing_receipt');
});

test('durable allow-once grants survive a new store instance', () => {
  const firstStore = createDurableGrantStore();
  const first = evaluateHarnessGrant({
    grantId: 'g-durable-once',
    grantMode: 'once',
    approver: () => ({ allow: true }),
  }, { grantStore: firstStore, recordReceipt: false });
  assert.equal(first.allowed, true);

  const restarted = createDurableGrantStore();
  const second = evaluateHarnessGrant({
    grantId: 'g-durable-once',
    grantMode: 'once',
    approver: () => ({ allow: true }),
  }, { grantStore: restarted, recordReceipt: false });
  assert.equal(second.allowed, false);
  assert.equal(second.reason, 'grant_already_consumed');
});

test('reconstructModelVisibleFacts fails closed on tampered receipts', () => {
  const receipt = recordReceipt({
    actionId: 'act-reconstruct-tamper',
    toolName: 'Bash',
    toolInput: { command: 'echo ok' },
    decision: 'allow',
    principal: 'harness',
  });
  const receiptsPath = getReceiptsPath();
  const lines = fs.readFileSync(receiptsPath, 'utf8').split('\n');
  let rewritten = false;
  const tampered = lines.map((line) => {
    if (!line.includes('"act-reconstruct-tamper"')) return line;
    const row = JSON.parse(line);
    row.toolName = 'rm';
    rewritten = true;
    return JSON.stringify(row);
  }).join('\n');
  assert.equal(rewritten, true);
  fs.writeFileSync(receiptsPath, tampered);
  const reconstructed = reconstructModelVisibleFacts('act-reconstruct-tamper');
  assert.equal(reconstructed.ok, false);
  assert.equal(reconstructed.failClosed, true);
  assert.equal(reconstructed.reason, 'unauthenticated_receipt');
});

function withinCap(overrides = {}) {
  return {
    ledgerReadable: true,
    cashCapUsd: 10,
    quotedUsd: 2,
    toolName: 'send',
    toolInput: { to: 'a', amount: 2 },
    idempotencyKey: 'key-1',
    ...overrides,
  };
}

test('OneShot control defaults the cash cap to $0 and never charges', () => {
  const denied = evaluateOneShotControl({
    ledgerReadable: true,
    quotedUsd: 0.01,
    toolName: 'checkout',
    toolInput: { sku: 'pro' },
    modelVerdict: 'allow',
  });
  assert.equal(denied.verdict, 'deny');
  assert.equal(denied.reason, 'over_per_call_cap');
  assert.equal(denied.charged, false);
  assert.equal(denied.reservedUsd, 0);

  const free = evaluateOneShotControl({
    ledgerReadable: true,
    quotedUsd: 0,
    toolName: 'read',
    toolInput: { path: 'a' },
    modelVerdict: 'deny',
  });
  assert.equal(free.verdict, 'allow');
  assert.equal(free.reason, 'within_cap');
  assert.equal(free.charged, false);
  assert.equal(free.reservedUsd, 0);
});

test('OneShot control holds without a readable ledger or a finite quote', () => {
  const unread = evaluateOneShotControl(withinCap({ ledgerReadable: false }));
  assert.equal(unread.verdict, 'hold');
  assert.equal(unread.reason, 'ledger_unreadable');
  assert.equal(unread.charged, false);

  for (const quotedUsd of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const held = evaluateOneShotControl(withinCap({ quotedUsd }));
    assert.equal(held.verdict, 'hold', String(quotedUsd));
    assert.equal(held.reason, 'quote_required');
  }

  const badCap = evaluateOneShotControl(withinCap({ cashCapUsd: Number.NaN }));
  assert.equal(badCap.verdict, 'hold');
  assert.equal(badCap.reason, 'cap_unreadable');
});

test('OneShot control holds an unhashable action and cannot be raised above the cash cap', () => {
  const cycle = {};
  cycle.self = cycle;
  const held = evaluateOneShotControl({
    ledgerReadable: true,
    quotedUsd: 0,
    cashCapUsd: 10,
    toolName: 'send',
    toolInput: cycle,
  });
  assert.equal(held.verdict, 'hold');
  assert.equal(held.reason, 'action_unreadable');
  assert.equal(held.charged, false);

  const raised = evaluateOneShotControl(withinCap({
    cashCapUsd: 10,
    perCallCapUsd: 1e9,
    dailyCapUsd: 1e9,
    quotedUsd: 11,
  }));
  assert.equal(raised.verdict, 'deny');
  assert.equal(raised.reason, 'over_per_call_cap');
  assert.equal(raised.charged, false);
});

test('OneShot control refuses an uncapped agent instead of failing open', () => {
  const refused = evaluateOneShotControl(withinCap({
    uncapped: true,
    ledgerReadable: false,
    cashCapUsd: 1000,
  }));
  assert.equal(refused.verdict, 'deny');
  assert.equal(refused.reason, 'uncapped_refused');
  assert.equal(refused.charged, false);
});

test('OneShot control counts in-flight spend and refuses a replay of the same key', () => {
  const overDaily = evaluateOneShotControl(withinCap({
    quotedUsd: 0.8,
    spentTodayUsd: 0.1,
    inFlightUsd: 0.2,
    dailyCapUsd: 1,
    perCallCapUsd: 1,
    cashCapUsd: 1,
  }));
  assert.equal(overDaily.verdict, 'deny');
  assert.equal(overDaily.reason, 'over_daily_cap');
  assert.equal(overDaily.charged, false);

  const atCap = evaluateOneShotControl(withinCap({
    quotedUsd: 0.7,
    spentTodayUsd: 0.1,
    inFlightUsd: 0.2,
    dailyCapUsd: 1,
    perCallCapUsd: 1,
    cashCapUsd: 1,
  }));
  assert.equal(atCap.verdict, 'allow');
  assert.equal(atCap.reservedUsd, 0.7);
  assert.equal(atCap.charged, false);

  const replay = evaluateOneShotControl(withinCap({
    idempotencyKey: ' key-1 ',
    chargedKeys: ['key-1'],
  }));
  assert.equal(replay.verdict, 'deny');
  assert.equal(replay.reason, 'idempotent_replay');

  const inFlightKey = evaluateOneShotControl(withinCap({
    inFlightKeys: ['key-1'],
  }));
  assert.equal(inFlightKey.verdict, 'hold');
  assert.equal(inFlightKey.reason, 'idempotency_in_flight');

  const numericKey = evaluateOneShotControl(withinCap({ idempotencyKey: 1 }));
  assert.equal(numericKey.verdict, 'hold');
  assert.equal(numericKey.reason, 'idempotency_unreadable');

  const badLedger = evaluateOneShotControl(withinCap({ chargedKeys: 'key-1' }));
  assert.equal(badLedger.verdict, 'hold');
  assert.equal(badLedger.reason, 'ledger_unreadable');
});

test('OneShot control binds approval to one exact unused call', () => {
  const call = withinCap({ irreversible: true, now: 1_000 });
  const actionHash = hashOneShotAction(call);
  const missing = evaluateOneShotControl(call);
  assert.equal(missing.verdict, 'hold');
  assert.equal(missing.reason, 'approval_required');

  const mismatch = evaluateOneShotControl({
    ...call,
    approval: { actionHash: 'other', used: false, expiresAt: 5_000 },
  });
  assert.equal(mismatch.verdict, 'deny');
  assert.equal(mismatch.reason, 'approval_action_mismatch');

  const replayed = evaluateOneShotControl({
    ...call,
    approval: { actionHash, used: true, expiresAt: 5_000 },
  });
  assert.equal(replayed.verdict, 'deny');
  assert.equal(replayed.reason, 'approval_replay');

  const expired = evaluateOneShotControl({
    ...call,
    approval: { actionHash, used: false, expiresAt: 1_000 },
  });
  assert.equal(expired.verdict, 'deny');
  assert.equal(expired.reason, 'approval_expired');

  const allowed = evaluateOneShotControl({
    ...call,
    modelVerdict: 'deny',
    approval: { actionHash, used: false, expiresAt: 1_001 },
  });
  assert.equal(allowed.verdict, 'allow');
  assert.equal(allowed.reason, 'within_cap');
  assert.equal(allowed.actionHash, actionHash);
  assert.equal(allowed.charged, false);
  assert.equal(allowed.reservedUsd, 2);
});

test('OneShot done-check ignores the worker and budget exhaustion', () => {
  const exhausted = evaluateOneShotGoalDone({
    budgetExhausted: true,
    modelSaysDone: true,
    workerId: 'worker',
    confirmerId: 'owner',
    runStartedAt: 100,
    check: { writtenAt: 50, passed: true },
  });
  assert.equal(exhausted.status, 'out_of_budget');
  assert.equal(exhausted.done, false);

  const worker = evaluateOneShotGoalDone({
    modelSaysDone: true,
    workerId: 'worker',
    confirmerId: ' worker ',
    runStartedAt: 100,
  });
  assert.equal(worker.status, 'waiting_owner');
  assert.equal(worker.reason, 'worker_cannot_confirm');
  assert.equal(worker.done, false);

  const modelOnly = evaluateOneShotGoalDone({
    modelSaysDone: true,
    workerId: 'worker',
    runStartedAt: 100,
  });
  assert.equal(modelOnly.status, 'waiting_owner');
  assert.equal(modelOnly.reason, 'model_done_ignored');
  assert.equal(modelOnly.done, false);

  const lateCheck = evaluateOneShotGoalDone({
    modelSaysDone: true,
    runStartedAt: 100,
    check: { writtenAt: 100, passed: true },
  });
  assert.equal(lateCheck.done, false);
  assert.equal(lateCheck.status, 'waiting_owner');

  const failed = evaluateOneShotGoalDone({
    modelSaysDone: true,
    workerId: 'worker',
    confirmerId: 'owner',
    runStartedAt: 100,
    check: { writtenAt: 40, passed: false, missing: ['tests_green'] },
  });
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.missing, ['tests_green']);
  assert.equal(failed.done, false);

  const byCheck = evaluateOneShotGoalDone({
    modelSaysDone: false,
    workerId: 'worker',
    confirmerId: 'worker',
    runStartedAt: 100,
    check: { writtenAt: 40, passed: true },
  });
  assert.equal(byCheck.status, 'waiting_owner');
  assert.equal(byCheck.done, false);
  assert.equal(byCheck.reason, 'evidence_missing');
  assert.deepEqual(byCheck.missing, ['verification_evidence']);

  const byOwner = evaluateOneShotGoalDone({
    workerId: 'worker',
    confirmerId: 'owner',
    runStartedAt: 100,
  });
  assert.equal(byOwner.status, 'waiting_owner');
  assert.equal(byOwner.done, false);
  assert.equal(byOwner.reason, 'evidence_missing');

  const evidence = {
    performed: true,
    passed: true,
    verifier: 'node-test',
    evidence: ['4 tests passed'],
  };
  const evidencedCheck = evaluateOneShotGoalDone({
    workerId: 'worker',
    confirmerId: 'worker',
    runStartedAt: 100,
    check: { writtenAt: 40, passed: true },
    verification: evidence,
  });
  assert.equal(evidencedCheck.status, 'done');
  assert.equal(evidencedCheck.reason, 'check_confirmed');

  const evidencedOwner = evaluateOneShotGoalDone({
    workerId: 'worker',
    confirmerId: 'owner',
    verification: evidence,
  });
  assert.equal(evidencedOwner.status, 'done');
  assert.equal(evidencedOwner.reason, 'owner_confirmed');
});

test('OneShot cents ceil the quote and floor the cap', () => {
  const over = evaluateOneShotControl(withinCap({
    cashCapUsd: 10,
    perCallCapUsd: 10,
    dailyCapUsd: 10,
    quotedUsd: 10.004,
  }));
  assert.equal(over.verdict, 'deny');
  assert.equal(over.reason, 'over_per_call_cap');

  const dust = evaluateOneShotControl(withinCap({
    cashCapUsd: 0.01,
    perCallCapUsd: 0.01,
    dailyCapUsd: 0.01,
    quotedUsd: 0.014,
  }));
  assert.equal(dust.verdict, 'deny');
  assert.equal(dust.reason, 'over_per_call_cap');

  const tiny = evaluateOneShotControl(withinCap({
    cashCapUsd: 0.001,
    perCallCapUsd: 0.001,
    dailyCapUsd: 1,
    quotedUsd: 0.014,
  }));
  assert.equal(tiny.verdict, 'deny');
  assert.equal(tiny.reason, 'over_per_call_cap');

  const summed = evaluateOneShotControl(withinCap({
    cashCapUsd: 3,
    perCallCapUsd: 3,
    dailyCapUsd: 3,
    quotedUsd: 1.004,
    spentTodayUsd: 1.004,
    inFlightUsd: 1.004,
  }));
  assert.equal(summed.verdict, 'deny');
  assert.equal(summed.reason, 'over_daily_cap');
});

test('OneShot blank idempotency keys do not match a charged blank key', () => {
  const blank = evaluateOneShotControl(withinCap({
    idempotencyKey: '   ',
    chargedKeys: ['   '],
  }));
  assert.equal(blank.verdict, 'hold');
  assert.equal(blank.reason, 'idempotency_unreadable');
});

test('OneShot approval flags and action hashes are exact', () => {
  for (const uncapped of [1, 'true']) {
    const refused = evaluateOneShotControl(withinCap({ uncapped, ledgerReadable: false }));
    assert.equal(refused.verdict, 'deny');
    assert.equal(refused.reason, 'uncapped_refused');
  }

  const call = withinCap({ irreversible: 'true', now: 1_000 });
  assert.equal(evaluateOneShotControl(call).reason, 'approval_required');

  const actionHash = hashOneShotAction(call);
  const replayed = evaluateOneShotControl({
    ...call,
    approval: { actionHash, used: 1, expiresAt: 5_000 },
  });
  assert.equal(replayed.verdict, 'deny');
  assert.equal(replayed.reason, 'approval_replay');

  const plain = withinCap({ irreversible: true, now: 1_000 });
  const stillOpen = evaluateOneShotControl({
    ...plain,
    approval: { actionHash: hashOneShotAction(plain), used: false },
  });
  assert.equal(stillOpen.verdict, 'allow');

  const dated = evaluateOneShotControl(withinCap({
    toolInput: new Date(0),
    irreversible: true,
    now: 1_000,
    approval: {
      actionHash: hashOneShotAction(withinCap({ toolInput: {} })),
      used: false,
      expiresAt: 5_000,
    },
  }));
  assert.equal(dated.verdict, 'hold');
  assert.equal(dated.reason, 'action_unreadable');

  const mapped = evaluateOneShotControl(withinCap({ toolInput: new Map() }));
  assert.equal(mapped.verdict, 'hold');
  assert.equal(mapped.reason, 'action_unreadable');
});

test('OneShot failed checks stay failed and identities fold case', () => {
  const undated = evaluateOneShotGoalDone({
    workerId: 'worker',
    confirmerId: 'owner',
    check: { passed: false },
  });
  assert.equal(undated.done, false);
  assert.equal(undated.reason, 'check_failed');

  const lateFail = evaluateOneShotGoalDone({
    workerId: 'worker',
    confirmerId: 'owner',
    runStartedAt: 50,
    check: { writtenAt: 100, passed: false },
  });
  assert.equal(lateFail.done, false);
  assert.equal(lateFail.reason, 'check_failed');

  const exhausted = evaluateOneShotGoalDone({
    budgetExhausted: 1,
    confirmerId: 'owner',
    workerId: 'worker',
    check: { writtenAt: 1, passed: true },
    runStartedAt: 2,
  });
  assert.equal(exhausted.done, false);
  assert.equal(exhausted.status, 'out_of_budget');

  const folded = evaluateOneShotGoalDone({
    workerId: 'worker',
    confirmerId: 'Worker',
  });
  assert.equal(folded.done, false);
  assert.equal(folded.reason, 'worker_cannot_confirm');
});

test('OneShot per-call cap is this quote and in-flight counts against the day', () => {
  const verdict = evaluateOneShotControl(withinCap({
    perCallCapUsd: 5,
    inFlightUsd: 5,
    quotedUsd: 5,
    dailyCapUsd: 100,
    cashCapUsd: 100,
  }));
  assert.equal(verdict.verdict, 'allow');
  assert.equal(verdict.reservedUsd, 5);
});

test('OneShot pretool ignores a payload cash cap and a typed owner', () => {
  const raised = evaluateOneShotPretool('Read', {
    file_path: 'package.json',
    quotedUsd: 0.01,
    ledgerReadable: true,
    cashCapUsd: 1000,
  });
  assert.equal(raised.decision, 'deny');
  assert.equal(raised.gate, 'oneshot-control');
  assert.equal(raised.ruleId, 'over_per_call_cap');

  assert.equal(evaluateOneShotPretool('Read', { file_path: 'package.json' }), null);

  const done = evaluateOneShotPretool('record_task_outcome', {
    status: 'completed',
    workerId: 'worker',
    confirmerId: 'owner',
    modelSaysDone: true,
  });
  assert.equal(done.decision, 'deny');
  assert.equal(done.gate, 'oneshot-goal-done');
  assert.notEqual(done.ruleId, 'owner_confirmed');

  const forgedCheck = evaluateOneShotPretool('record_task_outcome', {
    status: 'completed',
    workerId: 'worker',
    runStartedAt: 100,
    check: { writtenAt: 40, passed: true },
  });
  assert.equal(forgedCheck.decision, 'deny');
  assert.equal(forgedCheck.gate, 'oneshot-goal-done');
  assert.equal(forgedCheck.ruleId, 'evidence_missing');

  const selfVerified = evaluateOneShotPretool('record_task_outcome', {
    status: 'completed',
    workerId: 'worker',
    verification: {
      performed: true,
      passed: true,
      verifier: 'worker',
      evidence: ['4 tests passed'],
    },
  });
  assert.equal(selfVerified.decision, 'deny');
  assert.equal(selfVerified.gate, 'oneshot-goal-done');

  const evidenced = evaluateOneShotPretool('record_task_outcome', {
    status: 'completed',
    workerId: 'worker',
    verification: {
      performed: true,
      passed: true,
      verifier: 'node-test',
      evidence: ['4 tests passed'],
    },
  });
  assert.equal(evidenced, null);
});

test('OneShot control runs from evaluateGates before the inner gate', async () => {
  const { evaluateGates, evaluateGatesAsync } = require('../scripts/gates-engine');
  const quoted = evaluateGates('Read', {
    file_path: 'package.json',
    quotedUsd: 1,
    ledgerReadable: true,
    cashCapUsd: 1000,
  });
  assert.equal(quoted && quoted.decision, 'deny');
  assert.equal(quoted.gate, 'oneshot-control');

  const plain = evaluateGates('Read', { file_path: 'package.json' });
  assert.notEqual(plain && plain.gate, 'oneshot-control');

  const done = evaluateGates('record_task_outcome', {
    status: 'completed',
    workerId: 'worker',
    confirmerId: 'owner',
  });
  assert.equal(done && done.decision, 'deny');
  assert.equal(done.gate, 'oneshot-goal-done');

  const asyncQuoted = await evaluateGatesAsync('Read', {
    file_path: 'package.json',
    quotedUsd: 1,
    ledgerReadable: true,
  });
  assert.equal(asyncQuoted && asyncQuoted.gate, 'oneshot-control');
});
