const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  computeChecksum,
  initWalSession,
  appendWalEntry,
  casCommitIndex,
  readWalEntries,
} = require('../src/git-wal-sync.js');

test('initWalSession sets up wal directory and initial index', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wal-test-'));
  try {
    const session = initWalSession(tmpDir);
    assert.ok(fs.existsSync(session.walDir));
    assert.strictEqual(session.index.seq, 0);
    assert.strictEqual(session.index.etag, 'e0');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('appendWalEntry and casCommitIndex perform atomic commit', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wal-test-'));
  try {
    const session = initWalSession(tmpDir);
    const mutation = {
      toolName: 'replace_file_content',
      filePath: 'src/main.js',
      operation: 'edit',
      diff: '+ const x = 1;',
    };

    const entry = appendWalEntry(session, mutation);
    assert.strictEqual(entry.seq, 1);
    assert.ok(entry.payloadChecksum);

    // Commit with expected prior seq = 0
    const res = casCommitIndex(session, 0, entry);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.currentSeq, 1);
    assert.strictEqual(res.etag, 'e1');

    // Conflicting commit with stale expected seq = 0 should fail
    const conflictRes = casCommitIndex(session, 0, entry);
    assert.strictEqual(conflictRes.ok, false);
    assert.strictEqual(conflictRes.currentSeq, 1);
    assert.match(conflictRes.error, /CAS Precondition Failed/);

    const entries = readWalEntries(session);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].filePath, 'src/main.js');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
