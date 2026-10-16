'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-operator-framework-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmp;
process.env.THUMBGATE_API_KEY = 'test-api-key';
process.env._TEST_API_KEYS_PATH = path.join(tmp, 'api-keys.json');

const { startServer } = require('../src/api/server');

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

const OFFER_ROUTES = {
  '/go/operator-diagnostic': 'https://buy.stripe.com/fZueVd9eA4r42dz7mb3sI2W', // $499 Sprint Diagnostic
  '/go/operator-turnkey': 'https://buy.stripe.com/14A8wP62o0aOcSd35V3sJ0Q', // $2,500 Turnkey Setup
  '/go/operator-retainer': 'https://buy.stripe.com/9B614n0I43n03hD35V3sJ0P', // $500/mo Managed Retainer
  '/go/operator-pro': 'https://buy.stripe.com/8x2dR91M84r4cSd9uj3sI3f', // $19/mo Pro
};

test('GET /operator-framework serves the offers, partner program, and FAQ schema', async () => {
  const res = await fetch(`${origin}/operator-framework`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const html = await res.text();

  assert.match(html, /Operator Framework/);
  for (const route of Object.keys(OFFER_ROUTES)) {
    assert.ok(html.includes(`href="${route}"`), `missing checkout link ${route}`);
  }
  assert.doesNotMatch(html, /buy\.stripe\.com/, 'payment links stay behind /go/ redirects');
  assert.match(html, /\$499/);
  assert.match(html, /\$2,500/);
  assert.match(html, /\$500<span[^>]*>\/mo/);
  assert.match(html, /\$19\/mo/);
  assert.match(html, /<h3>Managed Retainer<\/h3>\s*<div class="price">\$500<span[^>]*>\/mo/);
  assert.match(html, /<h3>Turnkey Setup<\/h3>\s*<div class="price">\$2,500</);
  assert.match(html, /<h3>Sprint Diagnostic<\/h3>\s*<div class="price">\$499</);
  assert.match(html, /<div class="pro-strip">[\s\S]*?ThumbGate Pro is \$19\/mo[\s\S]*?Get Pro · \$19\/mo/);
  assert.match(html, /VERIFICATION_EVIDENCE\.md/);
  assert.match(html, /30% revenue share/);
  assert.match(html, /mailto:iganapolsky@gmail\.com/);
  assert.match(html, /"@type":\s*"FAQPage"/);
  assert.doesNotMatch(html, /__APP_ORIGIN__/, 'template placeholders must be filled');
});

test('operator framework page avoids unverified product claims', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'operator-framework.html'), 'utf8');
  for (const banned of [/<\s*0\.5\s*ms/i, /&lt;\s*0\.5\s*ms/i, /hotdata/i, /checkout diode/i, /testimonial/i]) {
    assert.doesNotMatch(html, banned);
  }
});

test('GET /operator-framework.html alias and sitemap entry', async () => {
  const alias = await fetch(`${origin}/operator-framework.html`);
  assert.equal(alias.status, 200);
  const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
  assert.match(sitemap, /<loc>[^<]*\/operator-framework<\/loc>/);
});

test('pricing page links to the operator framework', async () => {
  const html = await (await fetch(`${origin}/pricing`)).text();
  assert.match(html, /href="\/operator-framework"/);
});

test('operator offer routes redirect humans to the live Stripe Payment Links', async () => {
  for (const [route, stripeUrl] of Object.entries(OFFER_ROUTES)) {
    const res = await fetch(`${origin}${route}`, {
      redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36' },
    });
    assert.equal(res.status, 302, `${route} must redirect`);
    const location = new URL(res.headers.get('location'));
    assert.equal(location.origin + location.pathname, stripeUrl, `${route} must land on ${stripeUrl}`);
  }
});

test('operator offer routes deflect bots back to the page', async () => {
  const res = await fetch(`${origin}/go/operator-turnkey`, {
    redirect: 'manual',
    headers: { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' },
  });
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get('location')).pathname, '/operator-framework');
});
