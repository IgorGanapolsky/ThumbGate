const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-contextfs-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;

const {
  CONTEXTFS_ROOT,
  NAMESPACES,
  ensureContextFs,
  registerFeedback,
  registerPreventionRules,
  upsertContextObject,
  normalizeNamespaces,
  constructContextPack,
  evaluateContextPack,
  getProvenance,
  querySimilarity,
  loadMemexIndex,
  searchMemexIndex,
  dereferenceEntry,
  constructMemexPack,
  constructMultiHopPack,
  computeCoverage,
  pruneWeakChunks,
  refineQuery,
  MAX_HOPS,
  COVERAGE_THRESHOLD,
  PRUNE_SCORE_FLOOR,
} = require('../scripts/contextfs');
const contextfs = require('../scripts/contextfs');

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
  assert.equal(pack.visibility.itemCount, pack.items.length);
  assert.ok(pack.visibility.sourceCandidateCount >= pack.items.length);
  assert.deepEqual(
    pack.visibility.visibleTitles,
    pack.items.slice(0, 5).map((item) => item.title)
  );
  assert.equal(pack.visibility.hiddenCount, pack.visibility.sourceCandidateCount - pack.visibility.itemCount);
  assert.equal(pack.visibility.maxItemsHit, false);
  assert.equal(pack.visibility.maxCharsHit, false);
  assert.equal(pack.visibility.remainingCharBudget, pack.maxChars - pack.usedChars);

  const evaluation = evaluateContextPack({
    packId: pack.packId,
    outcome: 'useful',
    signal: 'positive',
  });
  assert.equal(evaluation.packId, pack.packId);

  const provenance = getProvenance(20);
  assert.ok(provenance.length >= 1);
});

test('registerFeedback dedupes exact feedback-memory repeats', () => {
  const feedbackEvent1 = {
    id: 'fb_dedupe_1',
    signal: 'positive',
    context: 'Used proof harness and verification logs',
    tags: ['verification', 'automation'],
    actionType: 'store-learning',
  };
  const feedbackEvent2 = {
    id: 'fb_dedupe_2',
    signal: 'positive',
    context: 'Used proof harness and verification logs',
    tags: ['verification', 'automation'],
    actionType: 'store-learning',
  };

  const memoryRecord = {
    title: 'SUCCESS: Used proof harness and verification logs',
    content: 'What worked: Used proof harness and verification logs\nRubric weighted score: 0.6\nRubric criteria passed with no blocking guardrails.',
    category: 'learning',
    tags: ['feedback', 'positive', 'verification', 'automation'],
    sourceFeedbackId: feedbackEvent1.id,
  };

  const first = registerFeedback(feedbackEvent1, memoryRecord);
  const beforeFiles = fs.readdirSync(path.join(CONTEXTFS_ROOT, NAMESPACES.memoryLearning)).length;
  const second = registerFeedback(feedbackEvent2, {
    ...memoryRecord,
    sourceFeedbackId: feedbackEvent2.id,
  });
  const afterFiles = fs.readdirSync(path.join(CONTEXTFS_ROOT, NAMESPACES.memoryLearning)).length;

  assert.ok(first.memory);
  assert.ok(second.memory);
  assert.equal(second.memory.deduped, true);
  assert.equal(first.memory.document.id, second.memory.document.id);
  assert.equal(afterFiles, beforeFiles);
});

