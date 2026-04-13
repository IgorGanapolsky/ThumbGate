'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_ENDPOINT_URL,
  REQUIRED_EVENTS,
  assertLiveStripeKey,
  encodeForm,
  findSameUrlEndpoints,
  redact,
} = require('../scripts/rotate-stripe-webhook-secret');

test('stripe webhook rotation form encoding keeps array fields compatible with Stripe', () => {
  const encoded = encodeForm({
    url: DEFAULT_ENDPOINT_URL,
    enabled_events: REQUIRED_EVENTS,
    description: 'ThumbGate billing webhook',
  });

  assert.match(encoded, /url=https%3A%2F%2Fthumbgate-production\.up\.railway\.app%2Fv1%2Fbilling%2Fwebhook/);
  assert.match(encoded, /enabled_events%5B%5D=checkout\.session\.completed/);
  assert.match(encoded, /enabled_events%5B%5D=customer\.subscription\.deleted/);
  assert.match(encoded, /description=ThumbGate%20billing%20webhook/);
});

test('stripe webhook rotation refuses non-live keys by default', () => {
  assert.doesNotThrow(() => assertLiveStripeKey('sk_live_example'));
  assert.throws(() => assertLiveStripeKey('sk_test_example'), /non-live Stripe key/);
  assert.doesNotThrow(() => assertLiveStripeKey('sk_test_example', false));
});

test('stripe webhook rotation finds enabled endpoints for the exact billing URL only', () => {
  const endpoints = [
    { id: 'we_keep', url: DEFAULT_ENDPOINT_URL, status: 'enabled' },
    { id: 'we_disabled', url: DEFAULT_ENDPOINT_URL, status: 'disabled' },
    { id: 'we_other', url: 'https://example.com/webhook', status: 'enabled' },
    { id: 'we_new', url: DEFAULT_ENDPOINT_URL, status: 'enabled' },
  ];

  assert.deepEqual(
    findSameUrlEndpoints(endpoints, DEFAULT_ENDPOINT_URL, 'we_new').map((endpoint) => endpoint.id),
    ['we_keep'],
  );
});

test('stripe webhook rotation redacts secret material from errors', () => {
  assert.equal(redact('failed with sk_live_abc123 and whsec_def456'), 'failed with [REDACTED] and [REDACTED]');
});
