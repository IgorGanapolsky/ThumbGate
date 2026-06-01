'use strict';

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
  getReceiptForAction,
  getRecentReceipts,
  pairFeedbackWithReceipt,
  buildReceiptContextEntries,
  getReceiptsPath,
} = require('../scripts/action-receipts');

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
