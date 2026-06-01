'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

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
