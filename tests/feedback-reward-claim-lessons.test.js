#!/usr/bin/env node
'use strict';

// Igor's corrections about false status claims were rejected by the reward score
// ("deterministic_block") because the correction text itself contains the word
// "live" or "done" with no evidence word. The completion-claim rule is meant for an
// agent's own output, not for a correction that describes a claim.

const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreFeedbackReward } = require('../scripts/feedback-quality');
const { buildCompositeReward } = require('../scripts/judge-reward-function');

// whatToChange texts of corrections captured on 22 Nov 2026 that were rejected.
const REJECTED_CORRECTIONS = [
  'When asked "are you sure?", open with the corrected fact itself, label each claim as live, saved-file or inferred, and fix an earlier error in one plain line before the result.',
  'When Igor gives a goal, lead with what was done, send the pending messages myself via the send script (a script send costs no agent tokens), and never open with what I can\'t promise.',
];

test('a correction that mentions "live" or "done" is not blocked as a fake completion claim', () => {
  for (const whatToChange of REJECTED_CORRECTIONS) {
    const reward = scoreFeedbackReward({ signal: 'down', whatToChange, context: 'Igor said this was wrong.' });
    assert.notEqual(reward.label, 'deterministic_block', `blocked: ${whatToChange.slice(0, 60)}`);
  }
});

test('an agent output that claims "deployed" with no evidence is still blocked', () => {
  const reward = buildCompositeReward({ prediction: 'Everything is deployed and live.' });
  assert.equal(reward.label, 'deterministic_block');
});

test('feedback text that still holds a secret-shaped token is blocked by the scorer', () => {
  // scoreFeedbackReward sanitizes text first, so exercise the scorer directly.
  const token = ['ghp', 'a'.repeat(30)].join('_');
  const reward = buildCompositeReward({ prediction: `Never paste ${token} into a reply.`, kind: 'feedback' });
  assert.equal(reward.label, 'deterministic_block');
});
