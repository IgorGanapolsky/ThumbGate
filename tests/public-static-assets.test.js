const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-static-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmp;
process.env.THUMBGATE_API_KEY = 'test-api-key';
process.env._TEST_API_KEYS_PATH = path.join(tmp, 'api-keys.json');

const { startServer } = require('../src/api/server');
const root = path.join(__dirname, '..');

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

test('GET /assets/instagram-card.png serves image/png without an API key', async () => {
  const res = await fetch(`${origin}/assets/instagram-card.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.ok(Number(res.headers.get('content-length')) > 0, 'content-length must be non-zero');
  assert.match(res.headers.get('cache-control') || '', /max-age=/);
});

test('GET /thumbgate-logo.png serves the checkout-ready brand logo without an API key', async () => {
  const res = await fetch(`${origin}/thumbgate-logo.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.ok(Number(res.headers.get('content-length')) > 0);
});

test('GET /thumbgate-icon.png and brand assets serve public Stripe images', async () => {
  const [iconRes, checkoutIconRes, checkoutLogoRes] = await Promise.all([
    fetch(`${origin}/thumbgate-icon.png`),
    fetch(`${origin}/assets/brand/thumbgate-icon-512.png`),
    fetch(`${origin}/assets/brand/thumbgate-logo-1200x360.png`),
  ]);

  for (const res of [iconRes, checkoutIconRes, checkoutLogoRes]) {
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.ok(Number(res.headers.get('content-length')) > 0);
  }
});

test('GET /assets/tiktok-agent-memory.mp4 serves video/mp4 without an API key', async () => {
  const res = await fetch(`${origin}/assets/tiktok-agent-memory.mp4`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.ok(Number(res.headers.get('content-length')) > 0);
});

test('HEAD /assets/... returns headers only', async () => {
  const res = await fetch(`${origin}/assets/instagram-card.png`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.equal(body, '');
});

test('GET /assets/missing.png returns 404, not 401', async () => {
  const res = await fetch(`${origin}/assets/does-not-exist-${Date.now()}.png`);
  assert.equal(res.status, 404);
  assert.notEqual(res.status, 401, 'must not require an API key for the assets prefix');
});

test('GET /assets/../server.js is rejected (no path traversal)', async () => {
  const res = await fetch(`${origin}/assets/..%2fapi%2fserver.js`);
  assert.ok([403, 404].includes(res.status), `expected 403 or 404, got ${res.status}`);
  assert.notEqual(res.status, 200);
});

test('packaged well-known MCP server card is valid JSON', () => {
  const payload = JSON.parse(fs.readFileSync(path.join(root, '.well-known/mcp/server-card.json'), 'utf8'));
  assert.equal(payload.name, 'thumbgate');
  assert.equal(typeof payload.version, 'string');
});
