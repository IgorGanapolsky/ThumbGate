'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  rememberSsoState,
  consumeSsoState,
  buildAppleAuthorizeUrl,
  providerConfigured,
  verifyRs256Jwt,
  verifiedEmailFromPayload,
  buildAppleClientSecret,
} = require('../src/sso-oauth');

function b64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

test('provider configuration requires every secret the callback will use', () => {
  assert.equal(providerConfigured({ GOOGLE_CLIENT_ID: 'id-only' }, 'google'), false);
  assert.equal(providerConfigured({
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
  }, 'google'), true);
  assert.equal(providerConfigured({
    APPLE_CLIENT_ID: 'ai.thumbgate.web',
    APPLE_TEAM_ID: 'TEAMID1234',
    APPLE_KEY_ID: 'KEYID12345',
  }, 'apple'), false);
  assert.equal(providerConfigured({
    APPLE_CLIENT_ID: 'ai.thumbgate.web',
    APPLE_TEAM_ID: 'TEAMID1234',
    APPLE_KEY_ID: 'KEYID12345',
    APPLE_PRIVATE_KEY: 'pem',
  }, 'apple'), true);
});

test('SSO state is one-time and expires', () => {
  const now = Date.now();
  const state = `st_google_${crypto.randomBytes(8).toString('hex')}`;
  rememberSsoState(state, {
    provider: 'google',
    redirectUri: 'https://thumbgate.ai/v1/cloud/sso/callback',
  }, now);
  assert.equal(consumeSsoState(state, now).provider, 'google');
  assert.equal(consumeSsoState(state, now), null);

  const expired = `st_google_${crypto.randomBytes(8).toString('hex')}`;
  rememberSsoState(expired, {
    provider: 'google',
    redirectUri: 'https://thumbgate.ai/v1/cloud/sso/callback',
  }, now);
  assert.equal(consumeSsoState(expired, now + (10 * 60 * 1000)), null);
});

