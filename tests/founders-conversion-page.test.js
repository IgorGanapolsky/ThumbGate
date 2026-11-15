'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-founders-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmp;
process.env.THUMBGATE_API_KEY = 'test-api-key';
process.env._TEST_API_KEYS_PATH = path.join(tmp, 'api-keys.json');

const { startServer } = require('../src/api/server');
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const foundersHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'founders.html'), 'utf8');
const diagnosticHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'diagnostic.html'), 'utf8');

let handle;
let origin = '';

test.before(async () => {
  handle = await startServer({ port: 0 });
  origin = `http://127.0.0.1:${handle.port}`;
});

test.after(async () => {
  handle.server.closeIdleConnections?.();
  handle.server.closeAllConnections?.();
  await new Promise((resolve) => handle.server.close(resolve));
});

test('founders page offers self-serve Pro with local installation and attributed checkout', () => {
  assert.match(foundersHtml, /href="\/checkout\/pro"[^>]*data-cta-id="founders_hero_pro"/);
  assert.match(foundersHtml, /__PRO_PRICE_DOLLARS__/);
  assert.match(foundersHtml, /data-founders-offer/);
  assert.match(foundersHtml, /does not include implementation services/);
  assert.match(foundersHtml, /href="\/#install"/);
  assert.match(foundersHtml, /aria-expanded="false"/);
  assert.match(foundersHtml, /no affiliation with Oceans Talent/i);
  assert.match(foundersHtml, /privacySignalOptOut/);
  assert.match(foundersHtml, /navigator.globalPrivacyControl/);
  assert.match(foundersHtml, /navigator.doNotTrack/);
  assert.match(foundersHtml, /founders_cta_click/);
  assert.match(foundersHtml, /\/v1\/telemetry\/ping/);
  assert.doesNotMatch(foundersHtml, /buy\.stripe\.com|<form|\$499|sprint_diagnostic|we refund/i);
});

test('diagnostic static artifact points to current plans without collecting payment', () => {
  assert.match(diagnosticHtml, /offer has been retired/i);
  assert.match(diagnosticHtml, /href="\/pricing"/);
  assert.match(diagnosticHtml, /name="robots" content="noindex"/);
  assert.doesNotMatch(diagnosticHtml, /<form|buy\.stripe\.com/);
});

test('GET /founders and aliases serve filled conversion HTML', async () => {
  for (const route of ['/founders', '/operators', '/founders.html', '/agent-operators']) {
    const res = await fetch(`${origin}${route}`);
    assert.equal(res.status, 200, `${route} should be 200`);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    const html = await res.text();
    assert.match(html, /\$\d+(?:\.\d+)?\/mo/);
    assert.match(html, /href="\/checkout\/pro"[^>]*data-cta-id="founders_hero_pro"/);
    assert.match(html, /founders_hero_pro/);
    assert.match(html, /canonical" href="[^"]+\/founders"/);
    assert.doesNotMatch(html, /__PRO_PRICE_DOLLARS__|\$499|<form/);
  }
});

test('GET /sitemap.xml includes /founders', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /\/founders<\/loc>/);
});

test('GET /diagnostic returns a retired offer response with current pricing', async () => {
  const res = await fetch(`${origin}/diagnostic`);
  assert.equal(res.status, 410);
  const html = await res.text();
  assert.match(html, /retired/i);
  assert.match(html, /\/pricing/);
  assert.doesNotMatch(html, /<form|buy\.stripe\.com/);
});
