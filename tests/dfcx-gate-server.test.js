'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Isolate the gate's same-session repeat store to a per-file temp path. The
// default is a single global file (~/.thumbgate/session-actions.json); since
// `node --test` runs test files concurrently (and coverage re-runs them), a
// shared store lets unrelated runs contaminate this one and falsely flag a
// benign turn as a repeat. Override before requiring the server (which pulls in
// the gate singleton).
const gates = require(path.join(__dirname, '..', 'scripts', 'gates-engine'));
gates.SESSION_ACTIONS_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dfcx-srv-')), 'session-actions.json');
if (typeof gates.clearSessionActions === 'function') { try { gates.clearSessionActions(); } catch (_) { /* ignore */ } }

const { createServer } = require(path.join(__dirname, '..', 'adapters', 'gcp', 'server'));

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('GET /health returns 200 ok', async () => {
  const server = createServer();
  const port = await listen(server);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
  } finally {
    await close(server);
  }
});

test('POST routes through the gate; with no upstream a benign turn is allowed', async () => {
  const server = createServer();
  const port = await listen(server);
  try {
    const body = {
      fulfillmentInfo: { tag: 'lookup-balance' },
      sessionInfo: { session: 's-http-1', parameters: { account_id: 'HTTP-1' } },
    };
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.session_info.parameters.thumbgate_blocked, false);
  } finally {
    await close(server);
  }
});

test('non-POST, non-health method is rejected with 405', async () => {
  const server = createServer();
  const port = await listen(server);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'PUT' });
    assert.equal(res.status, 405);
  } finally {
    await close(server);
  }
});
