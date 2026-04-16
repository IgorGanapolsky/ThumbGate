'use strict';

/**
 * E2E test for dashboard deep-linking.
 *
 * Starts the real ThumbGate server on an ephemeral port, fetches /dashboard,
 * verifies the HTML response actually contains the deep-link handler code
 * AND valid target tab ids. No mocks — this proves the served HTML works.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');

function startServer() {
  return new Promise((resolve, reject) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-deeplink-e2e-'));
    fs.writeFileSync(path.join(tempDir, 'feedback-log.jsonl'), '');
    fs.writeFileSync(path.join(tempDir, 'memory-log.jsonl'), '');

    // Clear require cache so env var is picked up fresh
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
      if (typeof factory !== 'function') {
        return reject(new Error('createApiServer not exported'));
      }
      const server = factory({ feedbackDir: tempDir, allowInsecure: true });
      const underlying = server.server || server; // handle { server, ... } wrapper
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

function fetchPath(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: 'localhost', port, path: pathname, method: 'GET', timeout: 5000 },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

describe('dashboard deep-linking e2e', () => {
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

  test('GET /dashboard returns 200 with deep-link handler code', async () => {
    const res = await fetchPath(serverCtx.port, '/dashboard');
    assert.equal(res.status, 200, 'dashboard must serve 200');
    assert.match(res.body, /getDeepLinkTab/, 'response must include getDeepLinkTab function');
    assert.match(res.body, /applyDeepLinkTab/, 'response must include applyDeepLinkTab function');
    assert.match(res.body, /hashchange/, 'response must listen for hashchange');
    assert.match(res.body, /DOMContentLoaded/, 'response must fire on DOMContentLoaded');
  });

  test('dashboard response contains all valid tab content containers', async () => {
    const res = await fetchPath(serverCtx.port, '/dashboard');
    const validTabs = ['search', 'gates', 'team', 'generated', 'settings', 'templates', 'insights', 'export'];
    for (const tab of validTabs) {
      assert.match(
        res.body,
        new RegExp(`id="tab-${tab}"`),
        `dashboard HTML must have tab-${tab} container so #${tab} deep-link works`,
      );
    }
  });

  test('landing page deep-link hashes all resolve to existing tabs', async () => {
    const indexPath = path.join(ROOT, 'public', 'index.html');
    const indexHtml = fs.readFileSync(indexPath, 'utf8');
    const dashRes = await fetchPath(serverCtx.port, '/dashboard');

    const linkHashes = new Set();
    const re = /\/dashboard#(\w+)/g;
    let m;
    while ((m = re.exec(indexHtml)) !== null) linkHashes.add(m[1]);

    assert.ok(linkHashes.size > 0, 'landing page should have at least one dashboard deep-link');

    for (const hash of linkHashes) {
      assert.match(
        dashRes.body,
        new RegExp(`id="tab-${hash}"`),
        `landing links to /dashboard#${hash} but served dashboard has no tab-${hash}`,
      );
    }
  });
});
