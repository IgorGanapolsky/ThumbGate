'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const oauth = require('../scripts/mcp-oauth');

function pkcePair() {
  const verifier = crypto.randomBytes(40).toString('base64url'); // 40 bytes -> ~54 chars (43–128 ok)
  const challenge = oauth.base64UrlSha256(verifier);
  return { verifier, challenge };
}

function registerTestClient(store, redirect = 'https://claude.ai/api/mcp/auth_callback') {
  return oauth.registerClient(store, { redirect_uris: [redirect], client_name: 'Claude' });
}

// --- metadata -------------------------------------------------------------

test('protected-resource metadata points at /mcp and the issuer', () => {
  const m = oauth.buildProtectedResourceMetadata('https://thumbgate.ai/');
  assert.equal(m.resource, 'https://thumbgate.ai/mcp');
  assert.deepEqual(m.authorization_servers, ['https://thumbgate.ai']);
});

test('auth-server metadata advertises S256 + the endpoints', () => {
  const m = oauth.buildAuthServerMetadata('https://thumbgate.ai');
  assert.equal(m.authorization_endpoint, 'https://thumbgate.ai/oauth/authorize');
  assert.equal(m.token_endpoint, 'https://thumbgate.ai/oauth/token');
  assert.equal(m.registration_endpoint, 'https://thumbgate.ai/oauth/register');
  assert.deepEqual(m.code_challenge_methods_supported, ['S256']);
  assert.ok(m.grant_types_supported.includes('authorization_code'));
});

// --- dynamic client registration ------------------------------------------

test('registerClient issues a client_id and stores it; rejects missing/invalid redirect', () => {
  const store = oauth.createStore();
  const c = registerTestClient(store);
  assert.match(c.client_id, /^tg_/);
  assert.ok(oauth.getClient(store, c.client_id));
  assert.equal(oauth.registerClient(store, {}).error, 'invalid_redirect_uri');
  assert.equal(oauth.registerClient(store, { redirect_uris: ['ftp://x'] }).error, 'invalid_redirect_uri');
});

// --- full PKCE authorization-code flow ------------------------------------

test('happy path: authorize -> token, bound key resolves', () => {
  const store = oauth.createStore();
  const client = registerTestClient(store);
  const { verifier, challenge } = pkcePair();
  const redirectUri = client.redirect_uris[0];

  const auth = oauth.createAuthorizationCode(store, {
    clientId: client.client_id,
    redirectUri,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    scope: 'mcp:read mcp:write',
    boundKey: 'tg_operator_key_123',
    state: 'xyz',
  });
  assert.ok(auth.code, 'code issued');
  assert.equal(auth.state, 'xyz');

  const tok = oauth.exchangeCode(store, {
    code: auth.code, codeVerifier: verifier, clientId: client.client_id, redirectUri,
  });
  assert.ok(tok.access_token, `token issued; got ${JSON.stringify(tok)}`);
  assert.equal(tok.token_type, 'Bearer');

  const session = oauth.resolveAccessToken(store, tok.access_token);
  assert.equal(session.boundKey, 'tg_operator_key_123');
  assert.match(session.scope, /mcp:read/);
});

test('PKCE is enforced: wrong verifier is rejected', () => {
  const store = oauth.createStore();
  const client = registerTestClient(store);
  const { challenge } = pkcePair();
  const redirectUri = client.redirect_uris[0];
  const auth = oauth.createAuthorizationCode(store, {
    clientId: client.client_id, redirectUri, codeChallenge: challenge, codeChallengeMethod: 'S256', boundKey: 'k',
  });
  const wrong = oauth.exchangeCode(store, {
    code: auth.code, codeVerifier: crypto.randomBytes(40).toString('base64url'), clientId: client.client_id, redirectUri,
  });
  assert.equal(wrong.error, 'invalid_grant');
});

test('plain code_challenge_method is rejected (S256 only)', () => {
  const store = oauth.createStore();
  const client = registerTestClient(store);
  const r = oauth.createAuthorizationCode(store, {
    clientId: client.client_id, redirectUri: client.redirect_uris[0],
    codeChallenge: 'x'.repeat(43), codeChallengeMethod: 'plain', boundKey: 'k',
  });
  assert.equal(r.error, 'invalid_request');
});

test('auth code is single-use', () => {
  const store = oauth.createStore();
  const client = registerTestClient(store);
  const { verifier, challenge } = pkcePair();
  const redirectUri = client.redirect_uris[0];
  const auth = oauth.createAuthorizationCode(store, {
    clientId: client.client_id, redirectUri, codeChallenge: challenge, codeChallengeMethod: 'S256', boundKey: 'k',
  });
  const first = oauth.exchangeCode(store, { code: auth.code, codeVerifier: verifier, clientId: client.client_id, redirectUri });
  assert.ok(first.access_token);
  const second = oauth.exchangeCode(store, { code: auth.code, codeVerifier: verifier, clientId: client.client_id, redirectUri });
  assert.equal(second.error, 'invalid_grant');
});

test('redirect_uri / client mismatch is rejected at token exchange', () => {
  const store = oauth.createStore();
  const client = registerTestClient(store);
  const { verifier, challenge } = pkcePair();
  const redirectUri = client.redirect_uris[0];
  const auth = oauth.createAuthorizationCode(store, {
    clientId: client.client_id, redirectUri, codeChallenge: challenge, codeChallengeMethod: 'S256', boundKey: 'k',
  });
  const r = oauth.exchangeCode(store, { code: auth.code, codeVerifier: verifier, clientId: 'tg_other', redirectUri });
  assert.equal(r.error, 'invalid_grant');
});

test('expired access token resolves to null', () => {
  const store = oauth.createStore();
  store.tokens.set('tgat_x', { boundKey: 'k', scope: 'mcp:read', clientId: 'c', expiresAt: Date.now() - 1 });
  assert.equal(oauth.resolveAccessToken(store, 'tgat_x'), null);
  assert.equal(oauth.resolveAccessToken(store, 'nope'), null);
});

test('authorize rejects unknown client + unregistered redirect_uri', () => {
  const store = oauth.createStore();
  assert.equal(oauth.createAuthorizationCode(store, { clientId: 'ghost', redirectUri: 'https://x', codeChallenge: 'y'.repeat(43), codeChallengeMethod: 'S256' }).error, 'invalid_client');
  const client = registerTestClient(store);
  assert.equal(oauth.createAuthorizationCode(store, { clientId: client.client_id, redirectUri: 'https://evil.example', codeChallenge: 'y'.repeat(43), codeChallengeMethod: 'S256' }).error, 'invalid_request');
});
