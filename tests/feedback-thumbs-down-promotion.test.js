'use strict';

// AGENT-3667, 24 Nov 2026: Igor's thumbs-down came back "Reward score blocked promotion: deterministic_block"
// because an older build gated promotion on the reward rubric, and that rubric fails any correction that says
// "done" or "live" without a test or sha in the same sentence. That is exactly what a correction about an
// unverified claim says. The score is a report on the correction; it must never decide whether a person's
// thumbs-down becomes a lesson. Only empty feedback and secrets are refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-down-promote-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmp;
process.env.THUMBGATE_NO_RATE_LIMIT = '1';

const { captureFeedback } = require('../scripts/feedback-loop');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const down = (n, fields) => captureFeedback({ signal: 'down', tags: ['feedback'], reviewOrigin: 'human', ...fields, context: `${fields.context} (case ${n})` });

test('a thumbs-down that says the work was called done and live is promoted, not rejected', () => {
  const fields = {
    context: 'Igor said the agent called the fix done and live but his screen still shows the old number.',
    whatWentWrong: 'It reported the work as done and live without checking what Igor sees.',
    whatToChange: 'Show what Igor sees before calling anything done.',
  };
  // Older builds failed this wording as an unverified completion claim and rejected the thumbs-down.
  const result = down(1, fields);
  assert.doesNotMatch(String(result.reason || ''), /Reward score blocked/, 'the reward score must never gate a person\'s thumbs-down');
  assert.equal(result.accepted, true, `rejected: ${result.reason}`);
  assert.equal(result.promoted, true);
  assert.equal(result.status, 'promoted');
  assert.ok(result.feedbackEvent.rewardScore, 'the score is still recorded on the event');
});

test('a thumbs-down that quotes Igor in plain English, with no file path or tool name, is promoted', () => {
  const result = down(2, {
    context: 'Igor: "this sounds like thumbgate is broken". His thumbs-down was rejected, so the correction was lost.',
    whatToChange: 'Make a plain thumbs-down with a written reason stick as a lesson.',
    tags: ['feedback', 'thumbgate'],
  });
  assert.equal(result.accepted, true, `rejected: ${result.reason}`);
  assert.equal(result.promoted, true);
});

test('a short plain correction is promoted', () => {
  const result = down(3, { context: 'The reply was too long and buried the answer.', whatToChange: 'Lead with the answer in the first sentence.' });
  assert.equal(result.accepted, true, `rejected: ${result.reason}`);
  assert.equal(result.promoted, true);
});

test('real safety checks still refuse: an empty thumbs-down and a secret are not promoted', () => {
  const empty = captureFeedback({ signal: 'down', reviewOrigin: 'human' });
  assert.equal(empty.promoted === true, false, 'empty feedback is not promoted');
  const fakeKey = ['sk', 'ant', 'abcdefghijklmnopqrstuvwxyz123456'].join('-');
  const secret = captureFeedback({ signal: 'down', reviewOrigin: 'human', context: `Never store ${fakeKey} in memory.`, whatToChange: 'Keep keys out of memory.' });
  assert.equal(secret.promoted === true, false, 'a secret is not promoted');
});
