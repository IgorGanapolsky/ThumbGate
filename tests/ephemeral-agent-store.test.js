const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-eph-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const eph = require('../scripts/ephemeral-agent-store');

test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// === Ephemeral Store Creation ===
test('createEphemeralStore creates isolated namespace', () => {
  const store = eph.createEphemeralStore('agent-1');
  assert.equal(store.agentId, 'agent-1');
  assert.ok(fs.existsSync(store.storeDir));
  assert.ok(fs.existsSync(store.metaPath));
});

test('createEphemeralStore generates ID when none provided', () => {
  const store = eph.createEphemeralStore();
  assert.ok(store.agentId.startsWith('agent_'));
});

test('ephemeral store append writes to isolated path', () => {
  const store = eph.createEphemeralStore('writer-1');
  store.append({ signal: 'negative', context: 'test failure' });
  store.append({ signal: 'positive', context: 'test success' });
  assert.equal(store.count(), 2);
  const entries = store.read();
  assert.equal(entries.length, 2);
  assert.equal(entries[0]._ephemeralAgent, 'writer-1');
});

test('ephemeral stores are isolated from each other', () => {
  const s1 = eph.createEphemeralStore('iso-1');
  const s2 = eph.createEphemeralStore('iso-2');
  s1.append({ context: 'from s1' });
  s2.append({ context: 'from s2' });
  assert.equal(s1.read().length, 1);
  assert.equal(s2.read().length, 1);
  assert.ok(s1.read()[0].context.includes('s1'));
  assert.ok(s2.read()[0].context.includes('s2'));
});

// === List Stores ===
test('listEphemeralStores returns all stores', () => {
  const stores = eph.listEphemeralStores();
  assert.ok(stores.length >= 2);
  assert.ok(stores.some((s) => s.agentId === 'writer-1'));
});

// === Merge ===
test('mergeEphemeralStore merges entries to main log', () => {
  const store = eph.createEphemeralStore('merge-test');
  store.append({ signal: 'negative', context: 'merge entry 1', timestamp: new Date().toISOString() });
  store.append({ signal: 'positive', context: 'merge entry 2', timestamp: new Date().toISOString() });
  const result = eph.mergeEphemeralStore('merge-test');
  assert.equal(result.merged, 2);
  assert.equal(result.skipped, 0);
  // Check main log
  const mainLog = fs.readFileSync(path.join(tmpDir, 'feedback-log.jsonl'), 'utf-8');
  assert.ok(mainLog.includes('merge entry 1'));
});

test('mergeEphemeralStore marks store as merged', () => {
  const stores = eph.listEphemeralStores();
  const merged = stores.find((s) => s.agentId === 'merge-test');
  assert.equal(merged.status, 'merged');
  assert.ok(merged.mergedAt);
});

test('mergeEphemeralStore returns error for missing store', () => {
  const r = eph.mergeEphemeralStore('nonexistent');
  assert.ok(r.error);
});

test('mergeEphemeralStore skips PII entries', () => {
  const store = eph.createEphemeralStore('pii-test');
  store.append({ signal: 'negative', context: 'Card 4111111111111111 was charged', timestamp: new Date().toISOString() });
  store.append({ signal: 'positive', context: 'Clean entry', timestamp: new Date().toISOString() });
  const result = eph.mergeEphemeralStore('pii-test');
  assert.equal(result.skipped, 1);
  assert.equal(result.merged, 1);
});

// === Merge All ===
test('mergeAllEphemeralStores merges active stores', () => {
  const store = eph.createEphemeralStore('bulk-1');
  store.append({ context: 'bulk', timestamp: new Date().toISOString() });
  const result = eph.mergeAllEphemeralStores();
  assert.ok(result.stores >= 1);
  assert.ok(result.totalMerged >= 1);
});

// === Compaction ===
test('compactFeedbackLog removes old non-promoted entries', () => {
  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  const oldEntry = { id: 'old', timestamp: '2020-01-01T00:00:00Z', actionType: 'no-action' };
  const promotedEntry = { id: 'promoted', timestamp: '2020-01-01T00:00:00Z', actionType: 'store-mistake' };
  const recentEntry = { id: 'recent', timestamp: new Date().toISOString(), actionType: 'no-action' };
  fs.writeFileSync(logPath, [oldEntry, promotedEntry, recentEntry].map(JSON.stringify).join('\n') + '\n');
  const result = eph.compactFeedbackLog({ retentionDays: 90 });
  assert.equal(result.before, 3);
  assert.equal(result.removed, 1); // old non-promoted
  assert.equal(result.after, 2); // promoted + recent
});

test('compactFeedbackLog handles empty log', () => {
  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  fs.writeFileSync(logPath, '');
  const result = eph.compactFeedbackLog();
  assert.equal(result.before, 0);
  assert.equal(result.removed, 0);
});

test('compactFeedbackLog handles missing log', () => {
  fs.unlinkSync(path.join(tmpDir, 'feedback-log.jsonl'));
  const result = eph.compactFeedbackLog();
  assert.equal(result.before, 0);
});

// === Cleanup ===
test('cleanupEphemeralStores removes old merged stores', () => {
  // Create a store, merge it, backdate the mergedAt
  const store = eph.createEphemeralStore('cleanup-test');
  store.append({ context: 'x', timestamp: new Date().toISOString() });
  eph.mergeEphemeralStore('cleanup-test');
  // Backdate
  const metaPath = path.join(tmpDir, 'ephemeral', 'cleanup-test', 'meta.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  meta.mergedAt = '2020-01-01T00:00:00Z';
  fs.writeFileSync(metaPath, JSON.stringify(meta));
  const result = eph.cleanupEphemeralStores({ retentionDays: 1 });
  assert.equal(result.cleaned, 1);
  assert.ok(!fs.existsSync(path.join(tmpDir, 'ephemeral', 'cleanup-test')));
});

test('cleanupEphemeralStores preserves active stores', () => {
  const store = eph.createEphemeralStore('active-keep');
  store.append({ context: 'keep me' });
  const result = eph.cleanupEphemeralStores({ retentionDays: 1 });
  assert.ok(fs.existsSync(path.join(tmpDir, 'ephemeral', 'active-keep')));
});
