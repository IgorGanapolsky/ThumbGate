'use strict';

// Tamper-evident receipt ledger: hash chain, rule id and policy version (scripts/action-receipts.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-chain-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
const receipts = require('../scripts/action-receipts');

test.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function freshLedger(name) {
  const file = path.join(tmpDir, `${name}.jsonl`);
  fs.rmSync(file, { force: true });
  return file;
}

function writeChain(file, n) {
  const dir = path.dirname(file);
  const prev = process.env.THUMBGATE_FEEDBACK_DIR;
  // recordReceipt writes to FEEDBACK_DIR/action-receipts.jsonl; build there, then move.
  const scratch = fs.mkdtempSync(path.join(dir, 'w-'));
  process.env.THUMBGATE_FEEDBACK_DIR = scratch;
  const written = [];
  for (let i = 0; i < n; i += 1) written.push(receipts.recordReceipt({ actionId: `a${i}`, toolName: 'Bash', toolInput: { command: `echo ${i}` }, decision: i === 1 ? 'deny' : 'allow', ruleId: i === 1 ? 'no-force-push' : undefined }));
  fs.renameSync(path.join(scratch, 'action-receipts.jsonl'), file);
  process.env.THUMBGATE_FEEDBACK_DIR = prev;
  return written;
}

const lines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);

test('each receipt links to the one before it and records the rule and policy', () => {
  const file = freshLedger('linked');
  const written = writeChain(file, 3);
  assert.equal(written[0].prevHash, receipts.CHAIN_GENESIS);
  assert.equal(written[1].prevHash, written[0].entryHash);
  assert.deepEqual(written.map((r) => r.seq), [1, 2, 3]);
  assert.equal(written[1].ruleId, 'no-force-push');
  assert.equal(written[0].ruleId, null);
  assert.match(written[0].policy.policyHash, /^[0-9a-f]{64}$/);
  assert.ok(written[0].policy.gateCount > 0);
  assert.equal(written[0].policy.thumbgateVersion, require('../package.json').version);
  const result = receipts.verifyReceiptChain({ file });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.chained, 3);
  assert.equal(result.head, written[2].entryHash);
});

test('an edited receipt is caught', () => {
  const file = freshLedger('edited');
  writeChain(file, 3);
  const all = lines(file);
  const entry = JSON.parse(all[1]);
  entry.decision = 'allow';
  all[1] = JSON.stringify(entry);
  fs.writeFileSync(file, `${all.join('\n')}\n`);
  const result = receipts.verifyReceiptChain({ file });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((e) => [e.line, e.reason]), [[2, 'entry_edited']]);
});

test('a deleted or reordered receipt is caught', () => {
  const file = freshLedger('deleted');
  writeChain(file, 3);
  const all = lines(file);
  fs.writeFileSync(file, `${[all[0], all[2]].join('\n')}\n`);
  const deleted = receipts.verifyReceiptChain({ file });
  assert.equal(deleted.ok, false);
  assert.ok(deleted.errors.some((e) => e.line === 2 && e.reason === 'chain_broken'));

  fs.writeFileSync(file, `${[all[0], all[2], all[1]].join('\n')}\n`);
  assert.equal(receipts.verifyReceiptChain({ file }).ok, false);
});

test('a re-hashed forgery still breaks the link to the next entry', () => {
  const file = freshLedger('forged');
  writeChain(file, 3);
  const all = lines(file);
  const entry = JSON.parse(all[1]);
  entry.decision = 'allow';
  entry.entryHash = receipts.receiptEntryHash(entry);
  all[1] = JSON.stringify(entry);
  fs.writeFileSync(file, `${all.join('\n')}\n`);
  const result = receipts.verifyReceiptChain({ file });
  assert.deepEqual(result.errors.map((e) => [e.line, e.reason]), [[3, 'chain_broken']]);
});

test('an existing ledger from before the chain keeps working, and the chain links to its last line', () => {
  const prev = process.env.THUMBGATE_FEEDBACK_DIR;
  const dir = fs.mkdtempSync(path.join(tmpDir, 'legacy-'));
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  try {
    const file = receipts.getReceiptsPath();
    fs.writeFileSync(file, `${JSON.stringify({ actionId: 'old', toolName: 'Bash' })}\n`);
    const first = receipts.recordReceipt({ actionId: 'new', toolName: 'Bash' });
    assert.notEqual(first.prevHash, receipts.CHAIN_GENESIS);
    const result = receipts.verifyReceiptChain();
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.legacy, 1);
    assert.equal(result.chained, 1);
    assert.equal(receipts.getReceiptForAction('old').toolName, 'Bash');
  } finally { process.env.THUMBGATE_FEEDBACK_DIR = prev; }
});

test('thumbgate receipts verify exits 0 on an intact ledger and 1 on a tampered one', () => {
  const file = freshLedger('cli');
  writeChain(file, 2);
  const cli = path.join(__dirname, '..', 'bin', 'cli.js');
  const ok = spawnSync(process.execPath, [cli, 'receipts', 'verify', '--file', file], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /VALID/);
  const all = lines(file);
  fs.writeFileSync(file, `${all[1]}\n`);
  const bad = spawnSync(process.execPath, [cli, 'receipts', 'verify', '--file', file, '--json'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).ok, false);
});

test('a ledger that cannot be read fails verification; a missing one is empty and valid', () => {
  assert.equal(receipts.verifyReceiptChain({ file: path.join(tmpDir, 'absent.jsonl') }).ok, true);
  const dir = fs.mkdtempSync(path.join(tmpDir, 'is-a-dir-'));
  const result = receipts.verifyReceiptChain({ file: dir });
  assert.equal(result.ok, false);
  assert.match(result.errors[0].reason, /^unreadable/);
});

test('the policy hash follows the gates in force, with no stale cache', () => {
  const gatesFile = path.join(tmpDir, 'gates.json');
  const prev = process.env.THUMBGATE_GATES_CONFIG;
  try {
    process.env.THUMBGATE_GATES_CONFIG = gatesFile;
    fs.writeFileSync(gatesFile, JSON.stringify({ version: 1, gates: [{ id: 'a', pattern: 'x', action: 'block' }] }));
    const one = receipts.currentPolicyVersion();
    fs.writeFileSync(gatesFile, JSON.stringify({ version: 1, gates: [{ id: 'a', pattern: 'x', action: 'block' }, { id: 'b', pattern: 'y', action: 'warn' }] }));
    const two = receipts.currentPolicyVersion();
    assert.notEqual(one.policyHash, two.policyHash);
    assert.equal(two.gateCount - one.gateCount, 1);
  } finally {
    if (prev === undefined) delete process.env.THUMBGATE_GATES_CONFIG; else process.env.THUMBGATE_GATES_CONFIG = prev;
  }
});
