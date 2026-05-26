#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Hard-disable Plausible posts before requiring the module so no test
// accidentally fires a network call to plausible.io.
process.env.THUMBGATE_PLAUSIBLE_DISABLE = '1';

const {
  buildProps,
  buildPayload,
  isPlausibleDisabled,
  getPlausibleDomain,
  recordCheckoutFunnelEvent,
  plausibleEvent,
  CHECKOUT_EVENT_NAMES,
} = require('../scripts/plausible-server-events');

test('buildProps drops undefined / null / empty values', () => {
  const props = buildProps({
    a: 'x',
    b: undefined,
    c: null,
    d: '',
    e: 0,
    f: false,
  });
  assert.deepEqual(Object.keys(props).sort(), ['a', 'e', 'f']);
  assert.equal(props.a, 'x');
  assert.equal(props.e, '0');
  assert.equal(props.f, 'false');
});

test('buildProps caps each value at 100 chars', () => {
  const long = 'x'.repeat(250);
  const props = buildProps({ overflow: long });
  assert.equal(props.overflow.length, 100);
  assert.ok(props.overflow.endsWith('...'));
});

test('buildPayload composes a Plausible-API-compatible object', () => {
  const payload = buildPayload('Checkout Pro Viewed', {
    domain: 'example.test',
    page: '/checkout/pro',
    referrer: 'https://reddit.com/r/test',
    props: { traceId: 'abc', isBot: 'false' },
  });
  assert.equal(payload.name, 'Checkout Pro Viewed');
  assert.equal(payload.domain, 'example.test');
  assert.equal(payload.url, 'https://example.test/checkout/pro');
  assert.equal(payload.referrer, 'https://reddit.com/r/test');
  assert.deepEqual(payload.props, { traceId: 'abc', isBot: 'false' });
});

test('isPlausibleDisabled honors THUMBGATE_PLAUSIBLE_DISABLE and DO_NOT_TRACK', () => {
  assert.equal(isPlausibleDisabled(), true); // set at file top
  process.env.THUMBGATE_PLAUSIBLE_DISABLE = '0';
  assert.equal(isPlausibleDisabled(), false);
  process.env.DO_NOT_TRACK = '1';
  assert.equal(isPlausibleDisabled(), true);
  delete process.env.DO_NOT_TRACK;
  process.env.THUMBGATE_PLAUSIBLE_DISABLE = '1'; // restore default for other tests
});

test('getPlausibleDomain falls back to the production domain', () => {
  const prev = process.env.THUMBGATE_PLAUSIBLE_DOMAIN;
  delete process.env.THUMBGATE_PLAUSIBLE_DOMAIN;
  assert.equal(getPlausibleDomain(), 'thumbgate-production.up.railway.app');
  process.env.THUMBGATE_PLAUSIBLE_DOMAIN = 'override.example';
  assert.equal(getPlausibleDomain(), 'override.example');
  if (prev === undefined) delete process.env.THUMBGATE_PLAUSIBLE_DOMAIN;
  else process.env.THUMBGATE_PLAUSIBLE_DOMAIN = prev;
});

test('plausibleEvent short-circuits when THUMBGATE_PLAUSIBLE_DISABLE=1', async () => {
  const result = await plausibleEvent('Anything', { page: '/x' });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'disabled');
});

test('plausibleEvent rejects empty / non-string event names without throwing', async () => {
  // Temporarily clear the disabled flag so the invalid-name check fires.
  process.env.THUMBGATE_PLAUSIBLE_DISABLE = '0';
  try {
    for (const bad of ['', '   ', undefined, null]) {
      const r = await plausibleEvent(bad, {});
      assert.equal(r.sent, false);
      assert.equal(r.reason, 'invalid_event_name');
    }
  } finally {
    process.env.THUMBGATE_PLAUSIBLE_DISABLE = '1'; // restore
  }
});

test('recordCheckoutFunnelEvent maps known stages to canonical names', () => {
  assert.equal(CHECKOUT_EVENT_NAMES.view, 'Checkout Pro Viewed');
  assert.equal(CHECKOUT_EVENT_NAMES.emailSubmitted, 'Checkout Pro Email Submitted');
  assert.equal(CHECKOUT_EVENT_NAMES.stripeRedirect, 'Checkout Pro Stripe Redirect Started');
  assert.equal(CHECKOUT_EVENT_NAMES.purchase, 'Checkout Pro Purchase Completed');
});

test('recordCheckoutFunnelEvent rejects unknown stage names without throwing', async () => {
  const result = await recordCheckoutFunnelEvent('nope', {});
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'unknown_stage');
});
