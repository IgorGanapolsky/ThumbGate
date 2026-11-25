'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { exportDpoFromMemories } = require('../scripts/export-dpo-pairs');

const WINDOW = 'User: set up the project\nAssistant: ran make clean-all';
const BAD = 'make clean-all';
const GOOD = 'run make build and keep the cache';
function fb(id, over) {
  return { id, signal: 'negative', context: 'the build cache was wiped for everyone',
    whatWentWrong: 'the build cache was wiped for everyone', lastAction: BAD,
    conversationWindow: WINDOW, whatToChange: GOOD,
    scope: { sessionId: 's1' }, sourceEvent: { promptIdHash: 'p1' }, ...over };
}
function mem(id, fbId, over) {
  return { id, category: 'error', title: 'MISTAKE: ' + id, content: 'What went wrong: ' + id, tags: ['feedback', 'negative'], sourceFeedbackId: fbId, ...over };
}
const run = (memories, rows) => exportDpoFromMemories(memories, { feedbackRows: rows });

test('REQ-01: a thumbs-down with its action, prompt window and corrective action makes one real pair', () => {
  const r = run([mem('m1', 'f1')], [fb('f1')]);
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0].rejected, BAD);
  assert.equal(r.pairs[0].chosen, GOOD);
  assert.equal(r.pairs[0].prompt, WINDOW);
});

test('REQ-02: praise-only and "reinforce" records never pair', () => {
  const rows = [fb('f2', { whatToChange: "When answering 'x': Reinforce 'Easy to understand' - this behavior is working well" }),
    fb('f3', { whatToChange: 'great job' })];
  const r = run([mem('m2', 'f2'), mem('m3', 'f3')], rows);
  assert.equal(r.pairs.length, 0);
  assert.equal(r.droppedByReason.no_corrective_or_same_prompt_positive_action, 2);
});

test('REQ-03: unrelated records sharing only a tag never pair (the old keyword match did)', () => {
  const a = mem('m4', 'f4', { tags: ['feedback', 'build'], title: 'MISTAKE: build cache' });
  const learning = { id: 'l1', category: 'learning', title: 'SUCCESS: build tips', content: 'nice build tips', tags: ['feedback', 'build'] };
  const r = run([a, learning], []);
  assert.equal(r.pairs.length, 0);
  assert.equal(r.droppedKeywordOnlyCandidates, 1);
  assert.equal(r.droppedByReason.no_source_feedback_record, 1);
});

test('REQ-04: vague thumbs-down, missing action and missing window are reported with a reason', () => {
  const rows = [fb('f5', { whatWentWrong: 'thumbs down', context: 'thumbs down' }), fb('f6', { lastAction: null }), fb('f7', { conversationWindow: null })];
  const r = run([mem('m5', 'f5'), mem('m6', 'f6'), mem('m7', 'f7')], rows);
  assert.equal(r.pairs.length, 0);
  assert.deepEqual(r.droppedByReason, { vague_negative_feedback: 1, no_rejected_action_recorded: 1, no_prompt_context_recorded: 1 });
  assert.equal(r.unpairedErrors.length, 3);
});

test('REQ-05: a thumbs-up on the same session and prompt supplies the chosen action', () => {
  const up = { id: 'f9', signal: 'positive', lastAction: 'make build', scope: { sessionId: 's1' }, sourceEvent: { promptIdHash: 'p1' } };
  const r = run([mem('m8', 'f8')], [fb('f8', { whatToChange: null }), up]);
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0].chosen, 'make build');
  assert.equal(r.pairs[0].metadata.chosenSource, 'thumbs_up_same_session_and_prompt');
  const other = { ...up, sourceEvent: { promptIdHash: 'p2' } };
  assert.equal(run([mem('m8', 'f8')], [fb('f8', { whatToChange: null }), other]).pairs.length, 0);
});
