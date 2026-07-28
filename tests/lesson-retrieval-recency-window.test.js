'use strict';

// Regression test for the retrieval recency window.
//
// Retrieval ranks memories by relevance and keeps anything scoring over 0.1 — but it only ever
// read the newest 200 lines of the memory log. The effect was that relevance stopped mattering
// past 200 entries: the best-matching lesson in the whole corpus became unreachable simply
// because 200 newer, unrelated notes existed. Nothing failed, nothing warned; retrieval just
// quietly returned nothing useful.
//
// These tests pin the property that matters — a highly relevant OLD lesson is retrievable —
// rather than pinning the constant, so raising or lowering the cap later cannot silently
// reintroduce the bug.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  retrieveRelevantLessons,
  scoreRelevance,
  buildActionSignature,
  MAX_RETRIEVAL_MEMORY_LINES,
} = require('../scripts/lesson-retrieval.js');

const QUERY = 'git push --force origin main';

// The oldest entry, and the best match in the corpus.
const ANCIENT = {
  id: 'ancient-force-push',
  title: 'git push --force origin main destroyed shared history',
  content: 'Running git push --force origin main destroyed shared history; recovery needed reflog.',
  category: 'learning',
  tags: ['git', 'force-push', 'negative'],
  timestamp: '2026-01-01T00:00:00.000Z',
  richContext: { domain: 'git-workflow', filePaths: [] },
};

function writeCorpus(dir, total) {
  const lines = [JSON.stringify(ANCIENT)];
  for (let index = 1; index < total; index += 1) {
    lines.push(JSON.stringify({
      id: `routine-${index}`,
      title: `Routine note ${index}`,
      content: `Unrelated observation about documentation formatting number ${index}.`,
      category: 'learning',
      tags: ['docs'],
      timestamp: new Date(1_770_000_000_000 + index * 60_000).toISOString(),
      richContext: { domain: 'documentation', filePaths: [] },
    }));
  }
  fs.writeFileSync(path.join(dir, 'memory-log.jsonl'), `${lines.join('\n')}\n`);
}

function withCorpus(total, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-retrieval-window-'));
  try {
    writeCorpus(dir, total);
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the fixture lesson genuinely outscores the retrieval threshold', () => {
  // Guards the test itself: if this lesson stopped matching, the assertions below would pass
  // for the wrong reason and the window regression would go undetected.
  const score = scoreRelevance(ANCIENT, 'Bash', QUERY, buildActionSignature('Bash', QUERY));
  assert.ok(score > 0.1, `fixture scores ${score}, at or below the 0.1 retrieval threshold`);
});

test('a highly relevant lesson is retrievable when it is the newest entry', () => {
  // Baseline: with a small corpus this always worked, which is why the bug stayed invisible.
  const found = withCorpus(50, (dir) => (
    retrieveRelevantLessons('Bash', QUERY, { feedbackDir: dir, maxResults: 5 })
  ));
  assert.ok(found.some((lesson) => lesson.id === ANCIENT.id), 'baseline retrieval is broken');
});

test('it stays retrievable once more than 200 newer entries exist', () => {
  // THE REGRESSION. Before the fix the cliff was at exactly 201 entries.
  const found = withCorpus(400, (dir) => (
    retrieveRelevantLessons('Bash', QUERY, { feedbackDir: dir, maxResults: 5 })
  ));
  assert.ok(
    found.some((lesson) => lesson.id === ANCIENT.id),
    'the best-matching lesson vanished because 200 newer unrelated entries exist — '
    + 'retrieval is recency-truncated again',
  );
});

test('it stays retrievable across a corpus an order of magnitude larger', () => {
  const found = withCorpus(3000, (dir) => (
    retrieveRelevantLessons('Bash', QUERY, { feedbackDir: dir, maxResults: 5 })
  ));
  assert.ok(found.some((lesson) => lesson.id === ANCIENT.id),
    'relevance stops working somewhere between 400 and 3000 entries');
});

test('retrieval stays fast on a large corpus', () => {
  // The cap exists for cost, so the cost is asserted rather than assumed. Worst case measured
  // during development was ~4.2 ms/call at 20,000 entries; 250 ms is a deliberately loose
  // ceiling so this cannot go flaky on a loaded CI runner while still catching a real blowup.
  const elapsed = withCorpus(5000, (dir) => {
    retrieveRelevantLessons('Bash', QUERY, { feedbackDir: dir, maxResults: 5 }); // warm
    const started = process.hrtime.bigint();
    for (let index = 0; index < 5; index += 1) {
      retrieveRelevantLessons('Bash', QUERY, { feedbackDir: dir, maxResults: 5 });
    }
    return Number(process.hrtime.bigint() - started) / 1e6 / 5;
  });
  assert.ok(elapsed < 250, `retrieval took ${elapsed.toFixed(1)} ms/call on 5,000 entries`);
});

test('the line cap is configurable and sane', () => {
  assert.ok(Number.isFinite(MAX_RETRIEVAL_MEMORY_LINES), 'cap is not a number');
  assert.ok(MAX_RETRIEVAL_MEMORY_LINES >= 1000,
    `cap ${MAX_RETRIEVAL_MEMORY_LINES} is low enough to re-truncate realistic corpora`);
});
