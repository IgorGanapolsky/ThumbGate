const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-contextfs-test-'));
process.env.RLHF_FEEDBACK_DIR = tmpFeedbackDir;

const {
  CONTEXTFS_ROOT,
  NAMESPACES,
  ensureContextFs,
  registerFeedback,
  registerPreventionRules,
  normalizeNamespaces,
  constructContextPack,
  evaluateContextPack,
  getProvenance,
  querySimilarity,
  loadMemexIndex,
  searchMemexIndex,
  dereferenceEntry,
  constructMemexPack,
} = require('../scripts/contextfs');

test.after(() => {
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
});

test('contextfs initializes required directories', () => {
  ensureContextFs();
  const required = Object.values(NAMESPACES).map((ns) => path.join(CONTEXTFS_ROOT, ns));
  required.forEach((dir) => assert.equal(fs.existsSync(dir), true));
});

test('register feedback and construct pack', () => {
  const feedbackEvent = {
    id: 'fb_test_1',
    signal: 'negative',
    context: 'Skipped verification on fix claim',
    tags: ['verification', 'testing'],
    actionType: 'store-mistake',
  };

  const memoryRecord = {
    title: 'MISTAKE: Skipped verification on fix claim',
    content: 'What went wrong: no tests\nHow to avoid: run tests before claim',
    category: 'error',
    tags: ['feedback', 'negative', 'verification'],
    sourceFeedbackId: 'fb_test_1',
  };

  const result = registerFeedback(feedbackEvent, memoryRecord);
  assert.ok(result.raw);
  assert.ok(result.memory);

  registerPreventionRules('# Prevention Rules\n\n- Always verify before claiming done.');

  const pack = constructContextPack({
    query: 'verification testing',
    maxItems: 5,
    maxChars: 5000,
  });

  assert.ok(pack.packId);
  assert.ok(pack.items.length >= 1);
  assert.equal(Object.prototype.hasOwnProperty.call(pack.items[0], 'filePath'), false);

  const evaluation = evaluateContextPack({
    packId: pack.packId,
    outcome: 'useful',
    signal: 'positive',
  });
  assert.equal(evaluation.packId, pack.packId);

  const provenance = getProvenance(20);
  assert.ok(provenance.length >= 1);
});

test('normalizeNamespaces rejects path traversal attempts', () => {
  assert.throws(() => normalizeNamespaces(['../..']), /Unsupported namespace/);
});

test('constructContextPack returns semantic cache hit on similar query', () => {
  const first = constructContextPack({
    query: 'verification testing evidence',
    maxItems: 4,
    maxChars: 3000,
  });

  const second = constructContextPack({
    query: 'testing verification evidence',
    maxItems: 4,
    maxChars: 3000,
  });

  assert.equal(first.cache.hit, false);
  assert.equal(second.cache.hit, true);
  assert.equal(second.cache.sourcePackId, first.packId);
});

test('querySimilarity computes jaccard overlap', () => {
  const score = querySimilarity(['a', 'b', 'c'], ['a', 'b', 'd']);
  assert.equal(score, 0.5);
});

/* ── Memex Indexed Memory Tests ────────────────────────────────── */

test('writeContextObject auto-indexes into memex', () => {
  const index = loadMemexIndex();
  assert.ok(index.length >= 1, 'index should have entries from earlier registerFeedback calls');
  const entry = index[0];
  assert.ok(entry.id, 'entry has id');
  assert.ok(entry.stableRef, 'entry has stableRef path');
  assert.ok(entry.title, 'entry has title');
  assert.ok(typeof entry.digest === 'string', 'entry has digest');
  assert.ok(entry.digest.length <= 120, 'digest is truncated');
});

test('dereferenceEntry loads full document from stableRef', () => {
  const index = loadMemexIndex();
  const entry = index.find((e) => e.stableRef);
  assert.ok(entry, 'need at least one indexed entry');
  const full = dereferenceEntry(entry);
  assert.ok(full, 'dereference should return document');
  assert.equal(full.id, entry.id);
  assert.ok(full.content.length >= entry.digest.length, 'full content >= digest');
});

test('dereferenceEntry returns null for missing file', () => {
  const result = dereferenceEntry({ stableRef: '/tmp/nonexistent-file.json' });
  assert.equal(result, null);
});

test('dereferenceEntry returns null for null input', () => {
  assert.equal(dereferenceEntry(null), null);
  assert.equal(dereferenceEntry({}), null);
});

test('searchMemexIndex returns ranked results without loading full content', () => {
  const results = searchMemexIndex({ query: 'verification testing' });
  assert.ok(Array.isArray(results));
  assert.ok(results.length >= 1);
  results.forEach((r) => {
    assert.ok(r.id, 'result has id');
    assert.ok(typeof r._score === 'number', 'result has score');
    assert.ok(!r.content, 'result should NOT have full content (index only)');
  });
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i]._score <= results[i - 1]._score, 'results sorted by score desc');
  }
});

test('searchMemexIndex filters by namespace', () => {
  const results = searchMemexIndex({
    query: 'verification',
    namespaces: ['memoryError'],
  });
  results.forEach((r) => {
    assert.ok(r.namespace.includes('memory/error'), 'should only return error namespace');
  });
});

test('constructMemexPack builds pack via index then dereference', () => {
  const pack = constructMemexPack({
    query: 'verification testing',
    maxItems: 5,
    maxChars: 5000,
  });
  assert.ok(pack.packId.startsWith('memex_'), 'packId starts with memex_');
  assert.ok(typeof pack.indexHits === 'number', 'has indexHits count');
  assert.ok(typeof pack.dereferencedCount === 'number', 'has dereferencedCount');
  assert.ok(pack.dereferencedCount <= pack.indexHits, 'dereferenced <= index hits');
  assert.ok(Array.isArray(pack.items));
  assert.ok(pack.usedChars <= pack.maxChars, 'respects char budget');
  pack.items.forEach((item) => {
    assert.ok(item.content, 'dereferenced items have full content');
  });
});

test('constructMemexPack respects maxChars budget', () => {
  const pack = constructMemexPack({
    query: 'verification testing rules prevention',
    maxItems: 100,
    maxChars: 50,
  });
  assert.ok(pack.usedChars <= 50, 'total chars within budget');
});
