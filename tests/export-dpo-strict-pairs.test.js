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
  // The prompt ends before the rejected action: the line that ran it is not part of the conditioning context.
  assert.equal(r.pairs[0].prompt, 'User: set up the project');
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

test('REQ-06: a lastAction that is only a tool name is not an action and never pairs', () => {
  const toolOnly = { tool: 'Bash', contextKey: 'k', file: null, timestamp: null };
  const r = run([mem('m10', 'f10')], [fb('f10', { lastAction: toolOnly })]);
  assert.equal(r.pairs.length, 0);
  assert.equal(r.droppedByReason.rejected_action_has_no_content, 1);
  const withInput = run([mem('m11', 'f11')], [fb('f11', { lastAction: { tool: 'Bash', input: { command: BAD } } })]);
  assert.equal(withInput.pairs.length, 1);
  assert.match(withInput.pairs[0].rejected, /make clean-all/);
});

test('REQ-07: a message window keeps roles and stops before the message holding the rejected action', () => {
  const window = [
    { role: 'user', content: 'set up the project' },
    { role: 'assistant', content: 'ran make clean-all' },
    { role: 'user', content: 'no, that wiped the cache' },
  ];
  const r = run([mem('m12', 'f12')], [fb('f12', { conversationWindow: window })]);
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0].prompt, 'user: set up the project');
  const onlyAction = run([mem('m13', 'f13')], [fb('f13', { conversationWindow: [{ role: 'assistant', content: 'make clean-all' }] })]);
  assert.equal(onlyAction.pairs.length, 0);
  assert.equal(onlyAction.droppedByReason.no_prompt_context_before_rejected_action, 1);
});

test('REQ-08: feedbackDir picks the feedback log next to the exported memories', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-strict-'));
  try {
    fs.writeFileSync(path.join(dir, 'feedback-log.jsonl'), JSON.stringify(fb('f14')) + '\n');
    const r = exportDpoFromMemories([mem('m14', 'f14')], { feedbackDir: dir });
    assert.equal(r.pairs.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
