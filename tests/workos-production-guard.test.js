'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const guard = require('../scripts/workos-production-guard');

test('exports stable production client and authkit host constants', () => {
  assert.match(guard.PROD_CLIENT_ID, /^client_/);
  assert.match(guard.STAGING_CLIENT_ID, /^client_/);
  assert.notEqual(guard.PROD_CLIENT_ID, guard.STAGING_CLIENT_ID);
  assert.match(guard.PROD_AUTHKIT_HOST, /authkit\.app$/);
  assert.doesNotMatch(guard.PROD_AUTHKIT_HOST, /staging/i);
});

test('check is a function and EXPECTED_METHODS use lowercase markers', () => {
  assert.equal(typeof guard.check, 'function');
  assert.ok(Array.isArray(guard.EXPECTED_METHODS));
  assert.ok(guard.EXPECTED_METHODS.length > 0);
  for (const method of guard.EXPECTED_METHODS) {
    assert.equal(typeof method.name, 'string');
    assert.equal(method.marker, method.marker.toLowerCase());
  }
  assert.deepEqual(
    guard.EXPECTED_METHODS.map((m) => m.name).sort(),
    ['email', 'google'].sort(),
  );
});

test('module path is scripts/workos-production-guard.js (packaged runtime)', () => {
  const resolved = require.resolve('../scripts/workos-production-guard');
  assert.match(resolved, /scripts[/\\]workos-production-guard\.js$/);
  assert.equal(path.basename(resolved), 'workos-production-guard.js');
});

test('parseArgs accepts --json and --base', () => {
  assert.deepEqual(guard.parseArgs(['--json']), { json: true, base: 'https://thumbgate.app' });
  assert.equal(guard.parseArgs(['--base', 'https://example.com/']).base, 'https://example.com');
  assert.equal(guard.parseArgs(['--help']).help, true);
});

function mockFetchSequence(steps) {
  let i = 0;
  return async (url, options = {}) => {
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (typeof step === 'function') return step(url, options);
    if (step.error) throw new Error(step.error);
    const headers = new Map(Object.entries(step.headers || {}));
    return {
      status: step.status || 302,
      headers: {
        get(name) {
          const key = String(name).toLowerCase();
          for (const [k, v] of headers.entries()) {
            if (k.toLowerCase() === key) return v;
          }
          return null;
        },
      },
      text: async () => step.body || '',
    };
  };
}

test('check passes for production client + authkit + expected methods', async () => {
  const loginLocation =
    `https://api.workos.com/user_management/authorize?client_id=${guard.PROD_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent('https://thumbgate.app/api/auth/callback')}`;
  const fetchImpl = mockFetchSequence([
    { status: 302, headers: { location: loginLocation } },
    { status: 302, headers: { location: `https://${guard.PROD_AUTHKIT_HOST}/sign-in` } },
    {
      status: 200,
      body: '<html>Continue with email</html><button>Continue with Google</button>',
    },
  ]);
  const report = await guard.check('https://thumbgate.app', { fetchImpl });
  assert.equal(report.ok, true, JSON.stringify(report.failures));
  assert.equal(report.clientId, guard.PROD_CLIENT_ID);
  assert.equal(report.finalHost, guard.PROD_AUTHKIT_HOST);
  assert.deepEqual(report.methodsFound.sort(), ['email', 'google'].sort());
  assert.equal(report.hasMaxAge, false);
});

test('check fails closed on staging client id', async () => {
  const loginLocation =
    `https://api.workos.com/user_management/authorize?client_id=${guard.STAGING_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent('https://thumbgate.app/api/auth/callback')}`;
  const fetchImpl = mockFetchSequence([
    { status: 302, headers: { location: loginLocation } },
    { status: 302, headers: { location: 'https://staging.authkit.app/sign-in' } },
    { status: 200, body: 'continue with email continue with google' },
  ]);
  const report = await guard.check('https://thumbgate.app', { fetchImpl });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => /staging client_id/i.test(f)));
});

test('check fails when login has no Location', async () => {
  const fetchImpl = mockFetchSequence([{ status: 200, headers: {} }]);
  const report = await guard.check('https://thumbgate.app', { fetchImpl });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => /Location redirect/i.test(f)));
});

test('check fails when max_age is present on ordinary login', async () => {
  const loginLocation =
    `https://api.workos.com/user_management/authorize?client_id=${guard.PROD_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent('https://thumbgate.app/api/auth/callback')}&max_age=0`;
  const fetchImpl = mockFetchSequence([
    { status: 302, headers: { location: loginLocation } },
    { status: 302, headers: { location: `https://${guard.PROD_AUTHKIT_HOST}/` } },
    { status: 200, body: 'continue with email continue with google' },
  ]);
  const report = await guard.check('https://thumbgate.app', { fetchImpl });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => /max_age/i.test(f)));
});

test('check fails when expected sign-in method is missing', async () => {
  const loginLocation =
    `https://api.workos.com/user_management/authorize?client_id=${guard.PROD_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent('https://thumbgate.app/api/auth/callback')}`;
  const fetchImpl = mockFetchSequence([
    { status: 302, headers: { location: loginLocation } },
    { status: 302, headers: { location: `https://${guard.PROD_AUTHKIT_HOST}/` } },
    { status: 200, body: 'continue with email only' },
  ]);
  const report = await guard.check('https://thumbgate.app', { fetchImpl });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => /google/i.test(f)));
});

test('check records login fetch transport failure', async () => {
  const fetchImpl = mockFetchSequence([{ error: 'network down' }]);
  const report = await guard.check('https://thumbgate.app', { fetchImpl });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((f) => /login request failed/i.test(f)));
});
