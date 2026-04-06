'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  normalizeOrigin,
  normalizeAbsoluteUrl,
  normalizePriceDollars,
  joinPublicUrl,
  createTraceId,
  resolveHostedBillingConfig,
} = require('../scripts/hosted-config');

describe('hosted-config', () => {
  it('normalizeOrigin strips trailing slashes and query params', () => {
    assert.strictEqual(normalizeOrigin('https://example.com/'), 'https://example.com');
    assert.strictEqual(normalizeOrigin('https://example.com/path/?q=1'), 'https://example.com/path');
  });

  it('normalizeOrigin rejects non-http protocols', () => {
    assert.strictEqual(normalizeOrigin('ftp://example.com'), '');
    assert.strictEqual(normalizeOrigin(''), '');
    assert.strictEqual(normalizeOrigin(null), '');
  });

  it('normalizePriceDollars handles valid and invalid inputs', () => {
    assert.strictEqual(normalizePriceDollars(49), 49);
    assert.strictEqual(normalizePriceDollars('99.5'), 100);
    assert.strictEqual(normalizePriceDollars(-5), null);
    assert.strictEqual(normalizePriceDollars('abc'), null);
    assert.strictEqual(normalizePriceDollars(null), null);
  });

  it('joinPublicUrl combines origin and pathname', () => {
    assert.strictEqual(joinPublicUrl('https://example.com', '/api'), 'https://example.com/api');
    assert.strictEqual(joinPublicUrl('https://example.com/', 'api'), 'https://example.com/api');
  });

  it('createTraceId generates unique prefixed IDs', () => {
    const id1 = createTraceId('test');
    const id2 = createTraceId('test');
    assert.ok(id1.startsWith('test_'));
    assert.notStrictEqual(id1, id2);
  });

  it('resolveHostedBillingConfig uses ThumbGate env names only', () => {
    const config = resolveHostedBillingConfig({}, {
      THUMBGATE_PUBLIC_APP_ORIGIN: 'https://thumbgate-production.up.railway.app',
      THUMBGATE_BILLING_API_BASE_URL: 'https://thumbgate-production.up.railway.app',
    });
    assert.strictEqual(config.appOrigin, 'https://thumbgate-production.up.railway.app');
    assert.strictEqual(config.billingApiBaseUrl, 'https://thumbgate-production.up.railway.app');
  });
});
