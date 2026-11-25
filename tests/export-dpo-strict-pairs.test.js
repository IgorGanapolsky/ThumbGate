'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { exportDpoFromMemories } = require('../scripts/export-dpo-pairs');

const WINDOW = 'User: deploy the site\nAssistant: ran git push --force origin main';
function fb(id, over) {
  return Object.assign({ id, signal: 'negative', context: 'force push overwrote main history for everyone',
    whatWentWrong: 'force push overwrote main history for everyone', lastAction: 'git push --force origin main',
    conversationWindow: WINDOW, whatToChange: 'use git push --force-with-lease on a branch and open a PR',
    scope: { sessionId: 's1' }, sourceEvent: { promptIdHash: 'p1' } }, over);
}
function mem(id, fbId, over) {
  return Object.assign({ id, category: 'error', title: 'MISTAKE: ' + id, content: 'What went wrong: ' + id, tags: ['feedback', 'negative'], sourceFeedbackId: fbId }, over);
}
const run = (memories, rows) => exportDpoFromMemories(memories, { feedbackRows: rows });

test('REQ-01: a thumbs-down with its action, prompt window and corrective action makes one real pair', () => {
  const r = run([mem('m1', 'f1')], [fb('f1')]);
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0].rejected, 'git push --force origin main');
  assert.equal(r.pairs[0].chosen, 'use git push --force-with-lease on a branch and open a PR');
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
  const a = mem('m4', 'f4', { tags: ['feedback', 'git'], title: 'MISTAKE: git push' });
  const learning = { id: 'l1', category: 'learning', title: 'SUCCESS: git tips', content: 'nice git tips', tags: ['feedback', 'git'] };
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
  const up = { id: 'f9', signal: 'positive', lastAction: 'git push --force-with-lease origin feat/x', scope: { sessionId: 's1' }, sourceEvent: { promptIdHash: 'p1' } };
  const r = run([mem('m8', 'f8')], [fb('f8', { whatToChange: null }), up]);
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0].chosen, 'git push --force-with-lease origin feat/x');
  assert.equal(r.pairs[0].metadata.chosenSource, 'thumbs_up_same_session_and_prompt');
  const other = Object.assign({}, up, { sourceEvent: { promptIdHash: 'p2' } });
  assert.equal(run([mem('m8', 'f8')], [fb('f8', { whatToChange: null }), other]).pairs.length, 0);
});
