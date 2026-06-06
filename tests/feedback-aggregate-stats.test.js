'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  aggregateFeedbackStats,
  collectFeedbackLogPaths,
  readJSONL,
} = require('../scripts/feedback-aggregate-stats');

function writeLog(dir, entries) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'feedback-log.jsonl');
  fs.writeFileSync(p, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return p;
}

test('aggregateFeedbackStats sums across stores and dedupes by id', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-agg-'));
  const a = writeLog(path.join(tmp, 'a'), [
    { id: 'f1', signal: 'positive' },
    { id: 'f2', signal: 'negative' },
    { id: 'f3', signal: 'negative' },
  ]);
  const b = writeLog(path.join(tmp, 'b'), [
    { id: 'f2', signal: 'negative' }, // duplicate id -> counted once
    { id: 'f4', signal: 'positive' },
    { signal: 'negative' }, // no id -> still counted (can't dedupe)
    { id: 'f5', signal: 'neutral' }, // non-thumb signal -> ignored
  ]);

  const stats = aggregateFeedbackStats({ logPaths: [a, b] });
  assert.strictEqual(stats.totalPositive, 2); // f1, f4
  assert.strictEqual(stats.totalNegative, 3); // f2 (once), f3, anon-negative
  assert.strictEqual(stats.total, 5);
  assert.strictEqual(Math.round(stats.approvalRate * 100), 40);
  assert.strictEqual(stats.storeCount, 2);
});

test('aggregateFeedbackStats handles empty/missing logs', () => {
  const stats = aggregateFeedbackStats({ logPaths: ['/no/such/path/feedback-log.jsonl'] });
  assert.strictEqual(stats.total, 0);
  assert.strictEqual(stats.totalPositive, 0);
  assert.strictEqual(stats.totalNegative, 0);
  assert.strictEqual(stats.approvalRate, 0);
  assert.strictEqual(stats.storeCount, 0);
});

test('collectFeedbackLogPaths discovers global projects + extraDirs, deduped', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-home-'));
  fs.mkdirSync(path.join(tmpHome, '.thumbgate', 'projects', 'proj1'), { recursive: true });
  fs.mkdirSync(path.join(tmpHome, '.thumbgate', 'projects', 'proj2'), { recursive: true });
  const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-extra-'));

  const paths = collectFeedbackLogPaths({
    home: tmpHome,
    env: { HOME: tmpHome },
    cwd: extra,
    extraDirs: [extra],
  });

  assert.ok(paths.some((p) => p.endsWith(path.join('projects', 'proj1', 'feedback-log.jsonl'))));
  assert.ok(paths.some((p) => p.endsWith(path.join('projects', 'proj2', 'feedback-log.jsonl'))));
  assert.ok(paths.includes(path.resolve(path.join(extra, 'feedback-log.jsonl'))));
  assert.strictEqual(new Set(paths).size, paths.length, 'paths must be deduped');
});

test('readJSONL tolerates malformed trailing/partial lines', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-jsonl-'));
  const p = path.join(tmp, 'feedback-log.jsonl');
  fs.writeFileSync(p, '{"id":"x","signal":"positive"}\n{bad json here\n{"id":"y","signal":"negative"}\n');
  const rows = readJSONL(p);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].id, 'x');
  assert.strictEqual(rows[1].id, 'y');
});
