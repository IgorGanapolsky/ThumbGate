// tests/billing-ledger-streaming.test.js
'use strict';

// The hosted billing summary was returning `revenue: { total: 0 }` because
// fs.readFileSync(path,'utf-8') threw "Cannot create a string longer than
// 0x1fffffe8 characters" on an unrotated ledger, and the caller caught it and
// rendered zeros. A crash presented as zero revenue is worse than an outage —
// it reads as a business fact.
//
// readJsonlRowsStreaming parses in fixed chunks so peak string size is one chunk
// plus one line. These tests drive it with a deliberately tiny chunk so nearly
// every row straddles a boundary — that is where an off-by-one would hide.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readJsonlRowsStreaming } = require('../scripts/billing');

function writeLedger(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ledger-'));
  const file = path.join(dir, 'revenue-events.jsonl');
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

test('streams every row when rows straddle chunk boundaries', () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ id: i, amount: i * 10, note: 'x'.repeat(50) }));
  const file = writeLedger(rows.map((r) => JSON.stringify(r)).concat(['']));

  // 64-byte chunks against ~90-byte rows: almost every row spans a boundary.
  const parsed = readJsonlRowsStreaming(file, { chunkBytes: 64 });

  assert.strictEqual(parsed.length, 500, 'no rows dropped at chunk seams');
  assert.deepStrictEqual(parsed[0], rows[0]);
  assert.deepStrictEqual(parsed[499], rows[499]);
  assert.strictEqual(
    parsed.reduce((sum, r) => sum + r.amount, 0),
    rows.reduce((sum, r) => sum + r.amount, 0),
    'totals must match exactly — this is a revenue ledger'
  );
});

test('matches the whole-file read it replaces', () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ id: i, amount: i }));
  const file = writeLedger(rows.map((r) => JSON.stringify(r)));

  const legacy = fs.readFileSync(file, 'utf-8')
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => JSON.parse(l));

  assert.deepStrictEqual(readJsonlRowsStreaming(file, { chunkBytes: 32 }), legacy);
});

test('parses a final row with no trailing newline', () => {
  const file = writeLedger(['{"id":1}', '{"id":2}']); // no trailing \n
  const parsed = readJsonlRowsStreaming(file, { chunkBytes: 8 });
  assert.deepStrictEqual(parsed, [{ id: 1 }, { id: 2 }]);
});

test('a malformed row does not invalidate the ledger', () => {
  const file = writeLedger(['{"id":1}', 'not json at all', '{"id":3}', '']);
  const parsed = readJsonlRowsStreaming(file, { chunkBytes: 16 });
  assert.deepStrictEqual(parsed, [{ id: 1 }, { id: 3 }], 'good rows survive a bad one');
});

test('missing file yields an empty ledger, not a throw', () => {
  assert.deepStrictEqual(readJsonlRowsStreaming('/nonexistent/ledger.jsonl'), []);
});

test('empty file yields an empty ledger', () => {
  const file = writeLedger([]);
  assert.deepStrictEqual(readJsonlRowsStreaming(file), []);
});

// --- Review finding on #3145 (chatgpt-codex-connector) ------------------------
// My first version called buffer.toString('utf8', 0, bytesRead) per chunk, which
// decodes each buffer independently. A multibyte character straddling a chunk
// boundary became replacement chars: {"id":"é"} read in 8-byte chunks decoded to
// {"id":"��"}. Silent data corruption in a revenue ledger. The original tests
// missed it because every fixture was ASCII.

test('preserves multibyte UTF-8 split across a chunk boundary', () => {
  const rows = [
    { id: 'é', customer: 'Café Ünïcode', amount: 100 },
    { id: '日本語', customer: 'Ω≈ç√', amount: 200 },
    { id: '🎉', customer: 'emoji is 4 bytes', amount: 300 },
  ];
  const file = writeLedger(rows.map((r) => JSON.stringify(r)));

  // 8-byte chunks guarantee multibyte sequences land mid-boundary.
  const parsed = readJsonlRowsStreaming(file, { chunkBytes: 8 });

  assert.deepStrictEqual(parsed, rows, 'characters must survive chunk seams intact');
  const flat = JSON.stringify(parsed);
  assert.ok(!flat.includes('�'), 'no U+FFFD replacement characters');
});

test('multibyte content matches the whole-file read it replaces', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ id: i, note: `naïve—“${i}” 日本 🎉` }));
  const file = writeLedger(rows.map((r) => JSON.stringify(r)));

  const legacy = fs.readFileSync(file, 'utf-8')
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => JSON.parse(l));

  assert.deepStrictEqual(readJsonlRowsStreaming(file, { chunkBytes: 16 }), legacy);
});
