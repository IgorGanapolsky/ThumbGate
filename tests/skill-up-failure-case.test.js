'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const gate = require('../scripts/skill-up-failure-case');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skill-up-failure-'));
}

test('a negative signal writes a private case and does not invent a pass rate', () => {
  const feedbackDir = tempDir();
  const secret = 'sk_live_' + 'abc123456789';
  const event = {
    id: 'fb_example_1',
    signal: 'negative',
    context: `Prep attached the wrong window. Token ${secret}. Mail ada@example.com.`,
    whatWentWrong: 'A terminal window was used as the meeting photo.',
    whatToChange: 'Use a calendar window.',
    lastAction: { tool: 'renderBrief', file: 'web/index.html' },
  };
  const recorded = gate.recordFailureCase(event, { feedbackDir });
  assert.equal(recorded.wrote, true);
  assert.equal(recorded.decision, 'keep_original');
  assert.equal(recorded.graded, false);
  assert.equal(recorded.originalPassRate, undefined);
  const yaml = fs.readFileSync(recorded.path, 'utf8');
  assert.match(yaml, /A terminal window was used as the meeting photo/);
  assert.match(yaml, /Use a calendar window/);
  assert.match(yaml, /web\/index\.html/);
  assert.match(yaml, /decision: keep_original/);
  assert.match(yaml, /state: candidate_pending_approval/);
  assert.match(yaml, /with_skill: pending/);
  assert.match(yaml, /without_skill: pending/);
  assert.equal(yaml.includes(secret), false);
  assert.equal(yaml.includes('ada@example.com'), false);
  assert.equal(yaml.includes('0.96'), false);
  assert.equal(yaml.includes('0.58'), false);
  assert.equal(fs.statSync(recorded.path).mode & 0o777, 0o600);
  assert.equal(recorded.path.startsWith(path.join(feedbackDir, 'skill-up-cases') + path.sep), true);
  fs.rmSync(feedbackDir, { recursive: true, force: true });
});

test('a positive signal and a repo-root directory do not write a case', () => {
  const outside = tempDir();
  const positive = gate.recordFailureCase({
    id: 'fb_up',
    signal: 'positive',
    context: 'The calendar photo loaded.',
  }, { feedbackDir: outside });
  assert.equal(positive.wrote, false);
  assert.equal(fs.existsSync(path.join(outside, 'skill-up-cases')), false);

  const refused = gate.recordFailureCase({
    id: 'fb_repo',
    signal: 'negative',
    context: 'Do not write this into the repository.',
    whatWentWrong: 'repo write',
  }, { feedbackDir: ROOT });
  assert.equal(refused.wrote, false);
  assert.equal(refused.decision, 'keep_original');
  assert.equal(fs.existsSync(path.join(ROOT, 'skill-up-cases')), false);
  fs.rmSync(outside, { recursive: true, force: true });
});

test('failure text is graded before success text, and a bare pass rate cannot promote', () => {
  const spec = {
    id: 'case-photo',
    forbiddenPatterns: ['terminal window'],
    requiredSubstrings: ['calendar window'],
    expectedFiles: ['web/index.html'],
  };
  const failed = gate.gradeLocalCase(spec, {
    responseText: 'Attached a terminal window and a calendar window.',
    workspaceFiles: ['web/index.html'],
  });
  assert.equal(failed.verdict, 'FAIL');
  assert.equal(failed.reason, 'forbidden_pattern');

  const passed = gate.gradeLocalCase(spec, {
    responseText: 'Attached a calendar window.',
    workspaceFiles: ['web/index.html'],
  });
  assert.equal(passed.verdict, 'PASS');

  const invented = gate.decideEvolution({
    withSkillPassRate: 0.96,
    withoutSkillPassRate: 0.58,
    candidatePassRate: 0.99,
  });
  assert.equal(invented.decision, 'keep_original');
  assert.equal(invented.graded, false);
  assert.equal(invented.candidatePassRate, null);

  const original = [failed];
  const without = [gate.gradeLocalCase(spec, { responseText: 'No photo.', workspaceFiles: [] })];
  const candidate = [passed];
  const promoted = gate.decideEvolution({
    originalCases: original,
    withoutSkillCases: without,
    candidateCases: candidate,
  });
  assert.equal(promoted.decision, 'promote_candidate');
  assert.equal(promoted.originalPassRate, 0);
  assert.equal(promoted.withoutSkillPassRate, 0);
  assert.equal(promoted.candidatePassRate, 1);

  const skillDidNotHelp = gate.decideEvolution({
    originalCases: original,
    withoutSkillCases: candidate,
    candidateCases: candidate,
  });
  assert.equal(skillDidNotHelp.decision, 'keep_original');
  assert.equal(skillDidNotHelp.candidatePassRate, 1);
  assert.equal(skillDidNotHelp.withoutSkillPassRate, 1);
});

test('captureFeedback stores the case on a thumbs-down and skips it on a thumbs-up', () => {
  const feedbackDir = tempDir();
  const previous = process.env.THUMBGATE_FEEDBACK_DIR;
  const previousTelemetry = process.env.THUMBGATE_DISABLE_TELEMETRY;
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  process.env.THUMBGATE_DISABLE_TELEMETRY = '1';
  delete require.cache[require.resolve('../scripts/skill-up-failure-case')];
  delete require.cache[require.resolve('../scripts/feedback-loop')];
  const { captureFeedback } = require('../scripts/feedback-loop');
  try {
    const down = captureFeedback({
      signal: 'negative',
      context: 'The meeting card used a terminal file as the photo.',
      whatWentWrong: 'A terminal window was used as the meeting photo.',
      whatToChange: 'Use a calendar window.',
      lastAction: { tool: 'renderBrief', file: 'web/index.html' },
      tags: ['testing'],
    });
    assert.equal(down.feedbackEvent.reproducibleCase.decision, 'keep_original');
    assert.equal(down.feedbackEvent.reproducibleCase.graded, false);
    assert.equal(down.feedbackEvent.reproducibleCase.wrote, true);
    const saved = fs.readFileSync(down.feedbackEvent.reproducibleCase.path, 'utf8');
    assert.match(saved, /decision: keep_original/);
    assert.equal(saved.includes('0.96'), false);

    const up = captureFeedback({
      signal: 'positive',
      context: 'The calendar photo loaded on the meeting card.',
      whatWorked: 'Only the calendar window was shown.',
      tags: ['testing'],
    });
    assert.equal(up.feedbackEvent.reproducibleCase, undefined);
    const names = fs.readdirSync(path.join(feedbackDir, 'skill-up-cases'));
    assert.equal(names.length, 1);
  } finally {
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    if (previous === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = previous;
    if (previousTelemetry === undefined) delete process.env.THUMBGATE_DISABLE_TELEMETRY;
    else process.env.THUMBGATE_DISABLE_TELEMETRY = previousTelemetry;
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});
