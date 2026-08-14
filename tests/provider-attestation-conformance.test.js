'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  jcsCanonicalize,
  runConformance,
  semanticErrors,
} = require('../scripts/provider-attestation-conformance');

test('JCS canonicalization sorts object keys and preserves array order', () => {
  assert.equal(
    jcsCanonicalize({ z: 1, a: ['second', { y: true, x: null }] }),
    '{"a":["second",{"x":null,"y":true}],"z":1}',
  );
});

test('JCS canonicalization rejects non-finite numbers', () => {
  assert.throws(() => jcsCanonicalize({ value: Number.NaN }), /non-finite/);
  assert.throws(() => jcsCanonicalize({ value: Number.POSITIVE_INFINITY }), /non-finite/);
});

test('normative provider attestation vectors all conform', () => {
  const result = runConformance();
  assert.equal(result.count, 7);
  assert.equal(result.passed, true, JSON.stringify(result.results, null, 2));
});

test('holder cannot widen the gate-owned provider window', () => {
  const errors = semanticErrors({
    provider: { id: 'example-cloud' },
    reconciliationPolicy: {
      provider: 'example-cloud',
      maxWindowMs: 1000,
      declaredWindowMs: 2000,
    },
    providerEvidence: {
      windowStartedAt: '2026-08-14T12:00:00.000Z',
      windowClosesAt: '2026-08-14T12:00:02.000Z',
      observedAt: '2026-08-14T12:00:00.500Z',
      eventId: null,
    },
    outcome: 'not-yet-visible',
  });
  assert.ok(errors.includes('holder_window_exceeds_gate_maximum'));
});

test('absence and eventual-consistency states remain distinct', () => {
  const earlyAbsence = semanticErrors({
    provider: { id: 'example-cloud' },
    reconciliationPolicy: { provider: 'example-cloud', maxWindowMs: 1000, declaredWindowMs: 1000 },
    providerEvidence: {
      windowStartedAt: '2026-08-14T12:00:00.000Z',
      windowClosesAt: '2026-08-14T12:00:01.000Z',
      observedAt: '2026-08-14T12:00:00.999Z',
      eventId: null,
    },
    outcome: 'absent-after-window',
  });
  assert.ok(earlyAbsence.includes('absence_claimed_before_window_closed'));
});
