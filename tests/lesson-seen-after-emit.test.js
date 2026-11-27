'use strict';

// Review of PR 5313: a call that was denied dropped its lesson text but still recorded the lesson as shown.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-lesson-seen-'));
process.env.HOME = sandbox;
process.env.THUMBGATE_FEEDBACK_DIR = sandbox;
process.env.THUMBGATE_NO_TELEMETRY = '1';

const retrieval = require('../scripts/lesson-retrieval');
retrieval.retrieveRelevantLessons = () => [{
  id: 'reset-lesson', signal: 'negative', relevanceScore: 1,
  title: 'MISTAKE: release-notes.md edits were lost', content: 'How to avoid: copy release-notes.md before resetting',
}];
const { run } = require('../scripts/gates-engine');

const call = (command) => JSON.stringify(run({ tool_name: 'Bash', tool_input: { command }, session_id: path.basename(sandbox) }));

test('a lesson dropped by a denial is still shown on the next allowed call', () => {
  process.env.THUMBGATE_STRICT_ENFORCEMENT = '1';
  const denied = call('git reset --hard origin/main && echo release-notes.md');
  assert.match(denied, /deny/);
  assert.doesNotMatch(denied, /copy release-notes\.md before resetting/);
  delete process.env.THUMBGATE_STRICT_ENFORCEMENT;
  const next = call('wc -l release-notes.md');
  assert.match(next, /copy release-notes\.md before resetting/);
});

test('an expansion inside an argument keeps a command from counting as read-only', () => {
  const { isReadOnlyCall } = require('../scripts/send-gate');
  for (const command of ['find . -${action}', 'printf -v"x" y', 'printf -${flag} y', 'git log --pretty="x" -${n}', 'find x${HIDDEN} -name y', 'for a in $LIST; do find $a; done']) {
    assert.equal(isReadOnlyCall('Bash', { command }), false, command);
  }
  assert.equal(isReadOnlyCall('Bash', { command: 'find . -name "*.js"' }), true);
});

test("a lesson is recorded as shown only for a result that prints it", () => {
  const { lessonSessionId } = require("../scripts/gates-engine");
  const input = { session_id: "s" };
  for (const decision of ["allow", "deny", "approve", "log"]) assert.equal(lessonSessionId(input, { decision }), undefined, decision);
  for (const result of [null, { decision: "warn" }]) assert.equal(lessonSessionId(input, result), "s");
});
