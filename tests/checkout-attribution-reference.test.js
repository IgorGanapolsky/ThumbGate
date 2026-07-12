'use strict';

// Guards the attribution-survival fix for EXTERNAL Stripe Payment Links: without
// this, a paid $499 diagnostic bought via utm_source=aiventyx lands as
// source=unknown and cannot be credited to the marketplace partner or reported.
// The Payment Link drops utm_* query params but preserves client_reference_id, so
// attribution rides in that field and is recovered in the webhook.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  packCheckoutReference,
  parseCheckoutReference,
} = require('../scripts/checkout-attribution-reference');

test('packs source + trace + acquisition into a stripe-safe reference', () => {
  const ref = packCheckoutReference({
    utmSource: 'aiventyx',
    traceId: 'trace-9f2c1b7e',
    acquisitionId: 'acq-4a10',
  });
  assert.equal(ref, 'tg1.aiventyx.trace-9f2c1b7e.acq-4a10');
  assert.ok(ref.length <= 200, 'stays within Stripe client_reference_id limit');
});

test('round-trips: what we pack is what the webhook recovers', () => {
  const meta = { source: 'aiventyx', traceId: 't1', acquisitionId: 'a1' };
  const parsed = parseCheckoutReference(packCheckoutReference(meta));
  assert.deepEqual(parsed, { source: 'aiventyx', traceId: 't1', acquisitionId: 'a1' });
});

test('prefers utmSource over source when both present', () => {
  const ref = packCheckoutReference({ utmSource: 'aiventyx', source: 'direct' });
  assert.equal(parseCheckoutReference(ref).source, 'aiventyx');
});

test('no source => no reference (caller appends nothing)', () => {
  assert.equal(packCheckoutReference({}), null);
  assert.equal(packCheckoutReference({ traceId: 't', acquisitionId: 'a' }), null);
});

test('rejects non-tg1 / empty / malformed references', () => {
  assert.equal(parseCheckoutReference(''), null);
  assert.equal(parseCheckoutReference(null), null);
  assert.equal(parseCheckoutReference('cus_123'), null); // a Stripe customer id
  assert.equal(parseCheckoutReference('tg1.'), null); // prefix but no source
  assert.equal(parseCheckoutReference('tg1'), null); // prefix without delimiter
});

test('sanitizes hostile input so the delimiter can never collide', () => {
  const ref = packCheckoutReference({ source: 'ai.ven tyx/../x', traceId: 'a.b.c' });
  // dots/slashes/spaces stripped from fields; delimiter dots remain structural
  const parsed = parseCheckoutReference(ref);
  assert.equal(parsed.source, 'aiventyxx');
  assert.equal(parsed.traceId, 'abc');
});

test('caps field length to avoid overflowing the reference', () => {
  const long = 'x'.repeat(500);
  const ref = packCheckoutReference({ source: long });
  assert.ok(ref.length <= 190);
  assert.ok(parseCheckoutReference(ref).source.length <= 60);
});

test('recovery scenario: empty metadata + client_reference_id => source restored', () => {
  // Mirrors the webhook: extractAttribution(session.metadata) yields no source for
  // an external Payment Link; the reference restores it.
  const attributionFromMetadata = { source: '' }; // Payment Link => empty metadata
  const clientReferenceId = packCheckoutReference({
    utmSource: 'aiventyx',
    acquisitionId: 'acq-1',
  });
  const recovered = { ...attributionFromMetadata };
  if (!recovered.source) {
    const ref = parseCheckoutReference(clientReferenceId);
    if (ref && ref.source) recovered.source = ref.source;
  }
  assert.equal(recovered.source, 'aiventyx');
});
