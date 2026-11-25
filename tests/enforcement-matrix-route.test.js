'use strict';

// AGENT-3667: the generated enforcement matrix page is reachable on the site at /learn/enforcement-matrix.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-matrix-route-'));
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

test('GET /learn/enforcement-matrix serves the generated page with the fail-open and fail-closed labels', async () => {
  const res = await fetch(`${origin}/learn/enforcement-matrix`);
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);
  const html = await res.text();
  assert.match(html, /Which agents ThumbGate hard-stops, and which only warn/);
  assert.match(html, /Fails closed/);
  assert.match(html, /Fails open/);
});
