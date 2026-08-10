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

test('registerClient enforces MCP redirect_uri rule: only HTTPS or loopback, reject all custom/other schemes', () => {
  const store = oauth.createStore();
  // Per the MCP auth spec, redirect URIs MUST be localhost or HTTPS. Everything
  // else — custom app schemes included — is rejected.
  for (const bad of ['intent://x', 'com.example.app://cb', 'myapp://cb', 'tel://123', 'javascript://alert', 'data://x', 'http://evil.example/cb', 'ftp://x']) {
    assert.equal(oauth.isAllowedRedirectUri(bad), false, bad);
    assert.equal(oauth.registerClient(store, { redirect_uris: [bad] }).error, 'invalid_redirect_uri', bad);
  }
  // HTTPS and loopback are allowed (what real MCP clients use).
  for (const good of ['https://claude.ai/api/mcp/auth_callback', 'http://localhost:3000/callback', 'http://127.0.0.1:8123/cb']) {
    assert.equal(oauth.isAllowedRedirectUri(good), true, good);
    assert.match(oauth.registerClient(store, { redirect_uris: [good] }).client_id, /^tg_/, good);
  }
});

test('in-memory store is bounded — oldest entries are evicted past the cap (DoS guard)', () => {
  const store = oauth.createStore();
  const overBy = 25;
  for (let i = 0; i < oauth.MAX_CLIENTS + overBy; i++) {
    oauth.registerClient(store, { redirect_uris: [`https://c${i}.example/cb`] });
  }
  assert.equal(store.clients.size, oauth.MAX_CLIENTS, 'client map never exceeds MAX_CLIENTS');
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
  assert.equal(oauth.scopeAllows(session, 'mcp:read'), true);
  assert.equal(oauth.scopeAllows(session, 'mcp:write'), true);
});

test('authorization rejects unsupported and role-disallowed scopes', () => {
  const store = oauth.createStore();
  const client = registerTestClient(store);
  const { challenge } = pkcePair();
  const base = {
    clientId: client.client_id,
    redirectUri: client.redirect_uris[0],
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    boundKey: 'k',
  };
  assert.equal(oauth.createAuthorizationCode(store, {
    ...base,
    scope: 'mcp:admin',
  }).error, 'invalid_scope');
  assert.equal(oauth.createAuthorizationCode(store, {
    ...base,
    scope: 'mcp:read mcp:write',
    allowedScopes: ['mcp:read'],
  }).error, 'invalid_scope');
  const readOnly = oauth.createAuthorizationCode(store, {
    ...base,
    scope: 'mcp:read',
    allowedScopes: ['mcp:read'],
  });
  assert.ok(readOnly.code);
});

test('scopeAllows rejects malformed token scope sets instead of partially authorizing them', () => {
  assert.equal(oauth.scopeAllows({ scope: 'mcp:read' }, 'mcp:read'), true);
  assert.equal(oauth.scopeAllows({ scope: 'mcp:read unsupported' }, 'mcp:read'), false);
  assert.equal(oauth.scopeAllows(null, 'mcp:read'), false);
  assert.equal(oauth.scopeAllows({ scope: 'mcp:read' }, ''), false);
});

test('scopeAllows hierarchy: mcp:write implies read, gates, and feedback (WorkOS MCP Auth style)', () => {
  const writeOnly = { scope: 'mcp:write' };
  assert.equal(oauth.scopeAllows(writeOnly, 'mcp:write'), true);
  assert.equal(oauth.scopeAllows(writeOnly, 'mcp:read'), true);
  assert.equal(oauth.scopeAllows(writeOnly, 'mcp:gates'), true);
  assert.equal(oauth.scopeAllows(writeOnly, 'mcp:feedback'), true);

  const readOnly = { scope: 'mcp:read' };
  assert.equal(oauth.scopeAllows(readOnly, 'mcp:read'), true);
  assert.equal(oauth.scopeAllows(readOnly, 'mcp:write'), false);
  assert.equal(oauth.scopeAllows(readOnly, 'mcp:gates'), false);

  const gatesOnly = { scope: 'mcp:gates' };
  assert.equal(oauth.scopeAllows(gatesOnly, 'mcp:gates'), true);
  assert.equal(oauth.scopeAllows(gatesOnly, 'mcp:read'), true);
  assert.equal(oauth.scopeAllows(gatesOnly, 'mcp:write'), false);
});

