'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectImperative, suggestForceGate } = require('../scripts/imperative-detector');

test('detects a leading "never" imperative', () => {
  const d = detectImperative('never force-push to main again');
  assert.equal(d.isImperative, true);
  assert.equal(d.polarity, 'never');
});

test('detects "don\'t" / "do not" / "stop" as never-directives', () => {
  for (const t of ["don't deploy on friday", 'do not skip the tests', 'stop claiming done without checking']) {
    assert.equal(detectImperative(t).polarity, 'never', `expected never for: ${t}`);
  }
});

test('detects a leading "always" imperative', () => {
  const d = detectImperative('always verify before claiming done');
  assert.equal(d.isImperative, true);
  assert.equal(d.polarity, 'always');
});

test('detects a clause-initial directive after punctuation', () => {
  assert.equal(detectImperative('the deploy broke prod, never ship on friday').polarity, 'never');
});

test('strips feedback prefixes/quotes so "❯ never …" still matches', () => {
  assert.equal(detectImperative('❯ never run rm -rf on the repo').polarity, 'never');
  assert.equal(detectImperative('"always run npm test first"').polarity, 'always');
});

test('non-directive feedback returns isImperative false', () => {
  for (const t of ['that broke the build', 'the output looked good', 'clevер naming', '', null]) {
    assert.equal(detectImperative(t).isImperative, false, `expected non-directive for: ${JSON.stringify(t)}`);
  }
});

test('down + "never" OFFERS a force-gate with a runnable command', () => {
  const s = suggestForceGate({ signal: 'down', text: 'never force-push to main' });
  assert.ok(s);
  assert.equal(s.kind, 'force-gate-offer');
  assert.match(s.message, /npx thumbgate force-gate/);
  assert.match(s.message, /--action=block/);
  // it OFFERS, it does not claim to have blocked
  assert.ok(!/blocked|has been blocked|now blocking/i.test(s.message));
});

test('the offered command is shell-safe (no embedded double-quotes)', () => {
  const s = suggestForceGate({ signal: 'down', text: 'never run "DROP TABLE users" on prod' });
  const cmd = s.message.split('\n').find((l) => l.includes('force-gate'));
  const inner = cmd.slice(cmd.indexOf('--context="') + 11);
  const ctx = inner.slice(0, inner.indexOf('" --action'));
  assert.ok(!ctx.includes('"'), 'context value must not contain a double-quote that breaks the arg');
});

test('up + "always" clarifies guidance-only (no force-gate, no false enforcement claim)', () => {
  const s = suggestForceGate({ signal: 'up', text: 'always run the proof suite' });
  assert.ok(s);
  assert.equal(s.kind, 'always-note');
  assert.match(s.message, /guidance/i);
  assert.ok(!/force-gate|blocked/i.test(s.message), 'positive patterns are not gate-enforced');
});

test('down WITHOUT a directive offers nothing', () => {
  assert.equal(suggestForceGate({ signal: 'down', text: 'the build failed and I was annoyed' }), null);
});

test('up + "never" does NOT offer a force-gate (you do not block good actions)', () => {
  // A "never" on a thumbs-UP is contradictory; no force-gate offer.
  assert.equal(suggestForceGate({ signal: 'up', text: 'never mind, this worked great' }), null);
});

// ================================================================
// Integration tests: processInlineFeedback → suggestForceGate chain
// Proves the offer actually reaches the operator through the shipped
// code path (scripts/cli-feedback.js), and that NO gate is written.
// ================================================================

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { processInlineFeedback, formatCliOutput } = require('../scripts/cli-feedback');

function makeTmpFeedbackDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tg-imperative-'));
}

function countGateFiles(dir) {
  let count = 0;
  const candidates = ['gates.jsonl', 'synthesized-rules.jsonl', 'active-gates.json'];
  for (const file of candidates) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (!raw) continue;
      count += file.endsWith('.json')
        ? (Array.isArray(JSON.parse(raw)) ? JSON.parse(raw).length : 1)
        : raw.split(/\r?\n/).filter(Boolean).length;
    }
  }
  return count;
}

test('processInlineFeedback: down + "never" surfaces force-gate offer in result', () => {
  const dir = makeTmpFeedbackDir();
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  try {
    const result = processInlineFeedback({
      signal: 'down',
      context: 'Agent force-pushed to main',
      whatWentWrong: 'NEVER force-push to main again',
    });
    assert.ok(result.feedbackResult.accepted !== false, 'feedback should be accepted');
    assert.ok(result.forceGateHint, 'forceGateHint must be present for an imperative');
    assert.equal(result.forceGateHint.kind, 'force-gate-offer');
    assert.match(result.forceGateHint.message, /npx thumbgate force-gate/);
    // Must NOT claim to have already blocked
    assert.ok(!/blocked|has been blocked|now blocking/i.test(result.forceGateHint.message));
  } finally {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('processInlineFeedback: down + "always" produces NO offer (ambiguous on negative)', () => {
  const dir = makeTmpFeedbackDir();
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  try {
    const result = processInlineFeedback({
      signal: 'down',
      context: 'Shipping untested code',
      whatWentWrong: 'Always run the full test suite before merge',
    });
    // "always" on a thumbs-DOWN is a corrective wish, not a positive note.
    // The always-note path fires only on thumbs-up. No offer here.
    assert.equal(result.forceGateHint, null);
  } finally {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('processInlineFeedback: vague down (no imperative) produces NO offer', () => {
  const dir = makeTmpFeedbackDir();
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  try {
    const result = processInlineFeedback({
      signal: 'down',
      context: 'Agent usually avoids force-push',
      whatWentWrong: 'It did it anyway this time, be more careful',
    });
    assert.equal(result.forceGateHint, null, 'no imperative → no offer');
  } finally {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('formatCliOutput: renders the imperative offer line for the operator', () => {
  const dir = makeTmpFeedbackDir();
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  try {
    const result = processInlineFeedback({
      signal: 'down',
      context: 'Agent dropped the production database',
      whatWentWrong: 'NEVER run DROP TABLE on production',
    });
    const output = formatCliOutput(result);
    assert.match(output, /💡/, 'offer should be rendered with the hint marker');
    assert.match(output, /npx thumbgate force-gate/, 'output must contain the runnable command');
  } finally {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('CRITICAL: imperative capture writes NO gate file (no silent enforcement)', () => {
  const dir = makeTmpFeedbackDir();
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  try {
    const before = countGateFiles(dir);
    const result = processInlineFeedback({
      signal: 'down',
      context: 'Agent force-pushed to main',
      whatWentWrong: 'NEVER force-push to main again under any circumstances',
    });
    const after = countGateFiles(dir);
    assert.ok(result.forceGateHint, 'offer should be present');
    assert.equal(after, before,
      'a single imperative capture must NOT write a gate — the operator confirms explicitly');
  } finally {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});
