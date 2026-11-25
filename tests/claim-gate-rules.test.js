'use strict';

// AGENT-3667 item N: the claim gate must hold an unchecked claim of outside state (sign-in refused, host down, ticket
// blocked), must not accept a /health 200 or an old log as the check, and a person's thumbs-downs on such a claim must
// write a rule by themselves.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gate = require('../scripts/claim-gate-stop');

const bash = (summary) => [{ name: 'Bash', summary }];
const TABLE = [
  // id, sentence, tool calls made this turn, expected
  ['U1', 'Sign-in is refused on the production site.', [], 'hold'],
  ['U2', 'The staging host is down right now.', [], 'hold'],
  ['U3', 'The ticket is blocked on the vendor.', [], 'hold'],
  ['C1', 'Sign-in is refused on the production site.', bash('curl -s -o /dev/null -w %{http_code} https://x.test/login'), 'pass'],
  ['C2', 'The staging host is down right now.', bash('ping -c1 staging.x.test'), 'pass'],
  ['C3', 'The ticket is blocked on the vendor.', bash('gh issue view 12 --json state'), 'pass'],
  ['H1', 'Sign-in is refused on the production site.', bash('curl -s https://x.test/health'), 'hold'],
  ['L1', 'The staging host is down right now.', bash('tail -n 50 /var/log/app/yesterday.log'), 'hold'],
];

for (const [id, sentence, toolCalls, expected] of TABLE) {
  test(`${id}: "${sentence}" with ${toolCalls.length ? toolCalls[0].summary : 'no check'} is ${expected === 'hold' ? 'held' : 'let through'}`, () => {
    const verdict = gate.evaluateDraft(sentence, { toolNames: toolCalls.map((c) => c.name), toolCalls, retrieve: () => [], feedbackDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tg-claim-empty-')) });
    assert.equal(verdict.block ? 'hold' : 'pass', expected);
  });
}

test('a labelled claim is let through even with no check', () => {
  const verdict = gate.evaluateDraft('Sign-in is refused on the production site (not checked).', { toolCalls: [], retrieve: () => [], feedbackDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tg-claim-empty-')) });
  assert.equal(verdict.block, false);
});

test('two human thumbs-downs on an unchecked claim write a rule with no file edit, and the next unchecked claim is held', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-claim-learn-'));
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  process.env.THUMBGATE_NO_RATE_LIMIT = '1';
  const { captureFeedback } = require('../scripts/feedback-loop');
  const rulesFile = path.join(dir, 'claim-gate-rules.json');
  const claim = 'The webhook endpoint is timing out.';
  const before = gate.evaluateDraft(claim, { toolCalls: [], retrieve: () => [], feedbackDir: dir });
  assert.equal(before.block, false, 'the built-in patterns do not know this sentence yet');
  const down = (n) => captureFeedback({ signal: 'down', reviewOrigin: 'human', context: `You said "${claim}" without checking it this turn (${n})`, whatWentWrong: `Stated "${claim}" without checking.`, whatToChange: 'Check before stating outside state.', tags: ['unchecked-claim'] });
  down(1);
  assert.equal(gate.evaluateDraft(claim, { toolCalls: [], retrieve: () => [], feedbackDir: dir }).block, false, 'one thumbs-down is not a rule');
  down(2);
  const rules = JSON.parse(fs.readFileSync(rulesFile, 'utf8')).rules;
  assert.equal(rules.length, 1, 'a rule exists after the second thumbs-down');
  assert.equal(rules[0].action, 'hold');
  assert.equal(rules[0].thumbsDown, 2);
  const held = gate.evaluateDraft('The webhook endpoint is timing out again.', { toolCalls: [], retrieve: () => [], feedbackDir: dir });
  assert.equal(held.block, true, 'the next unchecked claim is held');
  assert.equal(held.claims[0].kind, 'learned');
  const withCheck = gate.evaluateDraft('The webhook endpoint is timing out.', { toolCalls: bash('curl -sS -m 5 -X POST https://x.test/hooks/stripe'), retrieve: () => [], feedbackDir: dir });
  assert.equal(withCheck.block, false, 'a real check from this turn clears it');
  const healthOnly = gate.evaluateDraft('The webhook endpoint is timing out.', { toolCalls: bash('curl -s https://x.test/health'), retrieve: () => [], feedbackDir: dir });
  assert.equal(healthOnly.block, true, 'a /health 200 does not clear it');
});

test('an agent-origin thumbs-down never writes a claim rule', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-claim-agent-'));
  const rules = require('../scripts/claim-gate-rules');
  for (let i = 0; i < 3; i += 1) rules.recordFromFeedback({ reviewOrigin: 'agent', context: 'You said "the queue is stuck" without checking', whatWentWrong: 'said "the queue is stuck" without checking' }, dir);
  assert.equal(fs.existsSync(path.join(dir, 'claim-gate-rules.json')), false);
});
