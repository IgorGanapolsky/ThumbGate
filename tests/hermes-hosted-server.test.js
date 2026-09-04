'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.THUMBGATE_API_KEY = 'test-api-key';
const { startServer } = require('../src/api/server');

test('hosted Hermes Platform Protocol and Sync Plane API routes', async (t) => {
  let handle;
  let port;

  await t.test('start test server', async () => {
    handle = await startServer({ port: 0, host: '127.0.0.1' });
    port = handle.port;
    assert.ok(port > 0);
  });

  function makeRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-api-key',
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ status: res.statusCode, headers: res.headers, body: parsed });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, text: data });
          }
        });
      });

      req.on('error', reject);
      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  await t.test('POST /v1/hermes/turn/start fails closed on uninitialized connection', async () => {
    const res = await makeRequest('POST', '/v1/hermes/turn/start', {
      connectionId: 'uninit-conn',
      threadId: 'thread-1',
      input: 'test',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.reason, 'not_initialized');
  });

  await t.test('POST /v1/hermes/initialize registers connectionId for later turns', async () => {
    const init = await makeRequest('POST', '/v1/hermes/initialize', {
      connectionId: 'init-conn-1',
    });
    assert.equal(init.status, 200);
    assert.equal(init.body.ok, true);
    assert.equal(init.body.connectionId, 'init-conn-1');
  });

  await t.test('GET /v1/hermes/sync/read fails closed without cursor and offset', async () => {
    const res = await makeRequest('GET', '/v1/hermes/sync/read');
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.reason, 'cursor_required');
  });

  await t.test('POST /v1/hermes/action/approve rejects unrecorded approval id', async () => {
    const res = await makeRequest('POST', '/v1/hermes/action/approve', {
      approvalId: 'nonexistent-appr',
      approverId: 'operator',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.reason, 'approval_missing');
  });

  await t.test('close test server', async () => {
    if (handle && handle.server) {
      await new Promise((resolve) => handle.server.close(resolve));
    }
  });
});
