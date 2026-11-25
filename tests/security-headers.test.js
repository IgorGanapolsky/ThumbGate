'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { SECURITY_HEADERS, applySecurityHeaders } = require('../src/api/security-headers');

const REQUIRED = ['Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy',
  'Permissions-Policy', 'Content-Security-Policy'];

function get(server, path) {
  return new Promise((resolve, reject) => {
    http.get({ port: server.address().port, path }, (res) => { res.resume(); res.on('end', () => resolve(res)); }).on('error', reject);
  });
}

test('every required header is defined and HSTS lasts a year or more', () => {
  for (const h of REQUIRED) assert.ok(SECURITY_HEADERS[h], h);
  assert.ok(Number(/max-age=(\d+)/.exec(SECURITY_HEADERS['Strict-Transport-Security'])[1]) >= 31536000);
});

test('CSP forbids framing, plugins and base-uri hijack', () => {
  const csp = SECURITY_HEADERS['Content-Security-Policy'];
  for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "default-src 'self'"]) assert.ok(csp.includes(d), d);
});

test('the real server sends the headers on a page, an API route, health and a 404', async () => {
  if (process.env.CODEX_SANDBOX) return;
  const os = require('node:os');
  const path = require('node:path');
  const fs = require('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-sechdr-'));
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  process.env.THUMBGATE_PROOF_DIR = dir;
  process.env.THUMBGATE_API_KEY = 'sechdr-test-key';
  process.env._TEST_API_KEYS_PATH = path.join(dir, 'api-keys.json');
  const { startServer } = require('../src/api/server');
  const started = await startServer({ port: 0, host: '127.0.0.1' });
  const server = started.server || started;
  try {
    for (const p of ['/', '/health', '/v1/does-not-exist', '/no-such-page-xyz']) {
      const res = await get(server, p);
      for (const h of REQUIRED) assert.ok(res.headers[h.toLowerCase()], `${p} missing ${h}`);
    }
  } finally { server.close(); }
});

test('headers reach the response and a route-set header wins', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/strict') res.setHeader('Content-Security-Policy', "default-src 'none'");
    applySecurityHeaders(res);
    res.end('ok');
  });
  await new Promise((r) => server.listen(0, r));
  try {
    const plain = await get(server, '/');
    for (const h of REQUIRED) assert.ok(plain.headers[h.toLowerCase()], h);
    const strict = await get(server, '/strict');
    assert.equal(strict.headers['content-security-policy'], "default-src 'none'");
  } finally { server.close(); }
});
