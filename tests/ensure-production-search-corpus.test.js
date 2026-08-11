'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  SEED_ID,
  SEED_FEEDBACK_ID,
  ensureProductionSearchCorpus,
} = require('../scripts/ensure-production-search-corpus');
const { searchThumbgateAsync } = require('../scripts/thumbgate-search');
const { searchLessons } = require('../scripts/lesson-search');

function tempFeedbackDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tg-seed-corpus-'));
}

test('ensureProductionSearchCorpus is idempotent and searchable for thumbgate', async () => {
  const feedbackDir = tempFeedbackDir();
  const first = ensureProductionSearchCorpus({ feedbackDir, nowIso: '2026-08-11T00:00:00.000Z' });
  assert.equal(first.wrote.memory, true);
  assert.equal(first.wrote.feedback, true);
  assert.equal(first.wrote.rules, true);

  const second = ensureProductionSearchCorpus({ feedbackDir, nowIso: '2026-08-11T01:00:00.000Z' });
  assert.equal(second.wrote.memory, false);
  assert.equal(second.wrote.feedback, false);
  assert.equal(second.wrote.rules, false);

  const memory = fs.readFileSync(path.join(feedbackDir, 'memory-log.jsonl'), 'utf8');
  assert.equal(memory.split('\n').filter(Boolean).length, 1);
  assert.match(memory, new RegExp(SEED_ID));

  const search = await searchThumbgateAsync({
    query: 'thumbgate',
    source: 'all',
    limit: 3,
    feedbackDir,
  });
  assert.equal(search.engine, 'hybrid-parent-child');
  assert.ok(search.returned > 0, 'expected hybrid search hits after seed');
  assert.ok(search.results.some((row) => row.source === 'prevention_rule' || row.source === 'feedback'));

  const lessons = searchLessons('thumbgate', { feedbackDir, limit: 3 });
  assert.ok(lessons.returned > 0, 'expected lesson hits after seed');
  assert.ok(lessons.results.every((row) => row.evidenceScore > 0));
  assert.ok(lessons.results.some((row) => row.id === SEED_ID || String(row.context || '').includes('ThumbGate')));
  assert.match(fs.readFileSync(path.join(feedbackDir, 'feedback-log.jsonl'), 'utf8'), new RegExp(SEED_FEEDBACK_ID));
});
