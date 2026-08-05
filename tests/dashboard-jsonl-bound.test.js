'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJSONL, generateDashboard } = require('../scripts/dashboard');

test('readJSONL tails oversized files instead of loading the whole file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-jsonl-bound-'));
  const file = path.join(dir, 'feedback-log.jsonl');
  // Write many lines so file exceeds a tiny maxBytes budget.
  const lines = [];
  for (let i = 0; i < 200; i += 1) {
    lines.push(JSON.stringify({ id: `e${i}`, signal: i % 2 ? 'down' : 'up', context: `x${i}`, timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }));
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  const all = readJSONL(file, { maxBytes: 10 * 1024 * 1024 });
  assert.ok(all.length >= 50);
  const tail = readJSONL(file, { maxBytes: 800, maxEntries: 20 });
  assert.ok(tail.length > 0);
  assert.ok(tail.length <= 20);
  // Last entry from full file should appear in a large enough tail read
  const fullLast = all[all.length - 1].id;
  const tailLarge = readJSONL(file, { maxBytes: 50_000, maxEntries: 50 });
  assert.equal(tailLarge[tailLarge.length - 1].id, fullLast);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('generateDashboard remains callable with oversized log paths (bounded read)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dash-bound-'));
  const lines = [];
  for (let i = 0; i < 500; i += 1) {
    lines.push(JSON.stringify({
      id: `fb_${i}`,
      signal: 'down',
      feedback: 'down',
      context: `agent mistake ${i}`,
      timestamp: new Date(Date.UTC(2026, 5, 1, 12, 0, i % 60)).toISOString(),
    }));
  }
  fs.writeFileSync(path.join(dir, 'feedback-log.jsonl'), `${lines.join('\n')}\n`);
  const data = generateDashboard(dir, { analyticsWindow: { window: 'today', timeZone: 'UTC' } });
  assert.ok(data);
  assert.ok(data.approval);
  assert.ok(data.gateStats);
  fs.rmSync(dir, { recursive: true, force: true });
});
