'use strict';

// One corrupt entry in the feedback store hard-blocked every action in the repo.
//
// On 2026-08-06 a truncated hook payload leaked into the store and was admitted
// as a "recurring negative pattern" with count 6. Its keywords were the payload's
// own FIELD NAMES — workspaceroot, workspace, thumbgate — which appear in every
// payload this agent ever sends. "workspaceroot" is long enough that
// isSpecificKeyword() treats it as decisive on its own, so a SINGLE hit produced
// a hard deny on every Bash call, including the ones needed to diagnose it.
// The gate blocked 20 times and warned zero times.
//
// A pattern learned from the transport rather than from the mistake cannot
// discriminate, and a guard that matches everything protects nothing.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  keywords,
  looksLikeSerializedFragment,
  evaluatePretoolFromState,
} = require('../scripts/hybrid-feedback-context');

// The exact fragment from the incident, as it appeared in the gate's own output.
const CORRUPT = '{ , , ,"workspaceroot":"/users/redacted/workspace/git/igor/thumbgate/", , , ,"pe"';

// A representative command payload — every tool call in the repo looks like this.
const ORDINARY_ACTION = JSON.stringify({
  command: 'node scripts/patch.js scripts/gates-engine.js',
  workspaceRoot: '/Users/redacted/workspace/git/igor/ThumbGate/',
});

test('the corrupt fragment is recognised as a serialized payload, not a lesson', () => {
  assert.equal(looksLikeSerializedFragment(CORRUPT), true);
});

test('real prose lessons are not mistaken for fragments', () => {
  // The filter must not swallow genuine lessons, or it silently disarms the guard.
  for (const lesson of [
    'never force-push to main',
    'Do not claim a deploy is complete without curl output showing the buildSha.',
    'Agent ran rm -rf on a tracked directory instead of the build output.',
  ]) {
    assert.equal(looksLikeSerializedFragment(lesson), false, `misclassified: ${lesson}`);
  }
});

test('envelope field names never become pattern keywords', () => {
  const words = keywords(CORRUPT);
  for (const banned of ['workspaceroot', 'workspace', 'thumbgate', 'users']) {
    assert.equal(
      words.includes(banned),
      false,
      `"${banned}" describes the transport, not the mistake — it matches every action`,
    );
  }
});

test('the corrupt pattern no longer blocks an ordinary command', () => {
  // Reproduces the live path exactly: state carries the pattern, words are derived
  // by keywords() as the builder does, and the haystack is a normal tool call.
  const state = {
    recurringNegativePatterns: [{ text: CORRUPT, words: keywords(CORRUPT), count: 6 }],
    negativeToolCounts: {},
    negativeToolCountsAttributed: {},
  };

  const verdict = evaluatePretoolFromState(state, 'Bash', ORDINARY_ACTION);

  assert.notEqual(
    verdict.mode,
    'block',
    `an unrelated command must not be denied by a transport artifact (reason: ${verdict.reason})`,
  );
});

test('a genuine recurring pattern still blocks the action it describes', () => {
  // The whole point of the guard must survive the fix.
  const lesson = 'agent ran destructive rm -rf against a tracked source directory';
  const state = {
    recurringNegativePatterns: [{ text: lesson, words: keywords(lesson), count: 6 }],
    negativeToolCounts: {},
    negativeToolCountsAttributed: {},
  };

  const verdict = evaluatePretoolFromState(
    state,
    'Bash',
    JSON.stringify({ command: 'rm -rf ./src --destructive tracked directory' }),
  );

  assert.equal(verdict.mode, 'block', `expected a real pattern to still block (got: ${verdict.reason})`);
});
