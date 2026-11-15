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

test('GET /operator-framework offers free CLI and self-serve Pro without retired services', async () => {
  const res = await fetch(`${origin}/operator-framework`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  const html = await res.text();
  assert.match(html, /Operator Framework/);
  assert.match(html, /href="\/checkout\/pro"/);
  assert.match(html, /href="\/#install"/);
  assert.match(html, /Recall, dashboard, adapters, and exports/);
  assert.match(html, /configuration|configure/);
  assert.doesNotMatch(html, /buy\.stripe\.com|\$499|30% revenue share|We install and configure|one regression test/i);
  assert.doesNotMatch(html, /__APP_ORIGIN__|__PRO_PRICE_DOLLARS__/);
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

test('retired operator diagnostic returns 410 with current pricing instead of payment dispatch', async () => {
  const res = await fetch(`${origin}/go/operator-diagnostic`, { redirect: 'manual' });
  assert.equal(res.status, 410);
  assert.equal(res.headers.get('location'), null);
  assert.match(await res.text(), /\/pricing/);
});

test('operator offer routes deflect bots back to the page', async () => {
  const res = await fetch(`${origin}/go/operator-turnkey`, {
    redirect: 'manual',
    headers: { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' },
  });
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get('location')).pathname, '/operator-framework');
});
