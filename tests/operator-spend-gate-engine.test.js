#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-spend-engine-'));
process.env.THUMBGATE_SPEND_LEDGER = path.join(tmp, 'commitments.jsonl');
// Keep default warn posture — spend gate must still hard-deny.
delete process.env.THUMBGATE_STRICT_ENFORCEMENT;

const {
  evaluateGates,
  evaluateOperatorSpendGate,
  applyEnforcementPosture,
} = require('../scripts/gates-engine');

test.after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('evaluateOperatorSpendGate denies upgrade without auth', () => {
  const r = evaluateOperatorSpendGate('Bash', {
    command: 'open https://app.apollo.io and upgrade plan buy credits',
  });
  assert.ok(r);
  assert.equal(r.decision, 'deny');
  assert.equal(r.gate, 'operator-spend-gate');
  assert.equal(r.severity, 'critical');
});

test('evaluateOperatorSpendGate allows refund', () => {
  const r = evaluateOperatorSpendGate('Bash', {
    command: 'curl mailto:support for refund and cancel plan',
  });
  assert.equal(r, null);
});

test('applyEnforcementPosture never warn-downgrades operator-spend-gate', () => {
  const denied = {
    decision: 'deny',
    gate: 'operator-spend-gate',
    message: 'spend blocked',
    severity: 'critical',
  };
  const out = applyEnforcementPosture(denied);
  assert.equal(out.decision, 'deny');
  assert.equal(out.warnByDefault, undefined);
});

test('evaluateGates hard-denies spend bash under warn-by-default posture', () => {
  const r = evaluateGates('Bash', {
    command: 'echo upgrade plan buy credits apollo basic',
  });
  assert.ok(r, 'expected a gate result');
  assert.equal(r.decision, 'deny');
  assert.equal(r.gate, 'operator-spend-gate');
});

test('evaluateGates allows authorized spend when message carries amount', () => {
  const r = evaluateGates('Bash', {
    command: 'buy credits $5',
    operatorMessage: 'I authorize spend $5 on Apollo credits',
  });
  // May be null (allow) or some other unrelated gate — must not be operator-spend deny
  if (r) {
    assert.notEqual(r.gate, 'operator-spend-gate');
  }
});