test('upsertContextObject dedupes exact context objects and merges metadata', () => {
  const first = upsertContextObject({
    namespace: NAMESPACES.research,
    title: 'Paper: Rank Fusion',
    content: '# Rank Fusion\n\n## Abstract\n\nResearch summary.',
    tags: ['research', 'paper', 'hf-papers'],
    source: 'hf-papers',
    metadata: {
      paperId: '2603.01896',
      authors: ['Ada Lovelace'],
    },
  });

  const second = upsertContextObject({
    namespace: NAMESPACES.research,
    title: 'Paper: Rank Fusion',
    content: '# Rank Fusion\n\n## Abstract\n\nResearch summary.',
    tags: ['paper', 'hf-papers', 'research'],
    source: 'hf-papers',
    metadata: {
      paperId: '2603.01896',
      authors: ['Ada Lovelace', 'Alan Turing'],
    },
  });

  const researchFiles = fs.readdirSync(path.join(CONTEXTFS_ROOT, NAMESPACES.research))
    .filter((file) => file.endsWith('.json'));

  assert.equal(first.id, second.id);
  assert.equal(second.deduped, true);
  assert.deepEqual(second.document.metadata.authors, ['Ada Lovelace', 'Alan Turing']);
  assert.equal(researchFiles.length, 1);
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

test('contextfs root follows feedback dir changes after module load', () => {
  const previousFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const alternateFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-contextfs-switch-'));

  try {
    process.env.THUMBGATE_FEEDBACK_DIR = alternateFeedbackDir;
    contextfs.ensureContextFs();

    const dynamicRoot = path.join(alternateFeedbackDir, 'contextfs');
    assert.equal(contextfs.CONTEXTFS_ROOT, dynamicRoot);
    assert.equal(fs.existsSync(path.join(dynamicRoot, NAMESPACES.provenance)), true);
  } finally {
    if (previousFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = previousFeedbackDir;
    fs.rmSync(alternateFeedbackDir, { recursive: true, force: true });
  }
});

test('constructContextPack uses hierarchical retrieval for long-horizon memory namespaces', () => {
  upsertContextObject({
    namespace: NAMESPACES.memoryError,
    title: 'Verification miss before claiming done',
    content: 'Skipped tests before claiming done on checkout fix.',
    tags: ['verification', 'testing'],
    source: 'feedback-memory',
    metadata: {
      semanticKey: 'verification-miss',
      theme: 'verification',
    },
  });
  upsertContextObject({
    namespace: NAMESPACES.memoryError,
    title: 'Verification miss before claiming done',
    content: 'Skipped proof before claiming done on webhook fix.',
    tags: ['verification', 'testing'],
    source: 'feedback-memory',
    metadata: {
      semanticKey: 'verification-miss',
      theme: 'verification',
    },
  });
  upsertContextObject({
    namespace: NAMESPACES.memoryLearning,
    title: 'Railway deploy health drift',
    content: 'Verify deployment health and build SHA after Railway deploy.',
    tags: ['deployment', 'railway'],
    source: 'feedback-memory',
    metadata: {
      semanticKey: 'deploy-health',
      theme: 'deployment',
    },
  });

  const pack = constructContextPack({
    query: 'verification railway deploy',
    maxItems: 2,
    maxChars: 4000,
    namespaces: ['memoryError', 'memoryLearning'],
  });

  assert.equal(pack.retrieval.strategy, 'hierarchical');
  assert.deepEqual(pack.retrieval.selectedThemes.sort(), ['deployment', 'verification']);
  assert.equal(pack.items.length, 2);
});

test('constructContextPack keeps research-only namespaces on flat retrieval', () => {
  upsertContextObject({
    namespace: NAMESPACES.research,
    title: 'Paper: Retrieval by Decomposition',
    content: 'Semantic decomposition and hierarchical retrieval for agent memory.',
    tags: ['research', 'paper'],
    source: 'hf-papers',
  });

  const pack = constructContextPack({
    query: 'hierarchical retrieval',
    maxItems: 2,
    maxChars: 4000,
    namespaces: ['research'],
  });

  assert.equal(pack.retrieval.strategy, 'flat');
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
    assert.ok(item.structuredContext && item.structuredContext.rawContent !== undefined, 'dereferenced items have structured context');
  });
});

test('constructMemexPack respects maxChars budget', () => {
  registerFeedback(
    {
      id: 'fb_memex_budget',
      signal: 'negative',
      context: 'Need unique oversized readiness breadcrumb for memex budget test',
      tags: ['readiness', 'budget'],
      actionType: 'store-mistake',
    },
    {
      title: 'MISTAKE: Unique oversized readiness breadcrumb for memex budget test',
      content: 'What went wrong: oversized breadcrumb for memex budget test\nHow to avoid: keep readiness evidence scoped',
      category: 'error',
      tags: ['feedback', 'negative', 'readiness', 'budget'],
      sourceFeedbackId: 'fb_memex_budget',
    }
  );

  const pack = constructMemexPack({
    query: 'oversized readiness breadcrumb',
    maxItems: 5,
    maxChars: 10,
  });
  assert.ok(pack.usedChars <= 10, 'total chars within budget');
  assert.ok(pack.visibility.sourceCandidateCount >= 1);
  assert.equal(pack.visibility.maxCharsHit, true);
  assert.ok(pack.visibility.skippedByMaxChars >= 1);
});

// ---------------------------------------------------------------------------
// Multi-Hop Agentic Retrieval
// ---------------------------------------------------------------------------

test('computeCoverage returns 1 for empty query', () => {
  assert.equal(computeCoverage([], []), 1);
});

test('computeCoverage returns 0 when items have no matching tokens', () => {
  const cov = computeCoverage(['alpha', 'beta'], [
    { title: 'gamma delta', structuredContext: { rawContent: 'nothing here' }, tags: [] },
  ]);
  assert.equal(cov, 0);
});

test('computeCoverage returns fraction for partial match', () => {
  const cov = computeCoverage(['alpha', 'beta', 'gamma'], [
    { title: 'alpha gamma', structuredContext: { rawContent: '' }, tags: [] },
  ]);
  // 2 of 3 tokens covered (alpha is >2 chars, beta not found, gamma found)
  assert.ok(cov > 0.5, `expected > 0.5, got ${cov}`);
  assert.ok(cov < 1, `expected < 1, got ${cov}`);
});

test('pruneWeakChunks drops items below score floor', () => {
  const items = [
    { title: 'alpha beta test', structuredContext: { rawContent: 'verification testing' }, tags: ['test'], namespace: 'memory/error' },
    { title: 'unrelated content', structuredContext: { rawContent: 'no match here' }, tags: [], namespace: 'rules' },
  ];
  const result = pruneWeakChunks(items, ['alpha', 'beta', 'test']);
  assert.ok(result.length >= 1, 'should keep at least the matching item');
  assert.ok(result.every((i) => i.score >= PRUNE_SCORE_FLOOR), 'all survivors should be above floor');
});

test('pruneWeakChunks returns items sorted by score descending', () => {
  const items = [
    { title: 'weak', structuredContext: { rawContent: 'testing' }, tags: [], namespace: '' },
    { title: 'strong testing verification alpha beta', structuredContext: { rawContent: 'testing alpha beta' }, tags: ['testing'], namespace: 'memory/error' },
  ];
  const result = pruneWeakChunks(items, ['testing', 'alpha', 'beta']);
  if (result.length > 1) {
    assert.ok(result[0].score >= result[1].score, 'should be sorted by score desc');
  }
});

test('refineQuery adds expansion tokens from items', () => {
  const original = ['testing', 'error'];
  const items = [
    { title: 'verification deployment pipeline', tags: ['deployment'] },
  ];
  const refined = refineQuery(original, items);
  assert.ok(refined.length > original.length, 'should add expansion tokens');
  assert.ok(refined.includes('testing'), 'should keep original tokens');
  assert.ok(refined.includes('error'), 'should keep original tokens');
});

test('refineQuery limits expansion to 3 terms', () => {
  const original = ['bug'];
  const items = [
    { title: 'alpha beta gamma delta epsilon zeta eta theta', tags: ['one', 'two', 'three', 'four'] },
  ];
  const refined = refineQuery(original, items);
  // original (1) + up to 3 expansion = max 4
  assert.ok(refined.length <= 4, `expected <= 4, got ${refined.length}`);
});

test('constructMultiHopPack returns pack with hop metadata', () => {
  ensureContextFs();
  // Seed some data
  upsertContextObject({
    namespace: NAMESPACES.memoryError,
    title: 'MISTAKE: deployment failed without tests',
    content: 'Deployed without running verification tests',
    tags: ['deployment', 'testing'],
    source: 'test',
  });
  upsertContextObject({
    namespace: NAMESPACES.memoryLearning,
    title: 'SUCCESS: always verify before deploy',
    content: 'Run full test suite before deployment',
    tags: ['deployment', 'verification'],
    source: 'test',
  });

  const pack = constructMultiHopPack({
    query: 'deployment testing verification',
    maxItems: 8,
    maxChars: 6000,
  });

  assert.ok(pack.packId.startsWith('mhop_'), 'packId should start with mhop_');
  assert.ok(Array.isArray(pack.items), 'should have items array');
  assert.ok(pack.items.length > 0, 'should find items');
  assert.equal(pack.retrieval.strategy, 'multi-hop');
  assert.ok(Array.isArray(pack.retrieval.hops), 'should have hop log');
  assert.ok(pack.retrieval.hops.length >= 1, 'should have at least 1 hop');
  assert.ok(pack.retrieval.hops[0].coverage >= 0, 'hop should report coverage');
  assert.ok(pack.retrieval.finalCoverage >= 0, 'should report final coverage');
});

test('constructMultiHopPack respects maxChars budget', () => {
  const pack = constructMultiHopPack({
    query: 'deployment testing',
    maxItems: 50,
    maxChars: 100,
  });
  assert.ok(pack.usedChars <= 100, `usedChars ${pack.usedChars} should be <= 100`);
});

test('constructMultiHopPack stops early when coverage is sufficient', () => {
  const pack = constructMultiHopPack({
    query: 'deployment',
    maxItems: 20,
    maxChars: 20000,
    maxHops: 5,
  });
  // Should stop before maxHops if coverage is met
  assert.ok(pack.retrieval.totalHops <= 5, 'should not exceed maxHops');
});

test('MAX_HOPS, COVERAGE_THRESHOLD, PRUNE_SCORE_FLOOR are exported constants', () => {
  assert.ok(MAX_HOPS > 0);
  assert.ok(COVERAGE_THRESHOLD > 0 && COVERAGE_THRESHOLD <= 1);
  assert.ok(PRUNE_SCORE_FLOOR >= 0);
});
