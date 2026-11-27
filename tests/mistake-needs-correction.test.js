'use strict';

// 27 Nov 2026: a new user request and a subagent hand-back report were recorded as "It ignored a prior instruction".
// Only a real thumbs-down or correction may create a mistake.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-correction-'));
Object.assign(process.env, { HOME: dir, THUMBGATE_FEEDBACK_DIR: dir, THUMBGATE_NO_TELEMETRY: '1' });
const { distillFeedbackHistory } = require('../scripts/feedback-history-distiller');
const { captureFeedback } = require('../scripts/feedback-loop');

const REQUEST = 'Read the brief and do every step. Use a worktree, include tests, and do not print tokens.';
const NEW_REQUEST = 'Can you use the new logo on the pricing page? It should be centered.';
const HANDBACK = 'Another Claude session sent a message: <agent-message from="builder">Done. Do not merge yet, the build failed.</agent-message>';

const distill = (text, author = 'user') => distillFeedbackHistory({
  signal: 'negative', context: 'thumbs down', chatHistory: [{ author, text }],
});
const blamed = (result) => /ignored a prior instruction/i.test(result.inferredFields.whatWentWrong || '');

test('a new request or an agent report is never an ignored instruction', () => {
  for (const text of [REQUEST, NEW_REQUEST, HANDBACK]) assert.equal(blamed(distill(text)), false, text);
  assert.equal(blamed(distill('Never push to main.', 'assistant')), false);
});

test('a real correction still is', () => {
  for (const text of ['Do not use Tailwind in this repo.', 'no, stop adding badges', 'I told you to keep one button',
    'You ignored the branch rule', 'that is not what I asked for']) {
    assert.equal(blamed(distill(text)), true, text);
  }
});

const auto = (context) => captureFeedback({ signal: 'down', context, tags: ['auto-capture', 'hook'] });

test('auto-capture records nothing for a request or report that only mentions the words', () => {
  for (const prompt of [
    'Can you fix this typo in the README and open a PR?',
    HANDBACK,
    `Owner order: do trust.1 (false blocks, including a thumbs-down hold covering unrelated commands). ${'Keep going. '.repeat(30)}`,
    'Subagent report: the first run showed that failed on CI, then passed on retry after I rebased the branch and reran everything twice.',
  ]) {
    assert.equal(auto(prompt).accepted, false, prompt);
  }
});

test('auto-capture still records a typed thumbs-down or correction', () => {
  for (const prompt of ['thumbs down: that mailed every customer without asking me', '👎 wrong file again',
    'that was wrong, the button is still missing', 'that failed', 'fix this!!', 'no that was wrong']) {
    assert.notEqual(auto(prompt).reason, 'Not recorded: no thumbs-down or correction from the person.', prompt);
  }
});

test("a correction found by history sync is not dropped by the prompt-hook check", () => {
  const result = captureFeedback({ signal: "down", context: "this is wrong: the checkout still crashes when I click submit", tags: ["claude-history-sync", "auto-capture-fallback"] });
  assert.notEqual(result.reason, "Not recorded: no thumbs-down or correction from the person.");
});
