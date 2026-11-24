const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-cache-test-'));
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

// An unversioned script pinned as immutable stays in the browser across upgrades: a dashboard tab kept
// running the previous build's project-switcher.js for 24 hours and showed 0 feedback for a project that had 35.
test('unversioned scripts revalidate instead of being pinned as immutable', async () => {
  const res = await fetch(`${origin}/project-switcher.js`);
  assert.equal(res.status, 200);
  const cacheControl = res.headers.get('cache-control') || '';
  assert.match(cacheControl, /no-cache/);
  assert.doesNotMatch(cacheControl, /immutable/);
});

test('images stay cached as immutable', async () => {
  const res = await fetch(`${origin}/thumbgate-logo.png`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') || '', /max-age=\d+, immutable/);
});
