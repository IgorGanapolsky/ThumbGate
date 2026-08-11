'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { clusterNearDupeMemories } = require('../scripts/memory-near-dupe');
const { compactMemoryStore, commitIfUnchanged } = require('../scripts/compact-memory-store');

let counter = 0;
function record(overrides = {}) {
  counter += 1;
  return {
    id: `mem_${counter}`,
    title: 'Deploy verification lesson',
    content: 'Always verify the deployment with a health probe before reporting success to the operator.',
    tags: ['negative', 'deploy'],
    signal: 'negative',
    importance: 'medium',
    occurrences: 1,
    timestamp: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

const BASE = 'Always verify the deployment with a health probe before reporting success to the operator.';

test('near-duplicate paraphrases merge into the newest record with summed occurrences', () => {
  const older = record({
    id: 'a',
    occurrences: 2,
    timestamp: '2026-08-01T10:00:00.000Z',
    content: `${BASE} attempt one`,
  });
  const newer = record({
    id: 'b',
    occurrences: 3,
    timestamp: '2026-08-02T10:00:00.000Z',
    content: `${BASE} attempt two`,
    tags: ['negative', 'railway'],
  });
  const { records, stats } = clusterNearDupeMemories([older, newer]);
  assert.equal(records.length, 1);
  assert.equal(stats.merged, 1);
  assert.equal(records[0].id, 'b');
  assert.equal(records[0].occurrences, 5);
  assert.deepEqual([...records[0].tags].sort(), ['deploy', 'negative', 'railway']);
});

test('identical records collapse to one', () => {
  const { records } = clusterNearDupeMemories([record({ id: 'x' }), record({ id: 'y' })]);
  assert.equal(records.length, 1);
});

test('opposite-signal lessons on the same topic never merge', () => {
  const neg = record({ id: 'neg' });
  const pos = record({ id: 'pos', signal: 'positive', tags: ['deploy'] });
  const { records } = clusterNearDupeMemories([neg, pos]);
  assert.equal(records.length, 2);
});

test('distinct topics stay separate', () => {
  const a = record({ id: 'a' });
  const b = record({
    id: 'b',
    title: 'Branch hygiene',
    content: 'Delete stale remote branches only after archiving unique orphan commits as tags.',
  });
  const { records } = clusterNearDupeMemories([a, b]);
  assert.equal(records.length, 2);
});

test('empty records are never used as a dedupe magnet', () => {
  const a = { id: 'e1', title: '', content: '', signal: 'negative' };
  const b = { id: 'e2', title: '', content: '', signal: 'negative' };
  const { records } = clusterNearDupeMemories([a, b]);
  assert.equal(records.length, 2);
});

test('a stricter threshold keeps paraphrases separate', () => {
  const a = record({ id: 'a', content: `${BASE} attempt one detail alpha` });
  const b = record({ id: 'b', content: `${BASE} attempt two detail beta` });
  const loose = clusterNearDupeMemories([a, b]);
  const strict = clusterNearDupeMemories([a, b], { similarityThreshold: 0.999 });
  assert.equal(loose.records.length, 1);
  assert.equal(strict.records.length, 2);
});

test('clustering is idempotent', () => {
  const input = [
    record({ id: 'a', content: `${BASE} attempt one` }),
    record({ id: 'b', content: `${BASE} attempt two` }),
    record({
      id: 'c',
      title: 'Branch hygiene',
      content: 'Delete stale remote branches only after archiving unique orphan commits as tags.',
    }),
  ];
  const first = clusterNearDupeMemories(input);
  const second = clusterNearDupeMemories(first.records);
  assert.equal(second.records.length, first.records.length);
  assert.equal(second.stats.merged, 0);
});

function seedLog(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-compact-'));
  const logPath = path.join(dir, 'memory-log.jsonl');
  fs.writeFileSync(logPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { dir, logPath };
}

function threeRows() {
  return [
    record({ id: 'a', content: `${BASE} attempt one` }),
    record({ id: 'b', content: `${BASE} attempt two` }),
    record({
      id: 'c',
      title: 'Branch hygiene',
      content: 'Delete stale remote branches only after archiving unique orphan commits as tags.',
    }),
  ];
}

test('compactMemoryStore dry-run reports without touching the log', () => {
  const { dir, logPath } = seedLog(threeRows());
  const original = fs.readFileSync(logPath, 'utf8');

  const report = compactMemoryStore({ dir });
  assert.equal(report.before, 3);
  assert.equal(report.after, 2);
  assert.equal(report.applied, false);
  assert.equal(fs.readFileSync(logPath, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(dir), ['memory-log.jsonl']);
});

test('compactMemoryStore apply writes a backup then the compacted log', () => {
  const { dir, logPath } = seedLog(threeRows());

  const report = compactMemoryStore({ dir, apply: true });
  assert.equal(report.applied, true);
  assert.ok(report.backupPath && fs.existsSync(report.backupPath), 'backup file must exist');
  const backupLines = fs.readFileSync(report.backupPath, 'utf8').trim().split('\n');
  assert.equal(backupLines.length, 3);
  const compacted = fs
    .readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(compacted.length, 2);
  const merged = compacted.find((r) => r.title === 'Deploy verification lesson');
  assert.equal(merged.occurrences, 2);
});

test('compactMemoryStore handles a missing log gracefully', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-compact-'));
  const report = compactMemoryStore({ dir });
  assert.equal(report.before, 0);
  assert.equal(report.after, 0);
  assert.equal(report.applied, false);
});

test('distinct structured-rule conditions never merge even with identical prose', () => {
  const mk = (id, cond) => record({ id, structuredRule: { trigger: { condition: cond } } });
  const { records } = clusterNearDupeMemories([
    mk('r1', 'renew lease before edits'),
    mk('r2', 'archive branch before delete'),
  ]);
  assert.equal(records.length, 2);
});

test('records sharing a structured-rule condition still merge newest-first', () => {
  const mk = (id, ts) => record({ id, timestamp: ts, structuredRule: { trigger: { condition: 'renew lease before edits' } } });
  const { records } = clusterNearDupeMemories([
    mk('r1', '2026-08-01T10:00:00.000Z'),
    mk('r2', '2026-08-02T10:00:00.000Z'),
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'r2');
  assert.equal(records[0].occurrences, 2);
});

test('legacy records hash-merge via the record object', () => {
  const mk = (id) => ({
    id,
    title: '',
    content: '',
    whatToChange: 'Renew the scope lease before continuing edits on shared repos.',
    signal: 'negative',
    timestamp: '2026-08-01T10:00:00.000Z',
  });
  const { records } = clusterNearDupeMemories([mk('h1'), mk('h2')]);
  assert.equal(records.length, 1);
});

test('commitIfUnchanged refuses to clobber a concurrent append', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-compact-'));
  const logPath = path.join(dir, 'memory-log.jsonl');
  fs.writeFileSync(logPath, 'line-one\n');
  const expectedRaw = fs.readFileSync(logPath, 'utf8');
  fs.appendFileSync(logPath, 'line-two\n');
  const backupPath = path.join(dir, 'backup.jsonl');
  const committed = commitIfUnchanged(logPath, expectedRaw, 'compacted\n', backupPath);
  assert.equal(committed, false);
  assert.equal(fs.readFileSync(logPath, 'utf8'), 'line-one\nline-two\n');
  assert.equal(fs.existsSync(backupPath), false);
});
