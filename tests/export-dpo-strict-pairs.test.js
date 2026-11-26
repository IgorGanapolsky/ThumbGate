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

test('REQ-08: the failed command recorded by the pre-action hook is the rejected action when lastAction is only a tool name', () => {
  const r = run([mem('m20', 'f20')], [fb('f20', { lastAction: { tool: 'Bash' }, failedCommand: BAD })]);
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0].rejected, BAD);
  assert.equal(r.pairs[0].metadata.rejectedSource, 'failed_command');
  assert.equal(r.pairs[0].prompt, 'User: set up the project');
});

test('REQ-09: with no recorded action, the last agent reply in the window is the rejected response', () => {
  const window = [
    { role: 'user', content: 'Which port does the API use?' },
    { role: 'assistant', content: 'It uses port 8080.' },
  ];
  const r = run([mem('m21', 'f21')], [fb('f21', { lastAction: null, conversationWindow: window, whatToChange: 'Read the port from config before answering: it is 3000.' })]);
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0].rejected, 'It uses port 8080.');
  assert.equal(r.pairs[0].prompt, 'user: Which port does the API use?');
  assert.equal(r.pairs[0].metadata.rejectedSource, 'last_agent_reply');
});

test('REQ-10: an agent reply with nothing before it is not a pair (no prompt)', () => {
  const r = run([mem('m22', 'f22')], [fb('f22', { lastAction: null, conversationWindow: [{ role: 'assistant', content: 'Done.' }] })]);
  assert.equal(r.pairs.length, 0);
  assert.equal(r.droppedByReason.no_rejected_action_recorded, 1);
});

test('REQ-11: the production self-test fixture makes exactly its one expected pair and accounts for every record', () => {
  const { DPO_SELF_TEST_FIXTURE: f } = require('../scripts/export-dpo-pairs');
  const r = exportDpoFromMemories(f.memories, { feedbackRows: f.feedback });
  assert.equal(r.pairs.length, f.expected.pairs);
  assert.equal(r.pairs[0].rejected, f.expected.rejected);
  assert.equal(r.pairs[0].chosen, f.expected.chosen);
  assert.ok(!r.pairs[0].prompt.includes(f.expected.rejected));
  const dropped = Object.values(r.droppedByReason).reduce((a, b) => a + b, 0);
  assert.equal(r.pairs.length + dropped, r.errors.length + r.learnings.length);
});

test('REQ-12: a repeated agent reply builds its prompt from the messages before the LAST occurrence', () => {
  const window = [
    { role: 'user', content: 'Which port does the worker use?' },
    { role: 'assistant', content: 'It uses port 8080.' },
    { role: 'user', content: 'Which port does the API use?' },
    { role: 'assistant', content: 'It uses port 8080.' },
  ];
  const r = run([mem('m23', 'f23')], [fb('f23', { lastAction: null, conversationWindow: window, whatToChange: 'Read the API port from config: it is 3000.' })]);
  assert.equal(r.pairs.length, 1);
  assert.match(r.pairs[0].prompt, /Which port does the API use\?$/);
  assert.match(r.pairs[0].prompt, /^user: Which port does the worker use\?/);
});

test('REQ-13: captureFeedback keeps the action command (secret-redacted, bounded), and the export pairs on it', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dpo-capture-'));
  const prev = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  try {
    const { captureFeedback } = require('../scripts/feedback-loop');
    const result = captureFeedback({
      signal: 'down',
      context: 'Agent forced a fresh install to fix a lockfile mismatch in CI',
      whatWentWrong: 'It ignored the lockfile and pulled newer versions than CI pins',
      whatToChange: 'Run npm ci so the install matches package-lock.json exactly',
      lastAction: { tool: 'Bash', command: `npm install --force --token=ghp_${'a'.repeat(36)} ${'x'.repeat(600)}` },
      conversationWindow: [
        { role: 'user', content: 'CI fails with lockfile out of sync. Fix it.' },
        { role: 'assistant', content: 'Running the install now.' },
      ],
    }, { feedbackDir: dir });
    const action = result.feedbackEvent.lastAction;
    assert.equal(action.tool, 'Bash');
    assert.match(action.command, /^npm install --force --token=\[REDACTED/);
    assert.ok(action.command.length <= 400);
    assert.doesNotMatch(JSON.stringify(result.feedbackEvent), /ghp_a{36}/);

    const memories = result.memoryRecord ? [result.memoryRecord] : [];
    assert.equal(memories.length, 1, 'thumbs-down with a correction is promoted to a memory');
    const r = exportDpoFromMemories(memories, { feedbackRows: [result.feedbackEvent] });
    assert.equal(r.pairs.length, 1);
    assert.equal(r.pairs[0].rejected, action.command);
    assert.equal(r.pairs[0].metadata.rejectedSource, 'recorded_action');
  } finally {
    if (prev === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR; else process.env.THUMBGATE_FEEDBACK_DIR = prev;
  }
});
