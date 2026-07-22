'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJsonlSinceTail } = require('../scripts/jsonl-window');

test('readJsonlSinceTail returns recent rows without full-file load', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-jsonl-'));
  const file = path.join(dir, 'events.jsonl');
  const now = Date.now();
  const lines = [];
  for (let i = 0; i < 50; i += 1) {
    lines.push(JSON.stringify({
      timestamp: new Date(now - (50 - i) * 1000).toISOString(),
      i,
    }));
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`);

  const sinceMs = now - 10_000;
  const result = readJsonlSinceTail(file, { sinceMs, limit: 5 });
  assert.ok(result.rows.length <= 5);
  assert.ok(result.totalAfterSince >= result.rows.length);
  assert.equal(result.rows[result.rows.length - 1].i, 49);
});

test('readJsonlSinceTail handles missing file', () => {
  const result = readJsonlSinceTail('/tmp/definitely-missing-thumbgate-jsonl.jsonl', { limit: 10 });
  assert.deepEqual(result.rows, []);
  assert.equal(result.totalAfterSince, 0);
});

test('readJsonlSinceTail excludes rows without parseable timestamps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-jsonl-bad-'));
  const file = path.join(dir, 'events.jsonl');
  const now = Date.now();
  const lines = [
    JSON.stringify({ timestamp: new Date(now - 1000).toISOString(), i: 1 }),
    JSON.stringify({ noTimestamp: true, i: 2 }),
    JSON.stringify({ timestamp: 'not-a-date', i: 3 }),
    JSON.stringify({ timestamp: new Date(now).toISOString(), i: 4 }),
  ];
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  const result = readJsonlSinceTail(file, { sinceMs: now - 5000, limit: 50 });
  assert.equal(result.rows.some((r) => r.i === 2), false);
  assert.equal(result.rows.some((r) => r.i === 3), false);
  assert.equal(result.rows.some((r) => r.i === 1), true);
  assert.equal(result.rows.some((r) => r.i === 4), true);
});

