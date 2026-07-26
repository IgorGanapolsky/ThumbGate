'use strict';

// The canary's whole job is catching the failure mode that has no error: a gate that stops
// firing. These tests drive diffDecisions() directly so they assert the detection logic
// rather than the filesystem.

const test = require('node:test');
const assert = require('node:assert');

const { diffDecisions, MIN_TRAFFIC } = require('../scripts/gate-decision-canary.js');

function baselineOf(byGate, totalBlocked, totalWarned = 0) {
  return { recordedAtMs: 0, totalBlocked, totalWarned, byGate };
}

test('a gate that goes silent is reported as a possible bypass', () => {
  const baseline = baselineOf({ 'git-reset-hard': { blocked: 100, warned: 0 } }, 100);
  const current = { blocked: 100, warned: 500, byGate: { 'git-reset-hard': { blocked: 100, warned: 0 } } };

  const result = diffDecisions(baseline, current);
  assert.equal(result.evaluated, true);
  const silent = result.findings.filter((f) => f.kind === 'silent');
  assert.equal(silent.length, 1);
  assert.equal(silent[0].gate, 'git-reset-hard');
});

test('a gate still firing proportionally is not reported', () => {
  const baseline = baselineOf({ 'git-reset-hard': { blocked: 100, warned: 0 } }, 100);
  const current = { blocked: 150, warned: 400, byGate: { 'git-reset-hard': { blocked: 150, warned: 0 } } };

  const result = diffDecisions(baseline, current);
  assert.deepEqual(result.findings.filter((f) => f.kind === 'silent'), []);
});

test('a low-volume gate going quiet is treated as noise, not signal', () => {
  // Below MIN_BASELINE_BLOCKS: absence here means nothing.
  const baseline = baselineOf({ 'rare-gate': { blocked: 3, warned: 0 } }, 3);
  const current = { blocked: 3, warned: 500, byGate: { 'rare-gate': { blocked: 3, warned: 0 } } };

  const result = diffDecisions(baseline, current);
  assert.deepEqual(result.findings, []);
});

test('a gate taking a much larger share of blocks is reported as a spike', () => {
  const baseline = baselineOf({
    'noisy-gate': { blocked: 10, warned: 0 },
    'other-gate': { blocked: 90, warned: 0 },
  }, 100);
  // noisy-gate goes from 10% of blocks to ~99%.
  const current = {
    blocked: 300,
    warned: 0,
    byGate: {
      'noisy-gate': { blocked: 208, warned: 0 },
      'other-gate': { blocked: 92, warned: 0 },
    },
  };

  const result = diffDecisions(baseline, current);
  const spikes = result.findings.filter((f) => f.kind === 'spike');
  assert.equal(spikes.length, 1);
  assert.equal(spikes[0].gate, 'noisy-gate');
});

test('a gate that vanishes from the config entirely is reported', () => {
  const baseline = baselineOf({ 'removed-gate': { blocked: 80, warned: 0 } }, 80);
  const current = { blocked: 80, warned: 500, byGate: {} };

  const result = diffDecisions(baseline, current);
  assert.ok(result.findings.some((f) => f.kind === 'disappeared' && f.gate === 'removed-gate'));
});

test('no verdict is issued below the traffic floor', () => {
  const baseline = baselineOf({ 'git-reset-hard': { blocked: 100, warned: 0 } }, 100);
  const current = { blocked: 100, warned: 1, byGate: { 'git-reset-hard': { blocked: 100, warned: 0 } } };

  const result = diffDecisions(baseline, current);
  assert.equal(result.evaluated, false, 'must not cry drift on a handful of events');
  assert.deepEqual(result.findings, []);
  assert.ok(result.traffic < MIN_TRAFFIC);
});

test('the real 2026-07-26 shape is caught: all four catastrophic gates go silent', () => {
  // What a shipped bypass actually looked like: the gates were configured, the system kept
  // running, and enforcement simply stopped. No error was raised anywhere.
  const gates = ['git-reset-hard', 'git-clean-force', 'force-push', 'rm-rf-home-or-root'];
  const byGate = Object.fromEntries(gates.map((g) => [g, { blocked: 50, warned: 0 }]));
  const baseline = baselineOf(byGate, 200);
  const current = { blocked: 200, warned: 900, byGate };

  const result = diffDecisions(baseline, current);
  const silent = result.findings.filter((f) => f.kind === 'silent').map((f) => f.gate).sort();
  assert.deepEqual(silent, gates.slice().sort(), 'every silenced gate must be named');
});
