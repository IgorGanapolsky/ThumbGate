'use strict';

// A thumbs-down on a real tool call must become a rule. captureFeedback records the call on
// lastAction.command; the promoter used to ignore that field, fall back to the person's prose,
// and log every attempt as "skipped-inert-prose" (Igor's Mac, 2026-11-27: 3 thumbs-down, 0 rules).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-recorded-cmd-'));
const FEEDBACK = path.join(ROOT, '.thumbgate');
process.env.HOME = ROOT;
process.env.THUMBGATE_FEEDBACK_DIR = FEEDBACK;
process.env.THUMBGATE_NO_TELEMETRY = '1';
process.env.DO_NOT_TRACK = '1';

const { captureFeedback } = require('../scripts/feedback-loop');
const { loadAutoGates, promote, recordedCommand, extractExecutableAction } = require('../scripts/auto-promote-gates');

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const COMMAND = 'cd ~/workspace/ThumbGate && gh pr merge 5213 --squash --admin --delete-branch';
const PROSE = 'You merged with --admin and skipped the review the branch rules ask for. Never bypass branch protection.';

test('the recorded tool call is the executable action, not the prose', () => {
  const entry = { context: PROSE, lastAction: { tool: 'Bash', command: COMMAND } };
  assert.equal(recordedCommand(entry), COMMAND);
  assert.equal(extractExecutableAction(entry), COMMAND);
  assert.equal(recordedCommand({ context: PROSE }), null);
});

test('one thumbs-down on a recorded command makes an active warn rule that matches the command', () => {
  const captured = captureFeedback({
    signal: 'down',
    context: PROSE,
    whatWentWrong: PROSE,
    whatToChange: 'Open the PR and let the ship gate merge it',
    lastAction: { tool: 'Bash', command: COMMAND },
    tags: ['branch-protection'],
  });
  assert.equal(captured.accepted, true);
  assert.equal(captured.gatePrompt, undefined, 'a recorded command needs no follow-up question');

  const gates = loadAutoGates({ feedbackDir: FEEDBACK }).gates;
  const gate = gates.find((g) => g.fromToolCall);
  assert.ok(gate, `rule promoted; gates=${JSON.stringify(gates.map((g) => g.id))}`);
  assert.equal(gate.active, true);
  // Law 12: one thumbs-down warns first; it hard-blocks only on repeats.
  assert.equal(gate.action, 'warn');
  assert.ok(new RegExp(gate.pattern).test(COMMAND), 'the rule fires on the same call');
  assert.equal(new RegExp(gate.pattern).test('gh pr view 5213'), false, 'and not on unrelated calls');

  // A later promotion pass must keep it, not quarantine it as English prose.
  const again = promote(path.join(FEEDBACK, 'feedback-log.jsonl'), { feedbackDir: FEEDBACK });
  assert.equal(again.promotions.some((p) => p.type === 'skipped-inert-prose' || p.type === 'quarantined-inert-prose'), false);
  assert.ok(loadAutoGates({ feedbackDir: FEEDBACK }).gates.some((g) => g.id === gate.id));
});
