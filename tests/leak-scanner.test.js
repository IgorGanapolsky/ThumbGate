'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const leakScanner = require('../scripts/leak-scanner');

test('leak-scanner: checkStripeLeak detects Stripe script, live, test and secret keys', async () => {
  const noStripe = await leakScanner.checkStripeLeak('<html><body>hello</body></html>');
  assert.equal(noStripe.hasStripe, false);
  assert.equal(noStripe.leaks.length, 0);

  const hasLib = await leakScanner.checkStripeLeak('<html><script src="https://js.stripe.com/v3/"></script></html>');
  assert.equal(hasLib.hasStripe, true);
  assert.ok(hasLib.indicators.some(i => i.includes('library loaded')));

  const hasLiveKey = await leakScanner.checkStripeLeak('const key = "pk_live_1234567890abcdef";');
  assert.equal(hasLiveKey.hasStripe, true);
  assert.ok(hasLiveKey.indicators.some(i => i.includes('Live publishable key found')));

  const hasTestKey = await leakScanner.checkStripeLeak('const key = "pk_test_1234567890abcdef";');
  assert.equal(hasTestKey.hasStripe, true);
  assert.equal(hasTestKey.leaks.length, 1);
  assert.ok(hasTestKey.leaks[0].includes('pk_test_'));

  const hasSecretKey = await leakScanner.checkStripeLeak('const key = "sk_live_1234567890abcdef";');
  assert.equal(hasSecretKey.hasStripe, true);
  assert.equal(hasSecretKey.leaks.length, 1);
  assert.ok(hasSecretKey.leaks[0].includes('CRITICAL'));
});

test('leak-scanner: fetchPage handles successful and failing fetches', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  // Successful fetch
  globalThis.fetch = async (url, options) => {
    return {
      ok: true,
      status: 200,
      text: async () => 'mocked page html'
    };
  };

  const success = await leakScanner.fetchPage('https://example.com');
  assert.equal(success.status, 200);
  assert.equal(success.content, 'mocked page html');
  assert.equal(success.error, null);

  // Unsuccessful fetch (HTTP error)
  globalThis.fetch = async (url, options) => {
    return {
      ok: false,
      status: 404
    };
  };

  const failure = await leakScanner.fetchPage('https://example.com');
  assert.equal(failure.status, 404);
  assert.equal(failure.content, null);
  assert.ok(failure.error.includes('HTTP error: 404'));

  // Thrown fetch error
  globalThis.fetch = async (url, options) => {
    throw new Error('connection refused');
  };

  const errorResult = await leakScanner.fetchPage('https://example.com');
  assert.equal(errorResult.status, null);
  assert.equal(errorResult.content, null);
  assert.equal(errorResult.error, 'connection refused');
});

test('leak-scanner: checkRedirect traces redirects and flags loops', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  // Direct 200 response
  globalThis.fetch = async (url, options) => {
    return {
      status: 200,
      headers: new Map()
    };
  };

  const noRedirect = await leakScanner.checkRedirect('https://example.com');
  assert.equal(noRedirect.status, 200);
  assert.equal(noRedirect.finalUrl, 'https://example.com');
  assert.equal(noRedirect.httpsReady, true);
  assert.equal(noRedirect.error, null);

  // Single redirect
  let callCount = 0;
  globalThis.fetch = async (url, options) => {
    callCount++;
    if (callCount === 1) {
      return {
        status: 301,
        headers: new Map([['location', 'https://example.com/dest']])
      };
    }
    return {
      status: 200,
      headers: new Map()
    };
  };

  const redirected = await leakScanner.checkRedirect('https://example.com');
  assert.equal(redirected.status, 200);
  assert.equal(redirected.finalUrl, 'https://example.com/dest');
  assert.equal(redirected.chain.length, 2);
  assert.equal(redirected.error, null);

  // Redirect loop
  globalThis.fetch = async (url, options) => {
    return {
      status: 302,
      headers: new Map([['location', url]]) // redirects to itself
    };
  };

  const loop = await leakScanner.checkRedirect('https://example.com');
  assert.equal(loop.error, 'Redirect loop detected');
});

test('leak-scanner: checkSitemap parses robots.txt and sitemap.xml', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  // Sitemap found
  globalThis.fetch = async (url, options) => {
    if (url.includes('robots.txt')) {
      return {
        ok: true,
        status: 200,
        text: async () => 'Sitemap: https://example.com/custom_sitemap.xml'
      };
    }
    if (url.includes('custom_sitemap.xml')) {
      return {
        ok: true,
        status: 200,
        text: async () => '<urlset><url><loc>https://example.com/page1</loc></url></urlset>'
      };
    }
    return { ok: false, status: 404 };
  };

  const sitemap = await leakScanner.checkSitemap('example.com');
  assert.equal(sitemap.found, true);
  assert.equal(sitemap.sitemapUrl, 'https://example.com/custom_sitemap.xml');
  assert.equal(sitemap.urlCount, 1);
  assert.deepEqual(sitemap.sampleUrls, ['https://example.com/page1']);
});

test('leak-scanner: scanTarget aggregates redirect, sitemap, and Stripe checks', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options) => {
    if (url.includes('robots.txt') || url.includes('sitemap')) {
      return { ok: false, status: 404 };
    }
    if (url.startsWith('http://')) {
      return {
        status: 301,
        headers: new Map([['location', url.replace('http://', 'https://')]])
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => '<html><body>No keys here.</body></html>'
    };
  };

  const result = await leakScanner.scanTarget('https://example.com');
  assert.equal(result.domain, 'example.com');
  assert.equal(result.sitemap.found, false);
  assert.equal(result.stripe.hasStripe, false);
  assert.ok(result.anomalies.includes('Missing sitemap: no sitemap.xml found in robots.txt or standard paths'));
});
