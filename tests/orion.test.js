'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const orion = require('../scripts/clarity');
const { SECURITY_HEADERS } = require('../src/api/security-headers');

const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>hi</body></html>';

test('REQ-01: the tag is the first thing inside <head>, exactly as Orion gave it', () => {
  const out = orion.injectOrionTag(PAGE, { pathname: '/', env: {} });
  assert.ok(out.includes('<head>' + orion.ORION_TAG + '<meta charset'), 'tag sits right after <head>');
  assert.ok(out.includes('<script src="https://t.paradigmmachines.ai/q6ksr42etswa3fz583qr.js" async></script>'));
  assert.ok(out.includes("!function(w){var h=w.__orion=w.__orion||{},o=w.orion=w.orion||{};h.q=h.q||[];['identify','stop'].forEach("));
});

test('REQ-02: injecting twice adds one tag', () => {
  const once = orion.injectOrionTag(PAGE, { pathname: '/', env: {} });
  assert.equal(orion.injectOrionTag(once, { pathname: '/', env: {} }), once);
});

test('REQ-03: private paths, GPC/DNT visitors and THUMBGATE_ORION=off get no tag', () => {
  for (const p of ['/dashboard', '/checkout/pro', '/admin', '/v1/feedback']) {
    assert.equal(orion.injectOrionTag(PAGE, { pathname: p, env: {} }), PAGE, p);
  }
  assert.equal(orion.injectOrionTag(PAGE, { pathname: '/', headers: { 'sec-gpc': '1' }, env: {} }), PAGE);
  assert.equal(orion.injectOrionTag(PAGE, { pathname: '/', headers: { dnt: '1' }, env: {} }), PAGE);
  assert.equal(orion.injectOrionTag(PAGE, { pathname: '/', env: { THUMBGATE_ORION: 'off' } }), PAGE);
});

test('REQ-04: the CSP allows the Orion host for scripts and beacons, and adds no hash that would switch off unsafe-inline', () => {
  const csp = SECURITY_HEADERS['Content-Security-Policy'];
  const script = csp.split('; ').find((d) => d.startsWith('script-src '));
  const connect = csp.split('; ').find((d) => d.startsWith('connect-src '));
  assert.ok(script.includes('https://t.paradigmmachines.ai'));
  assert.ok(connect.includes('https://t.paradigmmachines.ai'));
  assert.ok(script.includes("'unsafe-inline'"), 'inline scripts still allowed');
  assert.equal(/'(sha256|sha384|sha512|nonce)-/.test(script), false, 'a hash or nonce would make browsers ignore unsafe-inline');
  const digest = crypto.createHash('sha256').update(orion.ORION_STUB).digest('base64');
  assert.equal(orion.ORION_STUB_CSP_HASH, `'sha256-${digest}'`, 'the documented hash still matches the stub text');
});

test('REQ-05: the privacy page says Orion records visits and how to opt out; nothing identifies visitors', () => {
  const privacy = fs.readFileSync(path.join(__dirname, '..', 'public', 'privacy.html'), 'utf8');
  assert.match(privacy, /Orion/);
  assert.match(privacy, /pointer movement, scrolling and clicks/);
  assert.match(privacy, /opt out/i);
  const code = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'clarity.js'), 'utf8');
  assert.equal(/orion\.identify\(/.test(code.replace(/\/\/.*$/gm, '')), false, 'no identify call');
});
