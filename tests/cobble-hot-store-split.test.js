'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  PLANES,
  hashPartition,
  batchGetPrepared,
  selectHotSubset,
  auditTrace,
  detectCloneAttempt,
  buildCobbleHotStoreSplitReport,
  formatCobbleHotStoreSplitReport,
} = require('../scripts/cobble-hot-store-split');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'cobble-hot-store-split.js');
const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');
const GOLD = path.resolve(__dirname, 'fixtures', 'cobble-hot-store-split-gold.json');
const COUPLED = path.resolve(__dirname, 'fixtures', 'cobble-hot-store-split-coupled.json');

test('PLANES is the Cobble three-plane protocol', () => {
  assert.deepEqual([...PLANES], ['durable', 'delivery', 'hot']);
});

test('hashPartition is deterministic and bounded', () => {
  const a = hashPartition('lesson-1', 8);
  const b = hashPartition('lesson-1', 8);
  assert.equal(a, b);
  assert.ok(a >= 0 && a < 8);
  const spread = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => hashPartition(k, 8)));
  assert.ok(spread.size >= 2);
});

test('batchGetPrepared groups keys and hedges a slow primary', () => {
  const keyA = 'lesson-alpha';
  const partition = hashPartition(keyA, 8);
  const result = batchGetPrepared([keyA, 'missing-key'], {
    store: { [keyA]: { title: 'do not force-push main' } },
    partitionCount: 8,
    hedgeMs: 10,
    replicaLatencies: { [`${partition}:0`]: 40, [`${partition}:1`]: 4 },
  });
  assert.equal(result.found, 1);
  assert.deepEqual(result.missing, ['missing-key']);
  assert.ok(result.hedgedPartitions >= 1);
  const hit = result.records.find((r) => r.key === keyA);
  assert.equal(hit.found, true);
  assert.equal(hit.replica, 1);
  assert.equal(hit.hedged, true);
});

test('batchGetPrepared stays on the primary when it is fast', () => {
  const keyA = 'lesson-alpha';
  const partition = hashPartition(keyA, 8);
  const result = batchGetPrepared([keyA], {
    store: { [keyA]: { ok: true } },
    hedgeMs: 15,
    replicaLatencies: { [`${partition}:0`]: 3, [`${partition}:1`]: 40 },
  });
  assert.equal(result.hedgedPartitions, 0);
  assert.equal(result.records[0].replica, 0);
});

test('selectHotSubset drops raw and unmatchable records', () => {
  const subset = selectHotSubset([
    { id: 'keep', promoted: true, matchable: true },
    { id: 'raw', promoted: false },
    { id: 'blob', promoted: true, transportBlob: true },
    { id: 'vague', promoted: true, matchable: false },
  ], 'promoted_matchable');
  assert.deepEqual(subset.keys, ['keep']);
  assert.equal(subset.dropped, 3);
});

test('selectHotSubset unbounded keeps everything (audit will fail)', () => {
  const subset = selectHotSubset([{ id: 'a' }, { id: 'b' }], 'unbounded');
  assert.deepEqual(subset.keys, ['a', 'b']);
});

test('auditTrace accepts the gold three-plane fixture', () => {
  const gold = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
  assert.deepEqual(auditTrace(gold), []);
});

test('auditTrace fails coupled processing→hot, sequential reads, unbounded subset, overwrite, transactions', () => {
  const coupled = JSON.parse(fs.readFileSync(COUPLED, 'utf8'));
  const ids = auditTrace(coupled).map((f) => f.id);
  assert.ok(ids.includes('coupled_processing_hot_write'));
  assert.ok(ids.includes('sequential_hot_batch'));
  assert.ok(ids.includes('unbounded_hot_subset'));
  assert.ok(ids.includes('version_overwrite'));
  assert.ok(ids.includes('hot_transactions'));
});

test('auditTrace flags missing delivery when durable jumps to hot ingest', () => {
  const findings = auditTrace({
    writes: [
      { source: 'processing', plane: 'durable', keys: ['a'] },
      { source: 'ingest', plane: 'hot', keys: ['a'] },
    ],
    reads: [{ keys: ['a'], mode: 'batched', hedgeMs: 15 }],
    hotSubset: { policy: 'promoted_matchable' },
    transactionsOnHot: false,
  });
  assert.ok(findings.some((f) => f.id === 'missing_delivery_plane'));
});

test('detectCloneAttempt refuses CobbleDB / RocksDB / YTsaurus product clones', () => {
  const hits = detectCloneAttempt('clone CobbleDB and stand up a RocksDB cluster plus YTsaurus');
  assert.ok(hits.includes('cobbledb_sku') || hits.includes('rocksdb_cluster'));
});

test('default report is ready and maps three planes onto existing rails', () => {
  const report = buildCobbleHotStoreSplitReport({ root: path.resolve(__dirname, '..') });
  assert.equal(report.name, 'thumbgate-cobble-hot-store-split');
  assert.equal(report.status, 'ready');
  assert.equal(report.ok, true);
  assert.equal(report.compareNotClone, true);
  assert.equal(report.planes.length, 3);
  assert.ok(report.planes.some((p) => p.rails.some((r) => /lesson-retrieval/i.test(r))));
  assert.match(report.disclaimer, /Not affiliated/);
  assert.match(formatCobbleHotStoreSplitReport(report), /durable/);
});

test('report refuses clone attempts with status=fail', () => {
  const report = buildCobbleHotStoreSplitReport({
    task: 'clone cobbledb and replace dynamodb with cobble',
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.id === 'cobble_clone_refused'));
});

test('coupled fixture report fails closed', () => {
  const report = buildCobbleHotStoreSplitReport({ trace: COUPLED });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'coupled_processing_hot_write'));
});

test('map-only skips trace audit', () => {
  const report = buildCobbleHotStoreSplitReport({ map: true, trace: COUPLED });
  assert.equal(report.trace, null);
  assert.equal(report.map.length, 3);
  assert.ok(!report.findings.some((f) => f.id === 'coupled_processing_hot_write'));
});

test('script CLI --json exits 0 for gold default', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'ready');
  assert.equal(payload.ok, true);
});

test('script CLI fails on coupled fixture', () => {
  const result = spawnSync(process.execPath, [SCRIPT, `--trace=${COUPLED}`, '--json'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'fail');
});

test('thumbgate CLI cobble-hot-store-split is wired', () => {
  const result = spawnSync(process.execPath, [
    CLI,
    'cobble-hot-store-split',
    '--json',
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-cobble-hot-store-split');
  assert.equal(payload.planes.length, 3);
});

test('docs mention FORMAT steal without claiming a CobbleDB SKU', () => {
  const doc = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'agents', 'cobble-hot-store-split.md'),
    'utf8'
  );
  assert.match(doc, /cobble-hot-store-split|durable|delivery|hot/i);
  assert.match(doc, /not affiliated|compare-not-clone|do not clone/i);
  assert.doesNotMatch(doc, /npm install cobbledb|pip install cobbledb/i);
});
