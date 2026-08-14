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

test('RFC 3339 timestamps require timezone offset or Z', () => {
  const { parseRfc3339Ms, semanticErrors } = require('../scripts/provider-attestation-conformance');
  assert.equal(Number.isNaN(parseRfc3339Ms('2026-08-14T12:00:30.000')), true);
  assert.equal(Number.isFinite(parseRfc3339Ms('2026-08-14T12:00:30.000Z')), true);
  const errors = semanticErrors({
    provider: { id: 'example-cloud' },
    reconciliationPolicy: { provider: 'example-cloud', maxWindowMs: 1000, declaredWindowMs: 1000 },
    providerEvidence: {
      windowStartedAt: '2026-08-14T12:00:00.000',
      windowClosesAt: '2026-08-14T12:00:01.000',
      observedAt: '2026-08-14T12:00:00.500',
      eventId: null,
    },
    outcome: 'not-yet-visible',
    issuedAt: '2026-08-14T12:00:00.500',
  });
  assert.ok(errors.includes('observedAt_not_rfc3339'));
  assert.ok(errors.includes('windowStartedAt_not_rfc3339'));
});

test('JCS rejects unpaired UTF-16 surrogates', () => {
  assert.throws(() => jcsCanonicalize({ value: 'bad\uD800' }), /surrogate/);
  assert.throws(() => jcsCanonicalize({ ['\uD800']: 1 }), /surrogate/);
});

test('signature must be strict Base64 Ed25519 bytes', () => {
  const suite = require('../conformance/provider-attestation/vectors.json');
  const { verifyAttestation } = require('../scripts/provider-attestation-conformance');
  const good = suite.vectors.find((vector) => vector.id === 'matched-valid-jcs').attestation;
  const polluted = {
    ...good,
    signature: {
      ...good.signature,
      value: `!!!!${good.signature.value}????`,
    },
  };
  const result = verifyAttestation(polluted, suite.publicKeyPem);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('signature_not_strict_base64'));
});

test('npm package files include verifier and normative vectors', () => {
  const pkg = require('../package.json');
  assert.ok(pkg.files.includes('scripts/provider-attestation-conformance.js'));
  assert.ok(pkg.files.includes('conformance/provider-attestation/'));
  assert.ok(pkg.files.includes('docs/specs/provider-execution-attestation-v1.md'));
});
