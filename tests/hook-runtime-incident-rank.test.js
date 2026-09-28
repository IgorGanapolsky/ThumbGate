'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decideCursorHookAction,
  rankHarnessIncidents,
} = require('../scripts/hook-runtime');

test('internal spend gate stays warn and is not an incident', () => {
  const decision = decideCursorHookAction({
    reason: '[GATE:financial-control] Economic actions require an explicit USD budget.',
    mode: 'warn',
  });
  assert.equal(decision.action, 'warn');
  assert.equal(decision.gateId, 'financial-control');
  assert.equal(decision.effectClass, 'internal');
  assert.equal(decision.incident, false);
});

test('third-party effect denies while the hook is still in warn mode', () => {
  for (const gateId of ['secret-exfiltration', 'local-only-remote-side-effect']) {
    const decision = decideCursorHookAction({ gateId, mode: 'warn' });
    assert.equal(decision.action, 'deny', gateId);
    assert.equal(decision.effectClass, 'third-party');
    assert.equal(decision.incident, true);
  }
});

test('block mode denies an internal gate without calling it a third-party incident', () => {
  const decision = decideCursorHookAction({
    gateId: 'financial-control',
    mode: 'block',
  });
  assert.equal(decision.action, 'deny');
  assert.equal(decision.incident, false);
});

test('a sandbox escape with no third-party gate is not an incident', () => {
  const report = rankHarnessIncidents({
    stats: { byGate: { 'workflow-sentinel': { blocked: 1, warned: 0 } } },
    audit: [{
      timestamp: '2026-09-27T20:23:22.705Z',
      source: 'cursor-hook',
      mode: 'warn',
      decision: 'warn',
      shadowDecision: 'block',
      gateId: 'workflow-sentinel',
      reason: 'escaped the sandbox and stopped',
    }],
  });
  assert.equal(report.ok, true);
  assert.equal(report.incidents.length, 0);
  assert.equal(report.missed.length, 0);
});

test('a shadow-allowed secret leak with timestamp and source is a missed incident', () => {
  const report = rankHarnessIncidents({
    stats: { byGate: {} },
    audit: [{
      timestamp: '2026-09-28T14:00:00.000Z',
      source: 'cursor-hook',
      mode: 'warn',
      decision: 'warn',
      shadowDecision: 'block',
      gateId: 'hard-floor',
      reason: '[GATE:secret-exfiltration] token in command',
    }],
  });
  assert.equal(report.ok, false);
  assert.equal(report.missed.length, 1);
  assert.equal(report.missed[0].gateId, 'secret-exfiltration');
  assert.match(report.nextFix, /Deny secret-exfiltration/);
});

test('a third-party row with no timestamp is a count, not an incident', () => {
  const report = rankHarnessIncidents({
    stats: { byGate: { 'secret-exfiltration': { blocked: 16, warned: 0 } } },
    audit: [{
      source: 'cursor-hook',
      mode: 'block',
      decision: 'deny',
      gateId: 'secret-exfiltration',
    }],
  });
  assert.equal(report.incidents.length, 0);
  assert.equal(report.ranked[0].blocked, 16);
  assert.equal(report.ranked[0].effectClass, 'third-party');
});

test('live counter shape leaves financial-control in warn', () => {
  const report = rankHarnessIncidents({
    stats: {
      byGate: {
        'financial-control': { blocked: 134, warned: 0 },
        'local-only-remote-side-effect': { blocked: 26, warned: 0 },
        'secret-exfiltration': { blocked: 16, warned: 0 },
        'hard-floor': { blocked: 0, warned: 1 },
      },
    },
    audit: [{
      timestamp: '2026-09-27T20:23:22.705Z',
      source: 'cursor-hook',
      mode: 'warn',
      decision: 'warn',
      shadowDecision: 'block',
      gateId: 'hard-floor',
      reason: '[GATE:financial-control] Economic actions require an explicit USD budget.',
    }],
  });
  assert.equal(report.ok, true);
  assert.equal(report.missed.length, 0);
  assert.equal(report.findings[0].id, 'telemetry-alias');
  assert.equal(report.findings[0].citations[0].timestamp, '2026-09-27T20:23:22.705Z');
  assert.match(report.nextFix, /Record financial-control/);
  assert.match(report.nextFix, /stored hard-floor/);
  assert.deepEqual(report.refuses, [
    'pip install halo-engine',
    'OTLP export to inference.net',
    'felonybench.com clone',
    'Qoder install',
  ]);
  assert.equal(report.loop[4], 're-run gate-stats --rank');
});

test('the same gate twice in one session is a rework loop', () => {
  const report = rankHarnessIncidents({
    stats: { byGate: {} },
    audit: [
      {
        timestamp: '2026-09-28T15:00:00.000Z',
        source: 'cursor-hook',
        sessionId: 's1',
        mode: 'warn',
        decision: 'warn',
        shadowDecision: 'block',
        gateId: 'financial-control',
        reason: '[GATE:financial-control] first',
      },
      {
        timestamp: '2026-09-28T15:00:05.000Z',
        source: 'cursor-hook',
        sessionId: 's1',
        mode: 'warn',
        decision: 'warn',
        shadowDecision: 'block',
        gateId: 'financial-control',
        reason: '[GATE:financial-control] retry',
      },
    ],
  });
  assert.equal(report.findings[0].id, 'rework-loop');
  assert.equal(report.findings[0].citations.length, 2);
  assert.match(report.nextFix, /financial-control fired 2 times/);
});
