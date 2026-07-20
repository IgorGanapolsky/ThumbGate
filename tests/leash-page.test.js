const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-leash-page-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmp;
process.env.THUMBGATE_API_KEY = 'test-api-key';
process.env._TEST_API_KEYS_PATH = path.join(tmp, 'api-keys.json');
process.env.LEASH_CONTROL_PLANE_URL = 'https://control.example.com/';

const { startServer } = require('../src/api/server');

let handle;
let origin;

test.before(async () => {
  handle = await startServer({ port: 0 });
  origin = `http://127.0.0.1:${handle.port}`;
});

test.after(async () => {
  handle.server.closeIdleConnections?.();
  handle.server.closeAllConnections?.();
  await new Promise((resolve) => handle.server.close(resolve));
});

test('GET /leash serves an indexable, evidence-bounded product page', async () => {
  const res = await fetch(`${origin}/leash`);
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.match(html, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/leash">/);
  assert.match(html, /<meta name="robots" content="index,follow/);
  assert.match(html, /Web control is free\. Continuation is paid\./);
  assert.match(html, /\$10 <small>\/ month<\/small>/);
  assert.match(html, /full customer sign-in-to-checkout proof are completed/);
  assert.match(html, /data-domain="localhost"/);
  assert.doesNotMatch(html, /iganapolsky|workers\.dev|chatgpt\.site/i);
});

test('GET /leash.html is a supported alias', async () => {
  const res = await fetch(`${origin}/leash.html`);
  assert.equal(res.status, 200);
});

test('GET /leash/open redirects without leaking the source page as a referrer', async () => {
  const res = await fetch(`${origin}/leash/open`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://control.example.com/');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
});

test('sitemap and LLM manifest discover the Leash page', async () => {
  const [sitemapRes, llmsRes] = await Promise.all([
    fetch(`${origin}/sitemap.xml`),
    fetch(`${origin}/llms.txt`),
  ]);
  assert.equal(sitemapRes.status, 200);
  assert.match(await sitemapRes.text(), new RegExp(`<loc>${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/leash<\\/loc>`));
  assert.equal(llmsRes.status, 200);
  assert.match(await llmsRes.text(), /Leash web control and cloud continuation: https:\/\/thumbgate\.ai\/leash/);
});
