'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-operator-framework-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmp;
process.env.THUMBGATE_API_KEY = 'test-api-key';
process.env.THUMBGATE_PRO_PRICE_DOLLARS = '37';
// A stale descriptive label must not override the configured checkout amount.
process.env.THUMBGATE_PRO_PRICE_LABEL = '$19/month or $149/year';
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

test('GET /operator-framework serves free CLI, self-serve Pro, and FAQ schema', async () => {
  const res = await fetch(`${origin}/operator-framework`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const html = await res.text();

  assert.match(html, /Operator Framework/);
  assert.match(html, /href="\/checkout\/pro"/);
  assert.match(html, /Free CLI/);
  assert.match(html, /Self-serve software/);
  const visibleHtml = html.replace(/<script[\s\S]*?<\/script>/g, '');
  assert.match(visibleHtml, /Get Pro · \$37\/mo/);
  assert.doesNotMatch(visibleHtml, /\$19|\$149/);
  const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(schema['@graph'].find((item) => item['@type'] === 'SoftwareApplication').offers.price, '37');
  assert.doesNotMatch(html, /buy\.stripe\.com/, 'payment links stay behind /go/ redirects');
  assert.doesNotMatch(html, /\$499|Setup Sprint|operator-diagnostic|sprint_diagnostic/);
  assert.match(html, /VERIFICATION_EVIDENCE\.md/);
  assert.doesNotMatch(html, /30% revenue share/);
  assert.match(html, /mailto:igor@igorganapolsky\.com/);
  assert.match(html, /"@type":\s*"FAQPage"/);
  assert.doesNotMatch(html, /__APP_ORIGIN__/, 'template placeholders must be filled');
  assert.doesNotMatch(html, /\$2,500/);
  assert.doesNotMatch(html, /\$500/);
  assert.doesNotMatch(html, /__PRO_PRICE_DOLLARS__|__PRO_PRICE_LABEL__/);
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

test('retired operator diagnostic route cannot redirect humans to payment', async () => {
  for (const route of ['/go/operator-diagnostic']) {
    // Raw request: Node's fetch overwrites Sec-Fetch-Mode, which this route checks.
    const routeUrl = new URL(route, origin);
    const res = await new Promise((resolve, reject) => {
      require('node:http').get(routeUrl, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
          accept: 'text/html,*/*;q=0.8',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
        },
      }, (r) => { r.resume(); resolve({ status: r.statusCode, location: r.headers.location }); }).on('error', reject);
    });
    assert.equal(res.status, 410, `${route} must be retired`);
    assert.equal(res.location, undefined, `${route} must not redirect to payment`);
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
