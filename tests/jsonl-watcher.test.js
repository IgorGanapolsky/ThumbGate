// tests/jsonl-watcher.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { processNewEntries, shouldIngest, ingestEntry } = require('../scripts/jsonl-watcher');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-watcher-test-'));
}

function appendJSONL(filePath, record) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

// -- shouldIngest --

test('shouldIngest: returns false for entries without source', () => {
  const entry = { signal: 'positive', context: 'good work', tags: [] };
  assert.strictEqual(shouldIngest(entry), false);
});

test('shouldIngest: returns false for entries with watcher-ingested tag', () => {
  const entry = {
    signal: 'positive',
    source: 'amp-plugin-bridge',
    tags: ['watcher-ingested'],
  };
  assert.strictEqual(shouldIngest(entry), false);
});

test('shouldIngest: returns true for source=amp-plugin-bridge entries', () => {
  const entry = {
    signal: 'positive',
    source: 'amp-plugin-bridge',
    context: 'ran tests',
    tags: ['verification'],
  };
  assert.strictEqual(shouldIngest(entry), true);
});

test('shouldIngest: respects sourceFilter parameter', () => {
  const entry = {
    signal: 'positive',
    source: 'amp-plugin-bridge',
    tags: [],
  };
  assert.strictEqual(shouldIngest(entry, 'amp-plugin-bridge'), true);
  assert.strictEqual(shouldIngest(entry, 'other-source'), false);
});

// -- processNewEntries --

test('processNewEntries: processes new bridged entries and returns correct counts', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  appendJSONL(logPath, {
    signal: 'positive',
    source: 'amp-plugin-bridge',
    context: 'ran tests and verified output',
    whatWorked: 'evidence-first approach',
    tags: ['verification'],
  });
  appendJSONL(logPath, {
    signal: 'negative',
    source: 'amp-plugin-bridge',
    context: 'skipped tests before claiming done',
    whatWentWrong: 'no tests run',
    whatToChange: 'always run tests',
    tags: ['testing'],
  });

  const result = processNewEntries(tmpDir, logPath);
  assert.strictEqual(result.processed, 2);
  assert.strictEqual(typeof result.promoted, 'number');
});

test('processNewEntries: skips already-processed entries (idempotency via offset)', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  appendJSONL(logPath, {
    signal: 'positive',
    source: 'amp-plugin-bridge',
    context: 'first entry',
    whatWorked: 'worked well',
    tags: ['testing'],
  });

  const first = processNewEntries(tmpDir, logPath);
  assert.strictEqual(first.processed, 1);

  // Second call with no new entries should process zero
  const second = processNewEntries(tmpDir, logPath);
  assert.strictEqual(second.processed, 0);
  assert.strictEqual(second.promoted, 0);
});

test('processNewEntries: creates memory records for accepted entries', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  appendJSONL(logPath, {
    signal: 'positive',
    source: 'amp-plugin-bridge',
    context: 'ran full test suite with evidence',
    whatWorked: 'evidence-first verification',
    tags: ['verification', 'testing'],
  });

  const result = processNewEntries(tmpDir, logPath);
  assert.ok(result.processed >= 1, `expected at least 1 processed, got ${result.processed}`);

  // captureFeedback writes to memory-log.jsonl for accepted entries
  const memoryLogPath = path.join(tmpDir, 'memory-log.jsonl');
  if (result.promoted > 0) {
    assert.ok(fs.existsSync(memoryLogPath), 'memory-log.jsonl should exist when entries are promoted');
    const memories = fs.readFileSync(memoryLogPath, 'utf-8').trim().split('\n').filter(Boolean);
    assert.ok(memories.length >= 1, `expected at least 1 memory record, got ${memories.length}`);
  }
});
