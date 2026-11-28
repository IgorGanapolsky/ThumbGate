'use strict';

// Tamper-evident receipt ledger: hash chain, rule id and policy version (scripts/action-receipts.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-chain-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
process.env.THUMBGATE_RECEIPT_LOCK_WAIT_MS = '300';
// No signing key unless a test makes one, whatever is in the real home directory.
process.env.THUMBGATE_RECEIPT_ED25519_KEY = path.join(tmpDir, 'no-key.pem');
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

test('a ledger that cannot be read fails verification; only a missing default ledger is empty and valid', () => {
  const missing = receipts.verifyReceiptChain({ file: path.join(tmpDir, 'absent.jsonl') });
  assert.equal(missing.ok, false, 'a file the caller named must exist');
  assert.equal(missing.errors[0].reason, 'missing');
  const prev = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = fs.mkdtempSync(path.join(tmpDir, 'fresh-'));
  try { assert.equal(receipts.verifyReceiptChain().ok, true); } finally { process.env.THUMBGATE_FEEDBACK_DIR = prev; }
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

test('a damaged line is reported even before the chain starts', () => {
  const file = freshLedger('damaged');
  fs.writeFileSync(file, '{"actionId":"x","tool\n');
  const result = receipts.verifyReceiptChain({ file });
  assert.deepEqual(result.errors.map((e) => e.reason), ['malformed']);
});

test('seq must start at 1 and go up by exactly one', () => {
  const file = freshLedger('seq');
  const zero = { actionId: 'z', seq: 0, prevHash: receipts.CHAIN_GENESIS };
  zero.entryHash = receipts.receiptEntryHash(zero);
  const jump = { actionId: 'j', seq: 8, prevHash: zero.entryHash };
  jump.entryHash = receipts.receiptEntryHash(jump);
  fs.writeFileSync(file, `${JSON.stringify(zero)}\n${JSON.stringify(jump)}\n`);
  assert.deepEqual(receipts.verifyReceiptChain({ file }).errors.map((e) => [e.line, e.reason]), [[1, 'seq_gap'], [2, 'seq_gap']]);
});

test('a lock left by a dead process is taken over; a lock held by a live one stops the write', () => {
  const prev = process.env.THUMBGATE_FEEDBACK_DIR;
  const dir = fs.mkdtempSync(path.join(tmpDir, 'lock-'));
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  try {
    const lock = `${receipts.getReceiptsPath()}.lock`;
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
    fs.writeFileSync(lock, `${dead}:old`);
    assert.equal(receipts.recordReceipt({ actionId: 'after-crash' }).recorded, true);
    assert.equal(fs.existsSync(lock), false, 'lock released after the write');

    fs.writeFileSync(lock, `${process.pid}:someone-else`);
    assert.throws(() => receipts.recordReceipt({ actionId: 'blocked' }), /locked by another writer/);
    assert.equal(fs.readFileSync(lock, 'utf8'), `${process.pid}:someone-else`, "another writer's lock is left alone");
    assert.equal(receipts.verifyReceiptChain().chained, 1, 'nothing appended without the lock');
  } finally { process.env.THUMBGATE_FEEDBACK_DIR = prev; }
});

test('stale-lock takeover never removes a live writer\'s lock', () => {
  const prev = process.env.THUMBGATE_FEEDBACK_DIR;
  const dir = fs.mkdtempSync(path.join(tmpDir, 'race-'));
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  try {
    const lock = `${receipts.getReceiptsPath()}.lock`;
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
    // Writer B saw the dead owner, but writer A already cleared it and took a fresh lock before B acted.
    fs.writeFileSync(lock, `${process.pid}:writer-a`);
    assert.equal(receipts.reclaimStaleLock(lock, `${dead}:old`, `${process.pid}:writer-b`), false);
    assert.equal(fs.readFileSync(lock, 'utf8'), `${process.pid}:writer-a`, "writer A's live lock survives");
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.reclaim')), [], 'reclaim guard released');

    // While another writer is mid-reclaim, nobody else may clear the stale lock.
    fs.writeFileSync(lock, `${dead}:old`);
    const guard = `${lock}.reclaim-${crypto.createHash('sha256').update(`${dead}:old`).digest('hex').slice(0, 16)}`;
    fs.writeFileSync(guard, `${process.pid}:writer-a`);
    assert.equal(receipts.reclaimStaleLock(lock, `${dead}:old`, `${process.pid}:writer-b`), false);
    assert.equal(fs.readFileSync(lock, 'utf8'), `${dead}:old`);
    assert.equal(fs.readFileSync(guard, 'utf8'), `${process.pid}:writer-a`, "a live reclaimer's guard is left alone");

    // A reclaimer that died holding the guard doesn't wedge the ledger: its guard is cleared, then the lock.
    fs.writeFileSync(guard, `${dead}:crashed-reclaimer`);
    assert.equal(receipts.recordReceipt({ actionId: 'after-reclaimer-crash' }).recorded, true);
    assert.equal(fs.existsSync(guard), false, 'dead guard cleared');
    assert.equal(fs.existsSync(lock), false, 'lock released after the write');

    // An old lock with no readable owner is never taken over by age.
    fs.writeFileSync(lock, '');
    const old = new Date(Date.now() - 3600 * 1000);
    fs.utimesSync(lock, old, old);
    assert.throws(() => receipts.recordReceipt({ actionId: 'empty-lock' }), /locked by another writer/);
    assert.equal(fs.existsSync(lock), true);
    assert.equal(receipts.verifyReceiptChain().chained, 1, 'nothing appended');
  } finally { process.env.THUMBGATE_FEEDBACK_DIR = prev; }
});

test('with an Ed25519 key, receipts are signed and anyone with the public key can check them', () => {
  const keyPath = path.join(tmpDir, 'signing.pem');
  process.env.THUMBGATE_RECEIPT_ED25519_KEY = keyPath;
  try {
    const key = receipts.generateEd25519Key();
    assert.equal(key.created, true);
    assert.equal(fs.statSync(keyPath).mode & 0o077, 0, 'private key is owner-only');
    const pub = path.join(tmpDir, 'public.pem');
    fs.writeFileSync(pub, key.publicKeyPem);

    const file = freshLedger('signed');
    const written = writeChain(file, 2);
    assert.equal(written[0].ed25519KeyId, key.keyId);
    assert.ok(written[0].ed25519Signature);
    const result = receipts.verifyReceiptChain({ file, publicKey: key.publicKeyPem, requireSigned: true });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.signed, 2);

    // A forger without the private key re-hashes an edited entry and re-links the chain: the signature fails.
    const all = lines(file);
    const forged = JSON.parse(all[1]);
    forged.decision = 'allow';
    forged.entryHash = receipts.receiptEntryHash(forged);
    all[1] = JSON.stringify(forged);
    fs.writeFileSync(file, `${all.join('\n')}\n`);
    const bad = receipts.verifyReceiptChain({ file, publicKey: key.publicKeyPem });
    assert.deepEqual(bad.errors.map((e) => e.reason), ['bad_signature']);

    // A different key is reported as such.
    const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
    assert.ok(receipts.verifyReceiptChain({ file, publicKey: other }).errors.some((e) => e.reason === 'signed_by_other_key'));

    const cli = path.join(__dirname, '..', 'bin', 'cli.js');
    const env = { ...process.env, THUMBGATE_RECEIPT_ED25519_KEY: keyPath };
    const shown = spawnSync(process.execPath, [cli, 'receipts', 'pubkey'], { encoding: 'utf8', env });
    assert.equal(shown.stdout, key.publicKeyPem);
    const cliBad = spawnSync(process.execPath, [cli, 'receipts', 'verify', '--file', file, '--pubkey', pub], { encoding: 'utf8', env });
    assert.equal(cliBad.status, 1);
    assert.match(cliBad.stdout, /bad_signature/);
  } finally {
    process.env.THUMBGATE_RECEIPT_ED25519_KEY = path.join(tmpDir, 'no-key.pem');
  }
});

test('--require-signed rejects unsigned receipts', () => {
  const file = freshLedger('unsigned');
  writeChain(file, 1);
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  assert.equal(receipts.verifyReceiptChain({ file, publicKey: pem }).ok, true);
  assert.deepEqual(receipts.verifyReceiptChain({ file, publicKey: pem, requireSigned: true }).errors.map((e) => e.reason), ['unsigned']);
});

test('--require-signed without a public key fails instead of passing unchecked', () => {
  const file = freshLedger('needs-key');
  writeChain(file, 1);
  assert.deepEqual(receipts.verifyReceiptChain({ file, requireSigned: true }).errors.map((e) => e.reason), ['public_key_required']);
  const cli = path.join(__dirname, '..', 'bin', 'cli.js');
  const run = spawnSync(process.execPath, [cli, 'receipts', 'verify', '--file', file, '--require-signed'], { encoding: 'utf8', env: { ...process.env } });
  assert.equal(run.status, 1, run.stdout + run.stderr);
});

test('a key created while the process runs is used for the next receipt', () => {
  const keyPath = path.join(tmpDir, 'late.pem');
  const prev = process.env.THUMBGATE_RECEIPT_ED25519_KEY;
  process.env.THUMBGATE_RECEIPT_ED25519_KEY = keyPath;
  try {
    assert.equal(receipts.loadEd25519Signer(), null);
    const key = receipts.generateEd25519Key();
    assert.equal(receipts.loadEd25519Signer().keyId, key.keyId);
  } finally { process.env.THUMBGATE_RECEIPT_ED25519_KEY = prev; }
});
