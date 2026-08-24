'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  initGraphDB,
  upsertNode,
  addEdge,
  registerLesson,
  resolveCurrentId,
  getLineage,
  isSuppressed,
  getNode,
  extractCorrectionTarget,
  annotateAndFilterLessons,
} = require('../scripts/lesson-graph');
const {
  buildPlan,
  applyPlan,
} = require('../scripts/migrate-lesson-graph');
const {
  retrieveRelevantLessons,
  applyGraphResolution,
  calculateRetrievalEntropy,
} = require('../scripts/lesson-retrieval');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function openTmpGraph(dir) {
  return initGraphDB(path.join(dir, 'lesson-graph.sqlite'));
}

function writeJsonl(filePath, records) {
  fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// extractCorrectionTarget
// ---------------------------------------------------------------------------

test('extractCorrectionTarget - direct id reference', () => {
  const result = extractCorrectionTarget('CORRECTION to fb_1780576602939_7yfrsi (2026-06-04 rescue). It was jetsam.');
  assert.deepEqual(result, { edgeType: 'supersedes', targetRef: 'fb_1780576602939_7yfrsi' });
});

test('extractCorrectionTarget - parenthesized truncated id after prose', () => {
  const result = extractCorrectionTarget('REFINEMENT to the 2026-06-04 fix (fb_1780589059204). Second re-check confirmed.');
  assert.deepEqual(result, { edgeType: 'refines', targetRef: 'fb_1780589059204' });
});

test('extractCorrectionTarget - no marker returns null', () => {
  assert.equal(extractCorrectionTarget('A normal lesson about mem_123_abc with no marker'), null);
});

// ---------------------------------------------------------------------------
// Ingest-time dedup
// ---------------------------------------------------------------------------

test('registerLesson - near-duplicate increments canonical count instead of new fact', () => {
  const dir = tmpDir('tg-graph-dedup-');
  const db = openTmpGraph(dir);

  const first = registerLesson(db, {
    id: 'mem_1_aaa',
    title: 'MISTAKE: Never force push to the main branch during release',
    content: 'What went wrong: force pushed to main during release window.',
    tags: ['negative'],
    timestamp: '2026-08-01T10:00:00.000Z',
  });
  assert.equal(first.status, 'new');

  // Cosmetic rewording of the same lesson.
  const second = registerLesson(db, {
    id: 'mem_2_bbb',
    title: 'MISTAKE: never force-push to the main branch during a release!!',
    content: 'What went wrong: force-pushed to main during the release window.',
    tags: ['negative'],
    timestamp: '2026-08-02T10:00:00.000Z',
  });
  assert.equal(second.status, 'duplicate');
  assert.equal(second.canonicalId, 'mem_1_aaa');
  assert.equal(second.duplicateCount, 2);

  const canonical = getNode(db, 'mem_1_aaa');
  assert.equal(canonical.duplicate_count, 2);
  assert.equal(canonical.valid_to, null, 'canonical stays current');

  const dupNode = getNode(db, 'mem_2_bbb');
  assert.equal(dupNode.canonical_id, 'mem_1_aaa');
  assert.ok(dupNode.valid_to, 'duplicate row is closed');

  // A genuinely different lesson is NOT collapsed.
  const third = registerLesson(db, {
    id: 'mem_3_ccc',
    title: 'MISTAKE: Deployed to production without running the smoke tests first',
    content: 'What went wrong: skipped smoke tests entirely.',
    tags: ['negative'],
    timestamp: '2026-08-03T10:00:00.000Z',
  });
  assert.equal(third.status, 'new');
  db.close();
});

test('registerLesson - correction marker creates supersedes edge and closes target', () => {
  const dir = tmpDir('tg-graph-corr-');
  const db = openTmpGraph(dir);

  registerLesson(db, {
    id: 'mem_orig_x1',
    sourceFeedbackId: 'fb_1780576602939_7yfrsi',
    title: 'MISTAKE: Blamed the wrong process for the freeze incident',
    content: 'What went wrong: misattributed root cause.',
    tags: ['negative'],
    timestamp: '2026-06-04T10:00:00.000Z',
  });

  // References the ORIGINAL by truncated feedback id — prefix resolution.
  const correction = registerLesson(db, {
    id: 'mem_corr_x2',
    title: 'CORRECTION to fb_1780576602939 (freeze incident). Real cause was jetsam memory pressure.',
    content: 'Re-check showed jetsam SIGKILL under memory pressure.',
    tags: ['positive'],
    timestamp: '2026-06-05T10:00:00.000Z',
  });
  assert.equal(correction.status, 'superseding');
  assert.equal(correction.targetId, 'mem_orig_x1');

  assert.ok(getNode(db, 'mem_orig_x1').valid_to, 'superseded lesson valid_to closed');
  assert.equal(getNode(db, 'mem_corr_x2').valid_to, null);
  db.close();
});

// ---------------------------------------------------------------------------
// Supersession traversal
// ---------------------------------------------------------------------------

test('resolveCurrentId - walks CORRECTION then REFINEMENT to the current fact', () => {
  const dir = tmpDir('tg-graph-chain-');
  const db = openTmpGraph(dir);

  upsertNode(db, { id: 'mem_a', title: 'original', signal: 'negative', validFrom: '2026-06-04T00:00:00Z', ingestedAt: '2026-06-04T00:00:00Z' });
  upsertNode(db, { id: 'mem_b', title: 'correction', signal: 'negative', validFrom: '2026-06-05T00:00:00Z', ingestedAt: '2026-06-05T00:00:00Z' });
  upsertNode(db, { id: 'mem_c', title: 'refinement', signal: 'negative', validFrom: '2026-06-06T00:00:00Z', ingestedAt: '2026-06-06T00:00:00Z' });
  addEdge(db, { src: 'mem_b', dst: 'mem_a', type: 'supersedes', validFrom: '2026-06-05T00:00:00Z' });
  addEdge(db, { src: 'mem_c', dst: 'mem_b', type: 'refines', validFrom: '2026-06-06T00:00:00Z' });

  const fromOriginal = resolveCurrentId(db, 'mem_a');
  assert.equal(fromOriginal.id, 'mem_c');
  assert.deepEqual(fromOriginal.path, ['mem_a', 'mem_b', 'mem_c']);

  assert.equal(resolveCurrentId(db, 'mem_b').id, 'mem_c');
  assert.equal(resolveCurrentId(db, 'mem_c').id, 'mem_c');

  assert.equal(isSuppressed(db, 'mem_a'), true);
  assert.equal(isSuppressed(db, 'mem_b'), true);
  assert.equal(isSuppressed(db, 'mem_c'), false);

  const lineage = getLineage(db, 'mem_a');
  assert.equal(lineage.currentId, 'mem_c');
  assert.deepEqual(lineage.steps.map((s) => s.type), ['supersedes', 'refines']);
  db.close();
});

test('resolveCurrentId - cycle-safe', () => {
  const dir = tmpDir('tg-graph-cycle-');
  const db = openTmpGraph(dir);
  upsertNode(db, { id: 'mem_p', title: 'p', signal: 'negative', validFrom: '2026-01-01T00:00:00Z', ingestedAt: '2026-01-01T00:00:00Z' });
  upsertNode(db, { id: 'mem_q', title: 'q', signal: 'negative', validFrom: '2026-01-02T00:00:00Z', ingestedAt: '2026-01-02T00:00:00Z' });
  addEdge(db, { src: 'mem_q', dst: 'mem_p', type: 'supersedes', validFrom: '2026-01-02T00:00:00Z' });
  addEdge(db, { src: 'mem_p', dst: 'mem_q', type: 'supersedes', validFrom: '2026-01-03T00:00:00Z' });
  const resolved = resolveCurrentId(db, 'mem_p');
  assert.ok(['mem_p', 'mem_q'].includes(resolved.id), 'terminates on a chain member');
  db.close();
});

// ---------------------------------------------------------------------------
// Retrieval filtering
// ---------------------------------------------------------------------------

test('annotateAndFilterLessons - collapses a retrieved correction chain to one current fact with a lineage note', () => {
  const dir = tmpDir('tg-graph-annot-');
  const db = openTmpGraph(dir);

  upsertNode(db, { id: 'mem_old', title: 'MISTAKE: wrong diagnosis', signal: 'negative', validFrom: '2026-06-04T00:00:00Z', ingestedAt: '2026-06-04T00:00:00Z' });
  upsertNode(db, { id: 'mem_new', title: 'CORRECTION: real cause found', signal: 'negative', validFrom: '2026-06-05T00:00:00Z', ingestedAt: '2026-06-05T00:00:00Z' });
  addEdge(db, { src: 'mem_new', dst: 'mem_old', type: 'supersedes', validFrom: '2026-06-05T00:00:00Z' });

  const retrieved = [
    { id: 'mem_old', title: 'MISTAKE: wrong diagnosis', content: 'stale', signal: 'negative', timestamp: '2026-06-04T00:00:00Z', relevanceScore: 0.9 },
    { id: 'mem_new', title: 'CORRECTION: real cause found', content: 'current', signal: 'negative', timestamp: '2026-06-05T00:00:00Z', relevanceScore: 0.85 },
  ];
  const result = annotateAndFilterLessons(db, retrieved);
  assert.equal(result.length, 1, 'chain collapsed to one lesson');
  assert.equal(result[0].id, 'mem_new');
  assert.ok(result[0].lessonGraph.lineageNote.includes('mem_old → mem_new'));

  // Entropy of the collapsed result is 0 (single signal, single record) —
  // the mixed-signal sibling pair no longer trips the conflict threshold.
  assert.equal(calculateRetrievalEntropy(result), 0);
  db.close();
});

test('annotateAndFilterLessons - substitutes the current fact when only the stale lesson was retrieved', () => {
  const dir = tmpDir('tg-graph-subst-');
  const db = openTmpGraph(dir);

  upsertNode(db, { id: 'mem_old2', title: 'old advice', signal: 'negative', validFrom: '2026-06-01T00:00:00Z', ingestedAt: '2026-06-01T00:00:00Z' });
  upsertNode(db, { id: 'mem_new2', title: 'new advice', signal: 'negative', validFrom: '2026-06-02T00:00:00Z', ingestedAt: '2026-06-02T00:00:00Z' });
  addEdge(db, { src: 'mem_new2', dst: 'mem_old2', type: 'supersedes', validFrom: '2026-06-02T00:00:00Z' });

  const lookup = new Map([
    ['mem_new2', { id: 'mem_new2', title: 'new advice', content: 'How to avoid: use the new runbook.', timestamp: '2026-06-02T00:00:00Z', tags: ['negative'] }],
  ]);
  const result = annotateAndFilterLessons(
    db,
    [{ id: 'mem_old2', title: 'old advice', content: 'obsolete runbook', signal: 'negative', timestamp: '2026-06-01T00:00:00Z', relevanceScore: 0.7 }],
    { lookup },
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'mem_new2');
  assert.equal(result[0].content, 'How to avoid: use the new runbook.');
  assert.ok(result[0].lessonGraph.lineageNote);
  db.close();
});

test('annotateAndFilterLessons - contradicts pair keeps newer valid lesson with a one-line note', () => {
  const dir = tmpDir('tg-graph-conflict-');
  const db = openTmpGraph(dir);

  upsertNode(db, { id: 'mem_yes', title: 'approach works', signal: 'positive', validFrom: '2026-07-01T00:00:00Z', ingestedAt: '2026-07-01T00:00:00Z' });
  upsertNode(db, { id: 'mem_no', title: 'approach fails', signal: 'negative', validFrom: '2026-07-02T00:00:00Z', ingestedAt: '2026-07-02T00:00:00Z' });
  addEdge(db, { src: 'mem_no', dst: 'mem_yes', type: 'contradicts', validFrom: '2026-07-02T00:00:00Z' });

  const result = annotateAndFilterLessons(db, [
    { id: 'mem_yes', title: 'approach works', content: 'a', signal: 'positive', timestamp: '2026-07-01T00:00:00Z', relevanceScore: 0.8 },
    { id: 'mem_no', title: 'approach fails', content: 'b', signal: 'negative', timestamp: '2026-07-02T00:00:00Z', relevanceScore: 0.75 },
  ]);
  assert.equal(result.length, 1, 'only the newer side of the contradiction survives');
  assert.equal(result[0].id, 'mem_no');
  const note = result[0].lessonGraph.conflictNote;
  assert.ok(note.includes('mem_yes') && note.includes('newer lesson kept'));
  assert.equal(note.split('\n').length, 1, 'conflict is exactly one line');
  db.close();
});

test('applyGraphResolution - no graph DB present is a transparent no-op', () => {
  const dir = tmpDir('tg-graph-nodb-');
  const lessons = [{ id: 'mem_z', title: 't', content: 'c', signal: 'negative', timestamp: '2026-01-01T00:00:00Z' }];
  const result = applyGraphResolution(lessons, { feedbackDir: dir });
  assert.deepEqual(result, lessons);
});

test('retrieveRelevantLessons - end-to-end: superseded chain member is suppressed from hook retrieval', () => {
  const dir = tmpDir('tg-graph-e2e-');
  const memories = [
    {
      id: 'mem_freeze_orig',
      title: 'MISTAKE: mac mini freeze rescue attributed the freeze to the wrong daemon process',
      content: 'What went wrong: mac mini freeze rescue misread the load average evidence.\nHow to avoid: re-check live process table before naming a culprit.',
      category: 'error',
      tags: ['feedback', 'negative'],
      timestamp: '2026-06-04T10:00:00.000Z',
    },
    {
      id: 'mem_freeze_corr',
      title: 'CORRECTION to mem_freeze_orig (mac mini freeze rescue). Real cause was jetsam memory pressure killing agents',
      content: 'What went wrong: first diagnosis was wrong.\nHow to avoid: for mac mini freeze rescue always check jetsam and memory pressure first.',
      category: 'error',
      tags: ['feedback', 'negative'],
      timestamp: '2026-06-05T10:00:00.000Z',
    },
  ];
  writeJsonl(path.join(dir, 'memory-log.jsonl'), memories);
  writeJsonl(path.join(dir, 'feedback-log.jsonl'), []);

  const plan = buildPlan(dir);
  applyPlan(plan, path.join(dir, 'lesson-graph.sqlite'));

  const results = retrieveRelevantLessons(
    'Bash',
    'mac mini freeze rescue load average daemon process',
    { feedbackDir: dir, maxResults: 3 },
  );
  const ids = results.map((r) => r.id);
  assert.ok(ids.includes('mem_freeze_corr'), 'current fact retrieved: ' + JSON.stringify(ids));
  assert.ok(!ids.includes('mem_freeze_orig'), 'superseded original suppressed: ' + JSON.stringify(ids));
  const current = results.find((r) => r.id === 'mem_freeze_corr');
  assert.ok(current.graph && current.graph.lineageNote, 'lineage note attached');
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

function migrationFixture(dir) {
  const memories = [
    {
      id: 'mem_dup_1',
      title: 'MISTAKE: repeated capture fallback pattern recorded from history sync',
      content: 'What went wrong: repeated capture fallback pattern recorded from history sync.',
      tags: ['negative'],
      timestamp: '2026-07-01T00:00:00.000Z',
      occurrences: 2,
    },
    {
      id: 'mem_dup_2',
      title: 'MISTAKE: repeated capture fallback pattern recorded from history sync!',
      content: 'What went wrong: repeated capture fallback pattern recorded from history sync.',
      tags: ['negative'],
      timestamp: '2026-07-02T00:00:00.000Z',
    },
    {
      id: 'mem_dup_3',
      title: 'MISTAKE: Repeated capture fallback patterns recorded from history sync',
      content: 'What went wrong: repeated capture fallback pattern recorded from history sync.',
      tags: ['negative'],
      timestamp: '2026-07-03T00:00:00.000Z',
    },
    {
      id: 'mem_chain_orig',
      sourceFeedbackId: 'fb_9990001112223_orig',
      title: 'MISTAKE: named the wrong root cause for the overnight build failure',
      content: 'What went wrong: blamed the cache when the runner was out of disk.',
      tags: ['negative'],
      timestamp: '2026-07-04T00:00:00.000Z',
    },
    {
      id: 'mem_chain_corr',
      title: 'CORRECTION to fb_9990001112223 (overnight build failure). Root cause was disk exhaustion on the runner.',
      content: 'How to avoid: check df output on the runner before blaming caches.',
      tags: ['negative'],
      timestamp: '2026-07-05T00:00:00.000Z',
    },
    {
      id: 'mem_chain_ref',
      title: 'REFINEMENT to the overnight build fix (mem_chain_corr). Disk exhaustion was caused by orphaned docker volumes.',
      content: 'How to avoid: prune orphaned volumes weekly.',
      tags: ['negative'],
      timestamp: '2026-07-06T00:00:00.000Z',
    },
  ];
  const feedback = [];
  for (let i = 1; i <= 5; i++) {
    feedback.push({
      id: 'fb_888000011122' + i + '_ev' + i,
      signal: 'negative',
      context: 'history sync auto capture produced an empty placeholder event again',
      timestamp: '2026-07-1' + i + 'T00:00:00.000Z',
    });
  }
  writeJsonl(path.join(dir, 'memory-log.jsonl'), memories);
  writeJsonl(path.join(dir, 'feedback-log.jsonl'), feedback);
}

test('migration buildPlan - collapses duplicate clusters and links supersession chains', () => {
  const dir = tmpDir('tg-graph-mig-');
  migrationFixture(dir);
  const plan = buildPlan(dir);

  assert.equal(plan.stats.memoryRecords, 6);
  assert.equal(plan.stats.feedbackEvents, 5);
  assert.ok(plan.stats.duplicateClustersCollapsed >= 2, 'memory + feedback clusters found');
  // 3 memory dups (occurrences 2+1+1=4) and 5 identical feedback events.
  const sizes = plan.clusters.map((c) => c.canonical.duplicateCount).sort((a, b) => b - a);
  assert.ok(sizes.includes(5), 'feedback cluster of 5 collapsed: ' + JSON.stringify(sizes));
  assert.ok(sizes.includes(4), 'memory cluster (occurrences-weighted 4) collapsed: ' + JSON.stringify(sizes));
  assert.equal(plan.stats.supersessionEdges, 1);
  assert.equal(plan.stats.refinementEdges, 1);

  const supersede = plan.lineageEdges.find((e) => e.type === 'supersedes');
  assert.equal(supersede.src, 'mem_chain_corr');
  assert.equal(supersede.dst, 'mem_chain_orig', 'truncated fb ref resolves to the promoted memory');
  const refine = plan.lineageEdges.find((e) => e.type === 'refines');
  assert.equal(refine.src, 'mem_chain_ref');
  assert.equal(refine.dst, 'mem_chain_corr');
});

test('migration - dry-run writes nothing; apply is idempotent and non-destructive to JSONL', () => {
  const dir = tmpDir('tg-graph-mig2-');
  migrationFixture(dir);
  const memBefore = fs.readFileSync(path.join(dir, 'memory-log.jsonl'), 'utf8');
  const fbBefore = fs.readFileSync(path.join(dir, 'feedback-log.jsonl'), 'utf8');

  const scriptPath = path.join(__dirname, '..', 'scripts', 'migrate-lesson-graph.js');
  const dryOut = execFileSync(process.execPath, [scriptPath, '--dry-run', '--feedback-dir', dir], { encoding: 'utf8' });
  const dryParsed = JSON.parse(dryOut);
  assert.equal(dryParsed.mode, 'dry-run');
  assert.equal(fs.existsSync(path.join(dir, 'lesson-graph.sqlite')), false, 'dry-run creates no DB');

  const plan = buildPlan(dir);
  const graphDbPath = path.join(dir, 'lesson-graph.sqlite');
  const first = applyPlan(plan, graphDbPath);
  const second = applyPlan(buildPlan(dir), graphDbPath);

  assert.equal(first.nodeCount, second.nodeCount, 'node count stable across re-runs');
  assert.deepEqual(first.edgeCounts, second.edgeCounts, 'edge counts stable across re-runs');
  assert.ok(second.backupPath && fs.existsSync(second.backupPath), 'second run backed up the existing graph DB');

  const db = initGraphDB(graphDbPath);
  const canonical = db.prepare(
    "SELECT duplicate_count FROM lesson_nodes WHERE id = 'mem_dup_1'",
  ).get();
  assert.equal(canonical.duplicate_count, 4, 'duplicate_count did not double on re-run');
  assert.ok(getNode(db, 'mem_chain_orig').valid_to, 'superseded original closed');
  assert.equal(getNode(db, 'mem_chain_ref').valid_to, null, 'refinement is the open current fact');
  assert.equal(resolveCurrentId(db, 'mem_chain_orig').id, 'mem_chain_ref');
  db.close();

  assert.equal(fs.readFileSync(path.join(dir, 'memory-log.jsonl'), 'utf8'), memBefore, 'memory-log untouched');
  assert.equal(fs.readFileSync(path.join(dir, 'feedback-log.jsonl'), 'utf8'), fbBefore, 'feedback-log untouched');
});
