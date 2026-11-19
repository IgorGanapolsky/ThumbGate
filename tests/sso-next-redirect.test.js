'use strict';

// Sign-in carries "next" through the Google and Apple round trip, never to another site; Log Out lands on the
// landing page; the signed-out dashboard goes to the one sign-in page; the Admin link is for owners only.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OWNER = 'owner.person@example.test';
const MEMBER = 'member.person@example.test';
const ENV_KEYS = ['THUMBGATE_FEEDBACK_DIR', 'THUMBGATE_API_KEY', 'THUMBGATE_OPERATOR_KEY', 'THUMBGATE_OWNER_EMAILS', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'RESEND_API_KEY', 'STRIPE_SECRET_KEY', '_TEST_API_KEYS_PATH'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-sso-next-'));

process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
process.env.THUMBGATE_API_KEY = 'tg_admin_sso_next_test';
process.env.THUMBGATE_OPERATOR_KEY = 'tg_op_sso_next_test';
process.env.THUMBGATE_OWNER_EMAILS = OWNER;
process.env.RESEND_API_KEY = '';
process.env.STRIPE_SECRET_KEY = '';
process.env._TEST_API_KEYS_PATH = path.join(tmpDir, 'api-keys.json');
process.env.GOOGLE_CLIENT_ID = 'next-google-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'next-google-secret';
process.env.APPLE_CLIENT_ID = 'ai.thumbgate.web.nexttest';

const serverMod = require('../src/api/server');
const hooks = serverMod.__test__;

const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const googleJwk = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'next-kid', alg: 'RS256', use: 'sig' };
const appleIdp = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const appleClient = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const appleIdpJwk = { ...appleIdp.publicKey.export({ format: 'jwk' }), kid: 'apple-next-kid', alg: 'ES256', use: 'sig' };
process.env.APPLE_TEAM_ID = 'TEAMNEXT01';
process.env.APPLE_KEY_ID = 'KEYNEXT001';
process.env.APPLE_PRIVATE_KEY = appleClient.privateKey.export({ type: 'pkcs8', format: 'pem' }).replaceAll('\n', '\\n');