test('requiredScopeForTool maps annotations to minimum scopes', () => {
  assert.equal(oauth.requiredScopeForTool({ annotations: { readOnlyHint: true } }), 'mcp:read');
  assert.equal(oauth.requiredScopeForTool({ annotations: {} }), 'mcp:write');
  assert.equal(oauth.requiredScopeForTool({}), 'mcp:write');
  assert.equal(
    oauth.requiredScopeForTool({ annotations: { thumbgateScope: 'mcp:gates' } }),
    'mcp:gates',
  );
  assert.equal(
    oauth.requiredScopeForTool({ annotations: { thumbgateScope: 'mcp:feedback' } }),
    'mcp:feedback',
  );
  // Unknown explicit scope falls back to write
  assert.equal(
    oauth.requiredScopeForTool({ annotations: { thumbgateScope: 'mcp:admin' } }),
    'mcp:write',
  );
});

test('metadata advertises hierarchical scopes including gates and feedback', () => {
  const resource = oauth.buildProtectedResourceMetadata('https://thumbgate.ai');
  const server = oauth.buildAuthServerMetadata('https://thumbgate.ai');
  for (const scope of ['mcp:read', 'mcp:write', 'mcp:gates', 'mcp:feedback']) {
    assert.ok(resource.scopes_supported.includes(scope), scope);
    assert.ok(server.scopes_supported.includes(scope), scope);
  }
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

test('RFC 8707: token is audience-bound to the resource, mismatch rejected', () => {
  const store = oauth.createStore();
  const client = registerTestClient(store);
  const { verifier, challenge } = pkcePair();
  const redirectUri = client.redirect_uris[0];
  const resource = 'https://thumbgate.ai/mcp';
  const auth = oauth.createAuthorizationCode(store, {
    clientId: client.client_id, redirectUri, codeChallenge: challenge, codeChallengeMethod: 'S256', boundKey: 'k', resource,
  });
  // resource mismatch at token time -> invalid_target
  const bad = oauth.exchangeCode(store, { code: auth.code, codeVerifier: verifier, clientId: client.client_id, redirectUri, resource: 'https://evil.example/mcp' });
  assert.equal(bad.error, 'invalid_target');

  // matching resource -> token carries the audience
  const auth2 = oauth.createAuthorizationCode(store, {
    clientId: client.client_id, redirectUri, codeChallenge: challenge, codeChallengeMethod: 'S256', boundKey: 'k', resource,
  });
  const tok = oauth.exchangeCode(store, { code: auth2.code, codeVerifier: verifier, clientId: client.client_id, redirectUri, resource });
  const session = oauth.resolveAccessToken(store, tok.access_token);
  assert.equal(session.aud, resource);
  assert.equal(oauth.tokenAudienceValid(session, resource), true);
  assert.equal(oauth.tokenAudienceValid(session, 'https://other.example/mcp'), false);
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

test('tool registry binds capture_feedback to mcp:feedback and read tools to mcp:read', () => {
  const { TOOLS } = require('../scripts/tool-registry');
  const capture = TOOLS.find((t) => t.name === 'capture_feedback');
  assert.ok(capture, 'capture_feedback exists');
  assert.equal(oauth.requiredScopeForTool(capture), 'mcp:feedback');
  assert.equal(oauth.scopeAllows({ scope: 'mcp:feedback' }, 'mcp:feedback'), true);
  assert.equal(oauth.scopeAllows({ scope: 'mcp:feedback' }, 'mcp:write'), false);

  const search = TOOLS.find((t) => t.name === 'search_lessons');
  assert.ok(search);
  assert.equal(oauth.requiredScopeForTool(search), 'mcp:read');
  assert.equal(oauth.scopeAllows({ scope: 'mcp:feedback' }, 'mcp:read'), true);
});
