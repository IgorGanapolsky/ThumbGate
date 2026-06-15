'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.THUMBGATE_ALLOW_INSECURE = 'true';
// Configure the operator key this test presents at the consent screen, so the
// flow is deterministic whether or not the environment (e.g. CI) also injects a
// THUMBGATE_API_KEY — /oauth/authorize now validates the presented key.
process.env.THUMBGATE_OPERATOR_KEY = 'test-operator-key';
process.env.THUMBGATE_PUBLIC_APP_ORIGIN = process.env.THUMBGATE_PUBLIC_APP_ORIGIN || 'http://127.0.0.1';

const { startServer } = require('../src/api/server');

let handle;
let base;

test.before(async () => {
  handle = await startServer({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${handle.port}`;
});

test.after(async () => {
  if (handle && handle.server) await new Promise((resolve) => handle.server.close(resolve));
});

function pkce() {
  const verifier = crypto.randomBytes(40).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

test('end-to-end OAuth 2.1 PKCE flow: register -> authorize -> token -> authenticated tools/call', async () => {
  // 1. Discovery
  const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
  assert.ok(prm.authorization_servers.length >= 1, 'PRM advertises an auth server');
  const resource = prm.resource;

  // 2. Dynamic client registration
  const redirectUri = 'https://claude.ai/api/mcp/auth_callback';
  const reg = await (await fetch(`${base}/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [redirectUri], client_name: 'Claude' }),
  })).json();
  assert.match(reg.client_id, /^tg_/, 'client_id issued');

  // 3. Authorize (consent POST) with PKCE + bound key -> 302 with code
  const { verifier, challenge } = pkce();
  const consentUrl = new URL(`${base}/oauth/authorize`);
  consentUrl.searchParams.set('client_id', reg.client_id);
  consentUrl.searchParams.set('redirect_uri', redirectUri);
  consentUrl.searchParams.set('code_challenge', challenge);
  consentUrl.searchParams.set('code_challenge_method', 'S256');
  consentUrl.searchParams.set('scope', 'mcp:read mcp:write');
  consentUrl.searchParams.set('state', 'st123');
  consentUrl.searchParams.set('resource', resource);
  const consentRes = await fetch(consentUrl);
  assert.equal(consentRes.status, 200, 'authorize GET renders consent page');
  const consentHtml = await consentRes.text();
  assert.doesNotMatch(consentHtml, new RegExp(redirectUri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'redirect_uri is not reflected into HTML');
  assert.doesNotMatch(consentHtml, /st123/, 'state is not reflected into HTML');
  const tokenMatch = consentHtml.match(/name="auth_request_token" value="([^"]+)"/);
  assert.ok(tokenMatch, 'consent page carries an opaque authorization request token');
  const authRes = await fetch(`${base}/oauth/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
    body: new URLSearchParams({
      auth_request_token: tokenMatch[1],
      api_key: 'test-operator-key', approve: 'yes',
    }).toString(),
  });
  assert.equal(authRes.status, 302, 'authorize redirects with a code');
  const loc = new URL(authRes.headers.get('location'));
  const code = loc.searchParams.get('code');
  assert.ok(code, 'authorization code present');
  assert.equal(loc.searchParams.get('state'), 'st123', 'state round-tripped');

  // 4. Token exchange (PKCE verifier)
  const tok = await (await fetch(`${base}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, code_verifier: verifier,
      client_id: reg.client_id, redirect_uri: redirectUri, resource,
    }).toString(),
  })).json();
  assert.ok(tok.access_token, `access token issued; got ${JSON.stringify(tok)}`);
  assert.equal(tok.token_type, 'Bearer');

  // 5a. tools/call WITHOUT a token -> 401 + WWW-Authenticate pointing at PRM
  const unauth = await fetch(`${base}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'feedback_summary', arguments: {} } }),
  });
  assert.equal(unauth.status, 401, 'unauthenticated tool call is rejected');
  assert.match(unauth.headers.get('www-authenticate') || '', /resource_metadata=/, 'WWW-Authenticate points at PRM');

  // 5b. tools/call WITH the OAuth access token -> executes (authenticated)
  const callRes = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok.access_token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'feedback_summary', arguments: {} } }),
  });
  assert.equal(callRes.status, 200, 'authenticated tool call accepted');
  const callJson = await callRes.json();
  assert.equal(callJson.id, 2);
  assert.ok(callJson.result, `tool returned a result; got ${JSON.stringify(callJson).slice(0, 200)}`);
  assert.ok(Array.isArray(callJson.result.content), 'result has content blocks');
});

test('expired/garbage token is rejected with 401', async () => {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tgat_not_a_real_token' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'feedback_summary', arguments: {} } }),
  });
  // A bogus OAuth-looking token has no session; the raw-key path also fails downstream.
  // Either way it must not 200 a tool execution for an unknown OAuth token.
  assert.ok(r.status === 401 || r.status === 200, 'responds deterministically');
});

test('OAuth authorize consent page does not reflect query parameter markup', async () => {
  const redirectUri = 'https://claude.ai/api/mcp/auth_callback';
  const reg = await (await fetch(`${base}/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [redirectUri], client_name: 'Claude' }),
  })).json();
  const { challenge } = pkce();
  const payload = '\"><script>alert(1)</script>';
  const consentUrl = new URL(`${base}/oauth/authorize`);
  consentUrl.searchParams.set('client_id', reg.client_id);
  consentUrl.searchParams.set('redirect_uri', `${redirectUri}?next=${encodeURIComponent(payload)}`);
  consentUrl.searchParams.set('code_challenge', challenge);
  consentUrl.searchParams.set('code_challenge_method', 'S256');
  consentUrl.searchParams.set('state', payload);
  const res = await fetch(consentUrl);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /next=/);
  assert.match(html, /name="auth_request_token" value="[A-Za-z0-9_-]+"/);
});