let nextGoogleToken = '';
let nextAppleToken = '';
const signGoogle = (email) => {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'next-kid' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600, email, email_verified: true, sub: 'g_' + email })).toString('base64url');
  return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), rsa.privateKey).toString('base64url')}`;
};
const signApple = (email, nonce) => {
  const h = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'apple-next-kid' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ iss: 'https://appleid.apple.com', aud: process.env.APPLE_CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600, nonce, email, email_verified: 'true', sub: 'a_' + email })).toString('base64url');
  return `${h}.${p}.${crypto.sign('sha256', Buffer.from(`${h}.${p}`), { key: appleIdp.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
};

let handle;
let origin;
test.before(async () => {
  hooks.setGoogleOAuthFetchForTests(async (url) => (String(url) === 'https://oauth2.googleapis.com/token'
    ? { ok: true, status: 200, json: async () => ({ access_token: 'ya29.next', id_token: nextGoogleToken }) }
    : { ok: true, status: 200, json: async () => ({ keys: [googleJwk] }) }));
  hooks.setAppleOAuthFetchForTests(async (url) => (String(url) === 'https://appleid.apple.com/auth/token'
    ? { ok: true, status: 200, json: async () => ({ access_token: 'apple_at', id_token: nextAppleToken }) }
    : { ok: true, status: 200, json: async () => ({ keys: [appleIdpJwk] }) }));
  handle = await serverMod.startServer({ port: 0, host: '127.0.0.1' });
  origin = `http://127.0.0.1:${handle.port}`;
});
test.after(async () => {
  hooks.setGoogleOAuthFetchForTests(null);
  hooks.setAppleOAuthFetchForTests(null);
  if (handle?.server) await new Promise((resolve) => handle.server.close(resolve));
  for (const key of ENV_KEYS) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const HOSTED = { 'x-forwarded-host': 'thumbgate.ai' };
const cookieOf = (res, name) => (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || '']).map((c) => c.split(';')[0]).find((c) => c.startsWith(name + '='));

async function googleSignIn(email, nextParam) {
  nextGoogleToken = signGoogle(email);
  const query = nextParam === undefined ? '' : '&next=' + encodeURIComponent(nextParam);
  const start = await fetch(`${origin}/v1/cloud/sso/authorize?provider=google${query}`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const stateCookie = cookieOf(start, 'thumbgate_sso_state') || (start.headers.get('set-cookie') || '').split(';')[0];
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const back = await fetch(`${origin}/v1/cloud/sso/callback?provider=google&code=code_next&state=${encodeURIComponent(state)}`, { headers: { Cookie: stateCookie }, redirect: 'manual' });
  return { back, session: cookieOf(back, 'thumbgate_auth_session') };
}

async function appleSignIn(email, nextParam) {
  const query = nextParam === undefined ? '' : '&next=' + encodeURIComponent(nextParam);
  const start = await fetch(`${origin}/v1/cloud/sso/authorize?provider=apple${query}`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const url = new URL(start.headers.get('location'));
  nextAppleToken = signApple(email, url.searchParams.get('nonce'));
  const back = await fetch(`${origin}/v1/cloud/sso/apple/callback`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://appleid.apple.com' },
    body: new URLSearchParams({ code: 'apple_code_next', state: url.searchParams.get('state') }).toString(),
    redirect: 'manual',
  });
  return { back, session: cookieOf(back, 'thumbgate_auth_session') };
}

test('next=/admin survives the full Google callback and ends on /admin', async () => {
  const { back, session } = await googleSignIn(OWNER, '/admin');
  assert.equal(back.status, 302);
  assert.equal(back.headers.get('location'), '/admin');
  assert.ok(session, 'a session cookie was set');
});

test('next=/admin survives the full Apple callback and ends on /admin', async () => {
  const { back, session } = await appleSignIn(OWNER, '/admin');
  assert.equal(back.status, 303);
  assert.equal(back.headers.get('location'), '/admin');
  assert.ok(session, 'a session cookie was set');
});

test('another site or a malformed next ends on /dashboard for Google and Apple', async () => {
  for (const bad of ['//evil.com', 'https://evil.com', 'https://evil.com/admin', '/\\evil.com', '/%0d%0aSet-Cookie:x=1', 'javascript:alert(1)', 'admin', '']) {
    const google = await googleSignIn(MEMBER, bad);
    assert.equal(google.back.headers.get('location'), '/dashboard', 'google ' + JSON.stringify(bad));
    const apple = await appleSignIn(MEMBER, bad);
    assert.equal(apple.back.headers.get('location'), '/dashboard', 'apple ' + JSON.stringify(bad));
  }
  assert.equal((await googleSignIn(MEMBER)).back.headers.get('location'), '/dashboard', 'no next at all');
});

test('the state is single-use: replaying a callback gives no second session', async () => {
  nextGoogleToken = signGoogle(MEMBER);
  const start = await fetch(`${origin}/v1/cloud/sso/authorize?provider=google&next=%2Fadmin`, { redirect: 'manual' });
  const stateCookie = (start.headers.get('set-cookie') || '').split(';')[0];
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const url = `${origin}/v1/cloud/sso/callback?provider=google&code=c&state=${encodeURIComponent(state)}`;
  assert.equal((await fetch(url, { headers: { Cookie: stateCookie }, redirect: 'manual' })).headers.get('location'), '/admin');
  const replay = await fetch(url, { headers: { Cookie: stateCookie }, redirect: 'manual' });
  assert.match(replay.headers.get('location'), /sso_error=invalid_state/);
});

test('the sign-in page carries next into both providers and no longer tells people to reopen the page', async () => {
  const page = await (await fetch(`${origin}/signin?next=%2Fadmin`)).text();
  assert.match(page, /provider=google&amp;next=%2Fadmin"/);
  assert.match(page, /provider=apple&amp;next=%2Fadmin"/);
  assert.ok(!/again/i.test(page), 'the "open the page again" sentence is gone');
  const hostile = await (await fetch(`${origin}/signin?next=%2F%2Fevil.com`)).text();
  assert.match(hostile, /provider=google&amp;next=%2Fdashboard"/);
  assert.ok(!hostile.includes('evil.com'));
});

test('signed-out /dashboard on the hosted site redirects to /signin?next=%2Fdashboard', async () => {
  const res = await fetch(`${origin}/dashboard`, { headers: HOSTED, redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/signin?next=%2Fdashboard');
  const withError = await fetch(`${origin}/dashboard?sso_error=invalid_state`, { headers: HOSTED, redirect: 'manual' });
  assert.equal(withError.headers.get('location'), '/signin?next=%2Fdashboard&sso_error=invalid_state');
  const local = await fetch(`${origin}/dashboard`, { redirect: 'manual' });
  assert.equal(local.status, 200, 'a local dashboard (loopback host) is not redirected');
});

test('Log Out redirects to the landing page, clears the cookie and ends the session', async () => {
  const { session } = await googleSignIn(MEMBER, '/dashboard');
  const before = await fetch(`${origin}/dashboard`, { headers: { ...HOSTED, Cookie: session }, redirect: 'manual' });
  assert.equal(before.status, 200, 'signed in: the dashboard is served');
  const out = await fetch(`${origin}/logout`, { method: 'POST', headers: { Cookie: session }, redirect: 'manual' });
  assert.equal(out.status, 303);
  assert.equal(out.headers.get('location'), '/?signed_out=1');
  const cleared = (out.headers.get('set-cookie') || '');
  assert.match(cleared, /thumbgate_auth_session=;/);
  assert.match(cleared, /Max-Age=0/i);
  const after = await fetch(`${origin}/dashboard`, { headers: { ...HOSTED, Cookie: session }, redirect: 'manual' });
  assert.equal(after.status, 302, 'the old cookie no longer works');
  assert.equal(after.headers.get('location'), '/signin?next=%2Fdashboard');
  const landing = await (await fetch(`${origin}/?signed_out=1`)).text();
  assert.match(landing, /You're signed out\./);
  assert.ok(!/You're signed out\./.test(await (await fetch(`${origin}/`)).text()), 'the note shows only after logout');
});

test('the Admin link is in the dashboard header for the owner only', async () => {
  const owner = await googleSignIn(OWNER, '/dashboard');
  const member = await googleSignIn(MEMBER, '/dashboard');
  const ownerHtml = await (await fetch(`${origin}/dashboard`, { headers: { ...HOSTED, Cookie: owner.session } })).text();
  assert.match(ownerHtml, /<a href="\/admin" class="nav-tab" id="navAdmin">Admin<\/a>/);
  const memberHtml = await (await fetch(`${origin}/dashboard`, { headers: { ...HOSTED, Cookie: member.session } })).text();
  assert.ok(!memberHtml.includes('navAdmin') && !memberHtml.includes('href="/admin"'), 'hidden for a non-owner');
});
