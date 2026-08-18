'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJSONL, generateDashboard, DEFAULT_JSONL_MAX_BYTES, DEFAULT_JSONL_MAX_ENTRIES } = require('../scripts/dashboard');

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

test('dashboard default JSONL budget is a four-megabyte recent tail', () => {
  assert.equal(DEFAULT_JSONL_MAX_BYTES, 4 * 1024 * 1024);
  assert.equal(DEFAULT_JSONL_MAX_ENTRIES, 20_000);
});

test('readJSONL default budget keeps recent evidence without parsing an oversized history', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-jsonl-default-bound-'));
  const file = path.join(dir, 'feedback-log.jsonl');
  const payload = 'x'.repeat(1024);
  const lines = [];
  for (let i = 0; i < 5_000; i += 1) {
    lines.push(JSON.stringify({ id: `e${i}`, payload }));
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`);

  const entries = readJSONL(file);

  assert.ok(entries.length > 0);
  assert.ok(entries.length < lines.length);
  assert.equal(entries.at(-1).id, 'e4999');
  assert.notEqual(entries[0].id, 'e0');
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

test('readJSONL returns empty array when read fails with string-limit style error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-jsonl-err-'));
  const file = path.join(dir, 'feedback-log.jsonl');
  fs.writeFileSync(file, `${JSON.stringify({ id: 'ok', signal: 'up' })}\n`);
  // Force a tiny maxBytes path through a missing-permission scenario by
  // replacing the file with a directory so stat/read throws.
  fs.rmSync(file);
  fs.mkdirSync(file);
  const entries = readJSONL(file);
  assert.deepEqual(entries, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('operational dashboard reports progress stages', async () => {
  const { getOperationalDashboard } = require('../scripts/operational-dashboard');
  const steps = [];
  const prev = process.env.THUMBGATE_METRICS_SOURCE;
  process.env.THUMBGATE_METRICS_SOURCE = 'local';
  try {
    const local = await getOperationalDashboard({
      window: 'today',
      timeZone: 'UTC',
      onProgress: (msg) => steps.push(msg),
    });
    assert.equal(local.source, 'local');
    assert.ok(steps.length >= 1);
    assert.ok(steps.some((s) => /local|Checking|Building/i.test(s)));
  } finally {
    if (prev === undefined) delete process.env.THUMBGATE_METRICS_SOURCE;
    else process.env.THUMBGATE_METRICS_SOURCE = prev;
  }
});

test('generateDashboard reuses bounded entries for analyzeFeedback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dash-reuse-'));
  const prevAgg = process.env.THUMBGATE_AGGREGATE_FEEDBACK;
  process.env.THUMBGATE_AGGREGATE_FEEDBACK = '1';
  try {
    const lines = [];
    for (let i = 0; i < 80; i += 1) {
      lines.push(JSON.stringify({
        id: `fb_${i}`,
        signal: i % 3 === 0 ? 'down' : 'up',
        feedback: i % 3 === 0 ? 'down' : 'up',
        context: `ctx ${i}`,
        timestamp: new Date(Date.UTC(2026, 5, 1, 12, 0, i % 60)).toISOString(),
      }));
    }
    fs.writeFileSync(path.join(dir, 'feedback-log.jsonl'), `${lines.join('\n')}\n`);
    const data = generateDashboard(dir, { analyticsWindow: { window: 'today', timeZone: 'UTC' } });
    assert.ok(data.feedbackAnalysis);
    assert.ok(Number(data.feedbackAnalysis.total) >= 0);
  } finally {
    if (prevAgg === undefined) delete process.env.THUMBGATE_AGGREGATE_FEEDBACK;
    else process.env.THUMBGATE_AGGREGATE_FEEDBACK = prevAgg;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('feedback-loop analyzeFeedback accepts preloaded entries without a full file scan', () => {
  const { analyzeFeedback } = require('../scripts/feedback-loop');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-analyze-bound-'));
  const file = path.join(dir, 'feedback-log.jsonl');
  const entries = [];
  for (let i = 0; i < 20; i += 1) {
    entries.push({
      id: `e${i}`,
      signal: i % 2 ? 'negative' : 'positive',
      feedback: i % 2 ? 'down' : 'up',
      context: `c${i}`,
      timestamp: new Date(Date.UTC(2026, 5, 1, 0, 0, i)).toISOString(),
    });
  }
  fs.writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  const analysis = analyzeFeedback(file, { entries, maxLines: 8 });
  assert.ok(analysis);
  assert.ok(Number(analysis.total) >= 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
