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

test('founders page is an Oceans-style cash-path landing with intent checkout', () => {
  assert.match(foundersHtml, /action="\/go\/diagnostic-pay" method="POST"/);
  assert.match(foundersHtml, /name="customer_email"[^>]*required/);
  assert.match(foundersHtml, /name="plan_id" value="sprint_diagnostic"/);
  assert.match(foundersHtml, /utm_campaign" value="oceans_inspired_conversion"/);
  assert.match(foundersHtml, /cta_id" value="founders_hero_paid"/);
  assert.match(foundersHtml, /landing_path" value="\/founders"/);
  assert.match(foundersHtml, /Scale agent impact/);
  assert.match(foundersHtml, /data-founders-offer/);
  assert.match(foundersHtml, /table class="compare"/);
  assert.match(foundersHtml, /we refund|Refund if not a supported fit/i);
  assert.match(foundersHtml, /no affiliation with Oceans Talent/i);
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
    assert.match(html, /\$499/);
    assert.match(html, /action="\/go\/diagnostic-pay" method="POST"/);
    assert.match(html, /founders_hero_paid/);
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

test('GET /diagnostic still checkout-ready after Oceans blocks', async () => {
  const res = await fetch(`${origin}/diagnostic`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /action="\/go\/diagnostic-pay" method="POST"/);
  assert.match(html, /data-oceans-pain/);
  assert.match(html, /data-oceans-process/);
  assert.match(html, /Buy the \$499 enterprise gate/);
});
