'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');

function startServer() {
  return new Promise((resolve, reject) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-debug-api-'));
    fs.writeFileSync(path.join(tempDir, 'feedback-log.jsonl'), '');
    fs.writeFileSync(path.join(tempDir, 'memory-log.jsonl'), '');

    for (const key of Object.keys(require.cache)) {
      if (key.includes('server.js') || key.includes('thumbgate')) {
        delete require.cache[key];
      }
    }

    process.env.THUMBGATE_FEEDBACK_DIR = tempDir;
    process.env.THUMBGATE_ALLOW_INSECURE = 'true';

    try {
      const serverPath = path.join(ROOT, 'src', 'api', 'server.js');
      const serverMod = require(serverPath);
      const factory = serverMod.createApiServer || serverMod.createServer;
      const server = factory({ feedbackDir: tempDir, allowInsecure: true });
      const underlying = server.server || server;
      underlying.listen(0, () => {
        const port = underlying.address().port;
        resolve({ server: underlying, port, tempDir });
      });
      underlying.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

function postJson(port, pathname, data) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(data);
    const req = http.request(
      {
        hostname: 'localhost',
        port,
        path: pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
        timeout: 5000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body), raw: body });
          } catch (e) {
            resolve({ status: res.statusCode, raw: body, error: e });
          }
        });
      },
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function getJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port,
        path: pathname,
        method: 'GET',
        headers: { Accept: 'application/json' },
        timeout: 5000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body), raw: body });
          } catch (e) {
            resolve({ status: res.statusCode, raw: body, error: e });
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Server Live Debugger API endpoints', () => {
  let serverCtx;

  before(async () => {
    serverCtx = await startServer();
  });

  after(() => {
    if (serverCtx?.server) serverCtx.server.close();
    if (serverCtx?.tempDir) {
      try { fs.rmSync(serverCtx.tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('GET /v1/debug/inspector-status returns runtime process & debug info', async () => {
    const res = await getJson(serverCtx.port, '/v1/debug/inspector-status');
    assert.equal(res.status, 200);
    assert.ok(typeof res.data.pid === 'number');
    assert.ok(typeof res.data.nodeVersion === 'string');
    assert.ok(res.data.launchCommands && typeof res.data.launchCommands.ndb === 'string');
  });

  test('POST /v1/debug/inspect-action evaluates simulated tool actions', async () => {
    const res = await postJson(serverCtx.port, '/v1/debug/inspect-action', {
      tool: 'Bash',
      command: 'rm -rf /',
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.verdict, 'DENY');
    assert.equal(res.data.decision, 'deny');
    assert.ok(Array.isArray(res.data.steps));
    assert.ok(typeof res.data.latencyMs === 'number');
  });

  test('POST /v1/debug/inspect-action handles safe actions with sub-millisecond trace', async () => {
    const res = await postJson(serverCtx.port, '/v1/debug/inspect-action', {
      tool: 'Bash',
      command: 'git log -n 5',
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.verdict, 'ALLOW');
    assert.equal(res.data.decision, 'allow');
    assert.equal(res.data.steps[0].passed, true);
  });
});
