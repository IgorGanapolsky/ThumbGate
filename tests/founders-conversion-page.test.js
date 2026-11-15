'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-founders-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmp;
process.env.THUMBGATE_API_KEY = 'test-api-key';
process.env.THUMBGATE_PRO_PRICE_DOLLARS = '37';
// A stale descriptive label must not override the configured checkout amount.
process.env.THUMBGATE_PRO_PRICE_LABEL = '$19/month or $149/year';
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

test('founders page offers configured self-serve Pro with attributable checkout', () => {
  assert.match(foundersHtml, /href="\/checkout\/pro"/);
  assert.match(foundersHtml, /__PRO_PRICE_DOLLARS__/);
  assert.match(foundersHtml, /\$__PRO_PRICE_DOLLARS__\/mo/);
  assert.match(foundersHtml, /utm_campaign', 'oceans_inspired_conversion'/);
  assert.match(foundersHtml, /founders_hero_pro/);
  assert.match(foundersHtml, /landing_path', '\/founders'/);
  assert.match(foundersHtml, /Put checks before your agents act/);
  assert.match(foundersHtml, /data-founders-offer/);
  assert.match(foundersHtml, /Configure, verify, then use/);
  assert.match(foundersHtml, /this subscription does not include implementation services/i);
  assert.doesNotMatch(foundersHtml, /sprint_diagnostic|diagnostic-pay|\$499/);
  assert.match(foundersHtml, /no affiliation with Oceans Talent/i);
  assert.match(foundersHtml, /"@type":\s*"FAQPage"/);
  assert.match(foundersHtml, /"@type":\s*"SoftwareApplication"/);
  assert.match(foundersHtml, /isAiventyxTraffic/);
  assert.match(foundersHtml, /founders_cta_click/);
  assert.match(foundersHtml, /\/v1\/telemetry\/ping/);
  assert.doesNotMatch(foundersHtml, /buy\.stripe\.com/);
});

test('diagnostic page offers current plans without service sales or raw Stripe links', () => {
  assert.match(diagnosticHtml, /This offer has been retired/);
  assert.match(diagnosticHtml, /free local CLI and self-serve Pro/);
  assert.match(diagnosticHtml, /href="\/pricing"/);
  assert.doesNotMatch(diagnosticHtml, /<form|\/go\/diagnostic-pay|\$499|data-oceans-|buy\.stripe\.com/);
});

test('GET /founders and aliases serve filled conversion HTML', async () => {
  for (const route of ['/founders', '/operators', '/founders.html', '/agent-operators']) {
    const res = await fetch(`${origin}${route}`);
    assert.equal(res.status, 200, `${route} should be 200`);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    const html = await res.text();
    assert.match(html, /self-serve/i);
    assert.match(html, /href="\/checkout\/pro"/);
    assert.match(html, /founders_hero_pro/);
    const visibleHtml = html.replace(/<script[\s\S]*?<\/script>/g, '');
    assert.ok((visibleHtml.match(/\$37\/mo/g) || []).length >= 3,
      'nav, hero, and bottom CTA must use the configured monthly amount');
    assert.doesNotMatch(visibleHtml, /\$19|\$149/);
    const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(schema['@graph'].find((item) => item['@type'] === 'SoftwareApplication').offers.price, '37');
    assert.match(html, /canonical" href="[^"]+\/founders"/);
    assert.doesNotMatch(html, /__PRO_PRICE_DOLLARS__|__PRO_PRICE_LABEL__|__SPRINT_DIAGNOSTIC_PRICE_DOLLARS__/);
  }
});

test('GET /sitemap.xml includes /founders', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /\/founders<\/loc>/);
});

test('GET /diagnostic returns retirement without a checkout surface', async () => {
  const res = await fetch(`${origin}/diagnostic`);
  assert.equal(res.status, 410);
  assert.deepEqual(await res.json(), {
    error: 'This offer has been retired.',
    pricingUrl: '/pricing',
  });
});
