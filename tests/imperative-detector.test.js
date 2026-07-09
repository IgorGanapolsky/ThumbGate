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
