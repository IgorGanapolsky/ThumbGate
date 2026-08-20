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
} = require('../scripts/action-receipts');
const { createMemoryGrantStore, evaluateHarnessGrant } = require('../scripts/human-escalation');

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
