// tests/feedback-reward-score.test.js
'use strict';

// scoreFeedbackReward wires judge-reward-function.js into a reachable path.
// Before 2026-07-31 that module was 408 lines with zero non-test callers:
// `buildCompositeReward` was invoked only from its own test file and nothing
// injected a judge function, so it could never produce a number in production.
//
// These tests pin the behaviour that makes the wiring worth having — the score
// must actually DISCRIMINATE. A scorer that returns the same number for
// "be better" and a specific, evidence-backed correction is decoration.

const test = require('node:test');
const assert = require('node:assert/strict');

const { scoreFeedbackReward } = require('../scripts/feedback-quality');
const { captureFeedback } = require('../scripts/feedback-loop');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('scoreFeedbackReward: rewards specific, evidence-backed corrections over vague ones', () => {
  const vague = scoreFeedbackReward({
    signal: 'negative',
    whatToChange: 'be better next time',
  });
  const specific = scoreFeedbackReward({
    signal: 'negative',
    whatToChange: 'run npm test and verify the sha before claiming green, see commit abc123',
  });

  assert.ok(vague && specific, 'both should score');
  assert.ok(
    specific.score > vague.score,
    `specific (${specific.score}) must outrank vague (${vague.score})`
  );
  assert.strictEqual(specific.passed, true, 'an evidence-backed correction passes the required rubric');
  assert.strictEqual(vague.passed, false, 'a vague correction fails the required rubric');
});

test('scoreFeedbackReward: blocks an unverified completion claim', () => {
  // The rubric's safety dimension fails "done/deployed/live/shipped" unless the
  // text also carries verified/evidence/sha/health/test. This is the same contract
  // CLAUDE.md enforces on the agent — it should apply to captured lessons too.
  const claim = scoreFeedbackReward({ signal: 'negative', whatToChange: 'deployed the fix' });
  assert.ok(claim);
  assert.strictEqual(claim.label, 'deterministic_block');
  assert.ok(claim.score < 0.5, `unverified claim should score low, got ${claim.score}`);
});

test('scoreFeedbackReward: scores deterministically with no LLM judge injected', () => {
  // The whole point of the deterministic-first design: no ANTHROPIC_API_KEY, no
  // network, no silent degradation. If this ever reports a judge-backed mode we
  // have started depending on a key that is frequently absent.
  const result = scoreFeedbackReward({
    signal: 'negative',
    whatToChange: 'add a regression test that verifies the gate denies the originating command',
  });
  assert.ok(result);
  assert.strictEqual(result.scoringMode, 'deterministic_only');
  assert.ok(typeof result.score === 'number' && result.score >= 0 && result.score <= 1);
});

test('scoreFeedbackReward: reads whatWorked for positive signals', () => {
  const positive = scoreFeedbackReward({
    signal: 'positive',
    whatWorked: 'verified the fix by running the test suite, 51 pass 0 fail',
  });
  assert.ok(positive, 'positive feedback with whatWorked should score');
  assert.ok(positive.score > 0);
});

test('scoreFeedbackReward: returns null when there is no corrective text', () => {
  assert.strictEqual(scoreFeedbackReward({ signal: 'negative' }), null);
  assert.strictEqual(scoreFeedbackReward({}), null);
  assert.strictEqual(scoreFeedbackReward({ signal: 'negative', whatToChange: '   ' }), null);
});

test('captureFeedback: gates promotion when deterministic reward score fails', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-fb-reward-test-'));
  try {
    const prevDir = process.env.THUMBGATE_FEEDBACK_DIR;
    process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
    try {
      const result = captureFeedback({
        signal: 'negative',
        context: 'deployed the fix',
        whatToChange: 'deployed the fix',
      });
      assert.strictEqual(result.promoted, false, 'deterministic block must NOT report promoted: true');
      assert.strictEqual(result.accepted, false);
      assert.strictEqual(result.status, 'rejected');
      assert.ok(result.rewardScore, 'rewardScore should be attached');
      assert.strictEqual(result.rewardScore.label, 'deterministic_block');
    } finally {
      if (prevDir) process.env.THUMBGATE_FEEDBACK_DIR = prevDir;
      else delete process.env.THUMBGATE_FEEDBACK_DIR;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('captureFeedback: enriches scope and fields on promoted memoryRecord', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-fb-scope-test-'));
  try {
    const prevDir = process.env.THUMBGATE_FEEDBACK_DIR;
    process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
    try {
      const result = captureFeedback({
        signal: 'positive',
        context: 'section headers share one padding rule; check the live page at 400px after any republish',
      });
      assert.strictEqual(result.promoted, true);
      assert.strictEqual(result.status, 'promoted');
      assert.ok(result.memoryRecord);
      assert.ok(result.memoryRecord.scope.projectId, 'projectId must not be null');
      assert.ok(result.memoryRecord.whatWorked, 'whatWorked must be set on memoryRecord');
      assert.ok(result.memoryRecord.rule, 'rule should be derived on memoryRecord');
    } finally {
      if (prevDir) process.env.THUMBGATE_FEEDBACK_DIR = prevDir;
      else delete process.env.THUMBGATE_FEEDBACK_DIR;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
