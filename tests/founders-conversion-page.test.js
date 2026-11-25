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

test('GET /founders and aliases redirect to the team pilot and keep utm parameters', async () => {
  for (const route of ['/founders', '/operators', '/founders.html', '/agent-operators']) {
    const res = await fetch(`${origin}${route}?utm_source=x`, { redirect: 'manual' });
    assert.equal(res.status, 301, `${route} should be 301`);
    assert.equal(res.headers.get('location'), '/pilot?utm_source=x');
  }
  assert.equal(fs.existsSync(path.join(PUBLIC_DIR, 'founders.html')), false);
});

test('GET /sitemap.xml no longer lists /founders', async () => {
  const res = await fetch(`${origin}/sitemap.xml`);
  assert.equal(res.status, 200);
  assert.doesNotMatch(await res.text(), /\/founders<\/loc>/);
});

test('GET /diagnostic is retired even while other founder content remains available', async () => {
  const res = await fetch(`${origin}/diagnostic`, { redirect: 'manual' });
  assert.equal(res.status, 410);
  assert.equal(res.headers.get('location'), null);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await res.json()).pricingUrl, '/pricing');
});
