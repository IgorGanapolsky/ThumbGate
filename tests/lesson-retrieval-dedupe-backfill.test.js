'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { retrieveRelevantLessons, dedupeCandidatePool } = require('../scripts/lesson-retrieval');

function lesson(id, title, content, extra = {}) {
  return {
    id,
    title,
    content,
    tags: ['negative'],
    signal: 'negative',
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

function seedFeedbackDir(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-retrieval-'));
  fs.writeFileSync(
    path.join(dir, 'memory-log.jsonl'),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );
  return dir;
}

const DUPE_TEXT =
  'Railway deploy verification timed out waiting for the health endpoint before the rebuild completed.';

test('a duplicate cluster no longer under-fills the slot budget (backfill)', () => {
  const dir = seedFeedbackDir([
    lesson('dupe-1', 'Railway deploy verification timed out', `${DUPE_TEXT} attempt one`),
    lesson('dupe-2', 'Railway deploy verification timed out', `${DUPE_TEXT} attempt two`),
    lesson('dupe-3', 'Railway deploy verification timed out', `${DUPE_TEXT} attempt three`),
    lesson(
      'distinct-logs',
      'Read the rebuild logs first',
      'Before blaming the platform read the railway rebuild logs for native module build failures.',
    ),
    lesson(
      'distinct-swap',
      'Wait for the container swap',
      'Deploy verification must wait for the container swap to finish before the health endpoint reflects the new version.',
    ),
  ]);
  const results = retrieveRelevantLessons(
    'Bash',
    'railway deploy health endpoint verification timed out during rebuild',
    { feedbackDir: dir, pragmatic: false, maxResults: 3 },
  );
  assert.equal(results.length, 3, `expected a full slot budget, got ${results.length}`);
  const ids = results.map((r) => r.id);
  assert.ok(ids.includes('distinct-logs'), `expected distinct-logs in ${ids}`);
  assert.ok(ids.includes('distinct-swap'), `expected distinct-swap in ${ids}`);
  const dupes = ids.filter((id) => id.startsWith('dupe-'));
  assert.equal(dupes.length, 1, `expected exactly one dupe survivor in ${ids}`);
});

test('results never exceed maxResults after the over-fetch', () => {
  const dir = seedFeedbackDir([
    lesson(
      'l1',
      'Read the rebuild logs first',
      'Before blaming the platform read the railway rebuild logs for native module build failures.',
    ),
    lesson(
      'l2',
      'Wait for the container swap',
      'Deploy verification must wait for the container swap to finish before the health endpoint reflects the new version.',
    ),
    lesson(
      'l3',
      'Compare endpoint and package versions',
      'The production health payload version must equal the merged package version before any claim.',
    ),
    lesson(
      'l4',
      'Rebuilds lag merges by minutes',
      'A container rebuild takes two to five minutes so production lags the merge commit.',
    ),
    lesson(
      'l5',
      'Native modules need build tools',
      'Alpine images require python and a compiler for sqlite native builds during the image rebuild.',
    ),
  ]);
  const results = retrieveRelevantLessons(
    'Bash',
    'railway deploy health endpoint verification during rebuild',
    { feedbackDir: dir, pragmatic: false, maxResults: 3 },
  );
  assert.ok(results.length <= 3, `expected at most 3 results, got ${results.length}`);
  assert.ok(results.length >= 1, 'expected at least one result');
});

test('dedupeCandidatePool collapses same-signal near-duplicates before the pool cut', () => {
  const mk = (id, score, content, title = 'Railway deploy verification timed out') => ({
    id,
    title,
    content,
    tags: ['negative'],
    signal: 'negative',
    relevanceScore: score,
    timestamp: '2026-08-01T10:00:00.000Z',
  });
  const scored = [
    mk('d1', 0.9, `${DUPE_TEXT} attempt one`),
    mk('d2', 0.89, `${DUPE_TEXT} attempt two`),
    mk('d3', 0.88, `${DUPE_TEXT} attempt three`),
    mk(
      'b',
      0.5,
      'Before blaming the platform read the railway rebuild logs for native module build failures.',
      'Read the rebuild logs first',
    ),
  ];
  const pooled = dedupeCandidatePool(scored);
  assert.deepEqual(pooled.map((m) => m.id), ['d1', 'b']);
});

const DISTINCT_SENTENCES = [
  'Grep the workflow logs before assigning blame for a red check.',
  'Archive orphan branches as tags before deleting the remote ref.',
  'A stale lease fails closed so renew scope before continuing edits.',
  'Quarantine transport blobs instead of promoting them to memory.',
  'Pin the bundle file count and bump the baseline deliberately.',
  'Verify npm tarball contents rather than trusting a green publish job.',
  'Use the path resolve form for command line entry point detection.',
  'Read the vault claims file before touching a contested checkout.',
  'Sum occurrence counts when merging split lesson records.',
  'Prefer the queue over direct merges for protected trunk branches.',
];

test('dedupeCandidatePool respects the pool bound', () => {
  const scored = DISTINCT_SENTENCES.map((content, i) => ({
    id: `u${i}`,
    title: `Lesson ${i}`,
    content,
    tags: ['negative'],
    signal: 'negative',
    relevanceScore: 1 - i * 0.05,
    timestamp: '2026-08-01T10:00:00.000Z',
  }));
  const pooled = dedupeCandidatePool(scored, 4);
  assert.equal(pooled.length, 4);
  assert.deepEqual(pooled.map((m) => m.id), ['u0', 'u1', 'u2', 'u3']);
});
