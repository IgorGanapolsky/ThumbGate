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

test('founders page is an Oceans-style landing whose CTAs request a team pilot', () => {
  // The $499 diagnostic checkout (/go/diagnostic-pay) is retired and answers 410, so the page takes no payment.
  assert.doesNotMatch(foundersHtml, /\/go\/diagnostic-pay|name="customer_email"|name="plan_id" value="sprint_diagnostic"|data-founders-pay-form|__SPRINT_DIAGNOSTIC_PRICE_DOLLARS__|\$499/);
  assert.match(foundersHtml, /href="\/pilot\?utm_source=founders&amp;utm_medium=owned_page&amp;utm_campaign=oceans_inspired_conversion&amp;cta_id=founders_hero_pilot"[^>]*>Request a team pilot</);
  assert.match(foundersHtml, /href="\/pilot\?utm_source=founders&amp;cta_id=founders_bottom_buy"/);
  assert.match(foundersHtml, /Scale agent impact/);
  assert.match(foundersHtml, /data-founders-offer/);
  assert.match(foundersHtml, /table class="compare"/);
  assert.match(foundersHtml, /No payment taken/);
  assert.doesNotMatch(foundersHtml, /we refund|Refund if not a supported fit/i);
  assert.match(foundersHtml, /no affiliation with Oceans Talent/i);
  assert.match(foundersHtml, /"@type": "FAQPage"/);
  assert.match(foundersHtml, /"@type": "SoftwareApplication"/);
  assert.match(foundersHtml, /founders_cta_click/);
  assert.match(foundersHtml, /\/v1\/telemetry\/ping/);
  assert.doesNotMatch(foundersHtml, /buy\.stripe\.com/);
});

test('diagnostic page steals high-ROI Oceans conversion blocks without raw Stripe links', () => {
  assert.match(diagnosticHtml, /data-oceans-pain/);
  assert.match(diagnosticHtml, /data-oceans-process/);
  assert.match(diagnosticHtml, /data-oceans-compare/);
  assert.match(diagnosticHtml, /data-oceans-faq/);
  assert.match(diagnosticHtml, /You didn't hire AI agents to manage calendars of incidents/);
  assert.match(diagnosticHtml, /wrong fit|we refund/i);
  assert.match(diagnosticHtml, /href="\/founders/);
  assert.doesNotMatch(diagnosticHtml, /buy\.stripe\.com/);
});

test('GET /founders and aliases serve filled conversion HTML', async () => {
  for (const route of ['/founders', '/operators', '/founders.html', '/agent-operators']) {
    const res = await fetch(`${origin}${route}`);
    assert.equal(res.status, 200, `${route} should be 200`);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    const html = await res.text();
    // The $499 Setup Sprint is retired (its checkout answers 410); pages offer the request-only team pilot.
    assert.match(html, /team pilot/i);
    assert.doesNotMatch(html, /\$499|Setup Sprint/);
    assert.doesNotMatch(html, /\/go\/diagnostic-pay/);
    assert.match(html, /founders_hero_pilot/);
    assert.match(html, /canonical" href="[^"]+\/founders"/);
    assert.doesNotMatch(html, /__SPRINT_DIAGNOSTIC_PRICE_DOLLARS__/);
  }
});

test('GET /sitemap.xml includes /founders', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /\/founders<\/loc>/);
});

test('GET /diagnostic is retired even while other founder content remains available', async () => {
  const res = await fetch(`${origin}/diagnostic`, { redirect: 'manual' });
  assert.equal(res.status, 410);
  assert.equal(res.headers.get('location'), null);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await res.json()).pricingUrl, '/pricing');
});
