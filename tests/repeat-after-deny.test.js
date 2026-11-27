'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-repeat-deny-'));
const FEEDBACK = path.join(ROOT, '.thumbgate');
process.env.HOME = ROOT;
process.env.THUMBGATE_FEEDBACK_DIR = FEEDBACK;
process.env.THUMBGATE_NO_TELEMETRY = '1';
process.env.DO_NOT_TRACK = '1';

const { captureFeedback } = require('../scripts/feedback-loop');
const engine = require('../scripts/gates-engine');
const { loadAutoGates, repeatAfterDeny } = require('../scripts/auto-promote-gates');
const { recordConversationEntry } = require('../scripts/feedback-history-distiller');

for (const key of ['STATE_PATH', 'STATS_PATH', 'CONSTRAINTS_PATH', 'SESSION_ACTIONS_PATH', 'GOVERNANCE_STATE_PATH']) {
  engine[key] = path.join(ROOT, `${key.toLowerCase()}.json`);
}
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const TEXT = "retried a denied action without the user's yes";
const call = (command, sessionId = 's1') => ({ session_id: sessionId, tool_name: 'Bash', tool_input: { command } });
const gateHit = (input) => {
  const { hardFloor } = engine.evaluateUnconditionalHardFloor(input);
  return Boolean(hardFloor && String(hardFloor.gate).startsWith(repeatAfterDeny.GATE_ID));
};

test('conditionFor needs both the retry and the missing yes', () => {
  assert.equal(repeatAfterDeny.conditionFor(TEXT), 'repeat-after-deny');
  assert.equal(repeatAfterDeny.conditionFor('the report was unclear'), null);
  assert.equal(repeatAfterDeny.conditionFor('retried the flaky test after it was rejected'), null);
});

test('prose-only thumbs-down asks for a tool and a condition', () => {
  const result = captureFeedback({ signal: 'down', context: 'The summary was confusing and far too long to read today', whatWentWrong: 'The summary was confusing and far too long to read today', tags: ['writing'] });
  assert.match(result.gatePrompt, /tool and the condition/);
});

test('the thumbs-down makes an active gate that fires on the repeat only', async () => {
  const captured = captureFeedback({ signal: 'down', context: TEXT, whatWentWrong: TEXT, whatToChange: 'Ask before sending the same call again', tags: ['retry-after-deny'] });
  assert.equal(captured.accepted, true);
  assert.equal(captured.gatePrompt, undefined);
  const gate = loadAutoGates({ feedbackDir: FEEDBACK }).gates.find((g) => g.condition === 'repeat-after-deny');
  assert.ok(gate, 'gate promoted');
  assert.equal(gate.active, true);
  assert.equal(gate.action, 'block');
  // An engine that ignores `condition` must never match anything with it.
  assert.equal(new RegExp(gate.pattern).test('Bash git status'), false);

  const first = call('git push --force origin main');
  const userSaid = (text, at) => recordConversationEntry({ author: 'user', text, source: 'claude_user_prompt', timestamp: new Date(at).toISOString() }, { feedbackDir: FEEDBACK });
  engine.run(first);
  assert.equal(gateHit(first), false, 'no prompt on record: never hold, a yes could not release it');
  userSaid('push the branch', Date.now() - 60000);
  fs.rmSync(path.join(FEEDBACK, 'repeat-after-deny-state.json'), { force: true });

  assert.equal(gateHit(first), false, 'first call is not this gate');
  const denied = JSON.stringify(engine.run(first));
  assert.match(denied, /deny|block/, 'the first call is denied by another gate');
  assert.equal(gateHit(first), true, 'identical repeat is refused');
  assert.equal(gateHit({ ...first, tool_input: { ...first.tool_input, description: 'try again' } }), true);
  assert.equal(gateHit(call('git status')), false, 'a different call passes');
  assert.equal(gateHit(call('git push --force origin main', 's2')), false, 'another session passes');

  userSaid('ok, go', Date.now() + 1000);
  assert.equal(gateHit(first), false, 'a new user turn releases it');

  await engine.runAsync({ ...first, session_id: 's3' });
  assert.match(fs.readFileSync(path.join(FEEDBACK, 'repeat-after-deny-state.json'), 'utf8'), /"sessionId":"s3"/, 'the async hook path records too');
});
