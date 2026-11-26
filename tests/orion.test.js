'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const orion = require('../scripts/clarity');
const { SECURITY_HEADERS } = require('../src/api/security-headers');

const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>hi</body></html>';

test('REQ-01: Orion is never in the served HTML; only the consent tag carries its script URL, loaded after Accept', () => {
  const out = orion.injectAnalyticsTags(PAGE, { pathname: '/', env: {} });
  assert.equal(/<script[^>]*src="https:\/\/t\.paradigmmachines\.ai/.test(out), false, 'no Orion script tag before consent');
  assert.ok(out.includes(JSON.stringify(orion.ORION_SRC).slice(1, -1)), 'the consent tag knows the Orion script URL');
  assert.ok(out.includes(orion.ORION_STUB), 'the stub runs only inside load()');
});

test('REQ-03: private paths, GPC/DNT visitors and THUMBGATE_ORION=off leave Orion out', () => {
  for (const p of ['/dashboard', '/checkout/pro', '/admin', '/v1/feedback']) {
    assert.equal(orion.injectAnalyticsTags(PAGE, { pathname: p, env: {} }), PAGE, p);
  }
  assert.equal(orion.injectAnalyticsTags(PAGE, { pathname: '/', headers: { 'sec-gpc': '1' }, env: {} }), PAGE);
  assert.equal(orion.injectAnalyticsTags(PAGE, { pathname: '/', headers: { dnt: '1' }, env: {} }), PAGE);
  assert.equal(orion.injectAnalyticsTags(PAGE, { pathname: '/', env: { THUMBGATE_ORION: 'off' } }).includes('paradigmmachines'), false);
});

test('REQ-04: the CSP allows the Orion host for scripts and beacons, and adds no hash that would switch off unsafe-inline', () => {
  const csp = SECURITY_HEADERS['Content-Security-Policy'];
  const script = csp.split('; ').find((d) => d.startsWith('script-src '));
  const connect = csp.split('; ').find((d) => d.startsWith('connect-src '));
  assert.ok(script.includes('https://t.paradigmmachines.ai'));
  assert.ok(connect.includes('https://t.paradigmmachines.ai'));
  assert.ok(script.includes("'unsafe-inline'"), 'inline scripts still allowed');
  assert.equal(/'(sha256|sha384|sha512|nonce)-/.test(script), false, 'a hash or nonce would make browsers ignore unsafe-inline');
});

test('REQ-05: the privacy page says Orion records visits, waits for Accept and how to opt out; nothing identifies visitors', () => {
  const privacy = fs.readFileSync(path.join(__dirname, '..', 'public', 'privacy.html'), 'utf8');
  assert.match(privacy, /Orion/);
  assert.match(privacy, /pointer movement, scrolling and clicks/);
  assert.match(privacy, /opt out/i);
  assert.match(privacy, /only after you press Accept on the analytics banner/);
  const code = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'clarity.js'), 'utf8');
  assert.equal(/orion\.identify\(/.test(code.replace(/\/\/.*$/gm, '')), false, 'no identify call');
});