test('RS256 id tokens accept only a verified email for the expected audience', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'test-kid';
  jwk.kty = 'RSA';
  const sign = (payload, kid = 'test-kid') => {
    const header = b64urlJson({ alg: 'RS256', kid });
    const body = b64urlJson(payload);
    const data = `${header}.${body}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url');
    return `${data}.${signature}`;
  };
  const payload = {
    iss: 'https://accounts.google.com',
    aud: 'google-client',
    exp: 2_000,
    email: 'Buyer@Example.com',
    email_verified: true,
  };
  const token = sign(payload);
  const verified = verifyRs256Jwt(token, {
    jwks: { keys: [jwk] },
    audience: 'google-client',
    issuers: ['https://accounts.google.com'],
    nowSec: 1_500,
  });
  assert.equal(verifiedEmailFromPayload(verified), 'buyer@example.com');
  assert.equal(verifiedEmailFromPayload({ ...payload, email_verified: 'true' }), 'buyer@example.com');
  assert.equal(verifiedEmailFromPayload({ ...payload, email_verified: false }), '');
  assert.equal(verifyRs256Jwt(token, {
    jwks: { keys: [jwk] },
    audience: 'other-client',
    issuers: ['https://accounts.google.com'],
    nowSec: 1_500,
  }), null);
  assert.equal(verifyRs256Jwt(token, {
    jwks: { keys: [jwk] },
    audience: 'google-client',
    issuers: ['https://accounts.google.com'],
    nowSec: 2_000,
  }), null);
  const tampered = `${token.slice(0, -4)}abcd`;
  assert.equal(verifyRs256Jwt(tampered, {
    jwks: { keys: [jwk] },
    audience: 'google-client',
    issuers: ['https://accounts.google.com'],
    nowSec: 1_500,
  }), null);
});

test('Apple client secret is an ES256 JWT for appleid.apple.com', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const secret = buildAppleClientSecret({
    teamId: 'TEAMID1234',
    clientId: 'ai.thumbgate.web',
    keyId: 'KEYID12345',
    privateKey: pem,
    nowSec: 1_700_000_000,
  });
  const [headerPart, bodyPart, signaturePart] = secret.split('.');
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
  const body = JSON.parse(Buffer.from(bodyPart, 'base64url').toString('utf8'));
  assert.equal(header.alg, 'ES256');
  assert.equal(header.kid, 'KEYID12345');
  assert.equal(body.iss, 'TEAMID1234');
  assert.equal(body.aud, 'https://appleid.apple.com');
  assert.equal(body.sub, 'ai.thumbgate.web');
  assert.equal(body.exp, body.iat + (60 * 60 * 24 * 150));
  assert.equal(crypto.verify(
    'SHA256',
    Buffer.from(`${headerPart}.${bodyPart}`),
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signaturePart, 'base64url'),
  ), true);
  const appleUrl = new URL(buildAppleAuthorizeUrl({
    clientId: 'ai.thumbgate.web',
    redirectUri: 'https://thumbgate.ai/v1/cloud/sso/callback',
    state: 'st_apple_test',
  }));
  assert.equal(appleUrl.searchParams.get('response_mode'), 'form_post');
  assert.equal(appleUrl.searchParams.get('redirect_uri'), 'https://thumbgate.ai/v1/cloud/sso/callback');
});

test('dashboard copy treats a verified SSO email as an account, not Pro', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
  assert.match(dashboard, /function showSignedInAccount/);
  assert.match(dashboard, /It is not a Pro license/);
  assert.doesNotMatch(dashboard, /id="ssoGoogleBtn"/);
  assert.doesNotMatch(dashboard, /id="ssoAppleBtn"/);
});

test('Google callback sets a session for a verified email and does not mark it Pro', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'callback-kid';
  const sign = (claims) => {
    const header = b64urlJson({ alg: 'RS256', kid: 'callback-kid' });
    const body = b64urlJson(claims);
    const data = `${header}.${body}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url');
    return `${data}.${signature}`;
  };
  const savedEnv = {
    THUMBGATE_API_KEY: process.env.THUMBGATE_API_KEY,
    THUMBGATE_OPERATOR_KEY: process.env.THUMBGATE_OPERATOR_KEY,
    THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
    THUMBGATE_PUBLIC_APP_ORIGIN: process.env.THUMBGATE_PUBLIC_APP_ORIGIN,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID,
    APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
    APPLE_KEY_ID: process.env.APPLE_KEY_ID,
    APPLE_PRIVATE_KEY: process.env.APPLE_PRIVATE_KEY,
  };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-sso-callback-'));
  const originalFetch = global.fetch;
  let postedRedirect = '';
  process.env.THUMBGATE_API_KEY = 'tg_admin_sso_test_999';
  process.env.THUMBGATE_OPERATOR_KEY = 'tg_op_sso_test_888';
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  process.env.STRIPE_SECRET_KEY = '';
  delete process.env.THUMBGATE_PUBLIC_APP_ORIGIN;
  delete process.env.APPLE_CLIENT_ID;
  delete process.env.APPLE_TEAM_ID;
  delete process.env.APPLE_KEY_ID;
  delete process.env.APPLE_PRIVATE_KEY;
  process.env.GOOGLE_CLIENT_ID = 'google-client-test.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'google-client-test-secret';

  const { startServer } = require('../src/api/server');
  const handle = await startServer({ port: 0, host: '127.0.0.1' });
  const origin = `http://127.0.0.1:${handle.port}`;
  process.env.THUMBGATE_PUBLIC_APP_ORIGIN = origin;
  global.fetch = async (url, opts = {}) => {
    const target = String(url);
    if (target === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(String(opts.body || ''));
      postedRedirect = form.get('redirect_uri') || '';
      assert.equal(form.get('client_id'), process.env.GOOGLE_CLIENT_ID);
      assert.equal(form.get('client_secret'), 'google-client-test-secret');
      assert.equal(form.get('grant_type'), 'authorization_code');
      const verified = form.get('code') !== 'unverified-code';
      return {
        ok: true,
        json: async () => ({
          id_token: sign({
            iss: 'https://accounts.google.com',
            aud: process.env.GOOGLE_CLIENT_ID,
            exp: Math.floor(Date.now() / 1000) + 600,
            email: 'buyer@example.com',
            email_verified: verified,
          }),
        }),
      };
    }
    if (target === 'https://www.googleapis.com/oauth2/v3/certs') {
      return { ok: true, json: async () => ({ keys: [jwk] }) };
    }
    return originalFetch(url, opts);
  };

  async function authorizeState() {
    const response = await fetch(`${origin}/v1/cloud/sso/authorize?provider=google`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    const location = response.headers.get('location') || '';
    assert.match(location, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    assert.doesNotMatch(location, /\/dashboard\?sso=/);
    return new URL(location).searchParams.get('state');
  }

  try {
    const missing = await fetch(`${origin}/v1/cloud/sso/callback?code=no-state`, { redirect: 'manual' });
    assert.equal(missing.status, 302);
    const missingDest = new URL(missing.headers.get('location'));
    assert.equal(missingDest.pathname, '/dashboard');
    assert.equal(missingDest.searchParams.get('auth_error'), 'sso_state_invalid');
    assert.equal(missingDest.searchParams.has('sso'), false);
    assert.equal(missing.headers.get('set-cookie'), null);

    const state = await authorizeState();
    const callback = await fetch(`${origin}/v1/cloud/sso/callback?code=good-code&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    assert.equal(callback.status, 302);
    const dest = new URL(callback.headers.get('location'));
    assert.equal(dest.origin, origin);
    assert.equal(dest.pathname, '/dashboard');
    assert.equal(dest.search, '');
    assert.equal(new URL(postedRedirect).pathname, '/v1/cloud/sso/callback');
    assert.equal(new URL(postedRedirect).search, '');
    const setCookie = callback.headers.get('set-cookie') || '';
    assert.match(setCookie, /^thumbgate_auth_session=[a-f0-9]{64};/);
    assert.match(setCookie, /\bHttpOnly\b/);
    assert.doesNotMatch(setCookie, /buyer@example.com|google-client-test-secret/);
    const session = await fetch(`${origin}/v1/auth/session`, {
      headers: { cookie: setCookie.split(';')[0] },
    });
    assert.equal(session.status, 200);
    const body = await session.json();
    assert.equal(body.authenticated, true);
    assert.equal(body.tier, 'Free');
    assert.notEqual(body.tier, 'Pro');
    assert.equal(body.ssoProvider, 'google');
    assert.equal(body.ssoEmail, 'buyer@example.com');

    const replay = await fetch(`${origin}/v1/cloud/sso/callback?code=good-code&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    assert.equal(replay.status, 302);
    assert.equal(new URL(replay.headers.get('location')).searchParams.get('auth_error'), 'sso_state_invalid');
    assert.equal(replay.headers.get('set-cookie'), null);

    const unverifiedState = await authorizeState();
    const unverified = await fetch(`${origin}/v1/cloud/sso/callback?code=unverified-code&state=${encodeURIComponent(unverifiedState)}`, { redirect: 'manual' });
    assert.equal(unverified.status, 302);
    assert.equal(new URL(unverified.headers.get('location')).searchParams.get('auth_error'), 'sso_email_unverified');
    assert.equal(unverified.headers.get('set-cookie'), null);
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => handle.server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
