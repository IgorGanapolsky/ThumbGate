'use strict';

// Feedback given outside a local Claude Code session (claude.ai chats, Claude
// Desktop, Claude projects, cloud sessions) reaches ThumbGate through the
// hosted MCP connector, and the connector's sign-in survives a redeploy.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Local test traffic must not go through an outbound proxy.
for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) delete process.env[k];

const oauth = require('../scripts/mcp-oauth');

const ROOT = path.join(__dirname, '..');
const OPERATOR_KEY = 'hosted-everywhere-operator-key';
const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function pkce() {
  const verifier = crypto.randomBytes(40).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function issueCode(store, clientId, challenge, boundKey = 'k1') {
  return oauth.createAuthorizationCode(store, {
    clientId,
    redirectUri: REDIRECT_URI,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    scope: 'mcp:read mcp:write',
    boundKey,
    resource: 'https://thumbgate.ai/mcp',
  }).code;
}

test('refresh tokens rotate, are single-use and cannot widen scope', () => {
  const store = oauth.createStore();
  const client = oauth.registerClient(store, { redirect_uris: [REDIRECT_URI] });
  assert.ok(client.grant_types.includes('refresh_token'));
  const { verifier, challenge } = pkce();
  const tok = oauth.exchangeCode(store, {
    code: issueCode(store, client.client_id, challenge),
    codeVerifier: verifier,
    clientId: client.client_id,
    redirectUri: REDIRECT_URI,
  });
  assert.match(tok.refresh_token, /^tgrt_/);

  const next = oauth.refreshAccessToken(store, { refreshToken: tok.refresh_token, clientId: client.client_id });
  assert.ok(next.access_token && next.access_token !== tok.access_token);
  assert.ok(next.refresh_token && next.refresh_token !== tok.refresh_token);
  assert.ok(oauth.resolveAccessToken(store, next.access_token));

  assert.equal(oauth.refreshAccessToken(store, { refreshToken: tok.refresh_token, clientId: client.client_id }).error, 'invalid_grant', 'old refresh token is spent');

  const third = oauth.refreshAccessToken(store, { refreshToken: next.refresh_token, clientId: client.client_id, scope: 'mcp:read' });
  assert.equal(third.scope, 'mcp:read', 'scope can narrow');
  assert.equal(oauth.refreshAccessToken(store, { refreshToken: third.refresh_token, clientId: client.client_id, scope: 'mcp:write' }).error, 'invalid_scope', 'scope cannot widen');
  const second = pkce();
  const tok2 = oauth.exchangeCode(store, {
    code: issueCode(store, client.client_id, second.challenge),
    codeVerifier: second.verifier,
    clientId: client.client_id,
    redirectUri: REDIRECT_URI,
  });
  assert.equal(oauth.refreshAccessToken(store, { refreshToken: tok2.refresh_token, clientId: 'tg_other' }).error, 'invalid_grant', 'client binding enforced');
  assert.deepEqual(oauth.buildAuthServerMetadata('https://thumbgate.ai').grant_types_supported, ['authorization_code', 'refresh_token']);
});

test('durable store survives a restart, keeps no plaintext secrets, and drops sessions of a rotated key', () => {
  const dir = tmpDir('tg-oauth-store-');
  const persistPath = path.join(dir, 'store.json');
  const store = oauth.createStore({ persistPath, knownKeys: ['k1'] });
  const client = oauth.registerClient(store, { redirect_uris: [REDIRECT_URI] });
  const { verifier, challenge } = pkce();
  const tok = oauth.exchangeCode(store, {
    code: issueCode(store, client.client_id, challenge, 'k1'),
    codeVerifier: verifier,
    clientId: client.client_id,
    redirectUri: REDIRECT_URI,
  });

  const onDisk = fs.readFileSync(persistPath, 'utf8');
  assert.ok(!onDisk.includes(tok.access_token), 'access token not stored in plaintext');
  assert.ok(!onDisk.includes(tok.refresh_token), 'refresh token not stored in plaintext');
  assert.ok(!onDisk.includes('"k1"'), 'bound key not stored in plaintext');

  const restarted = oauth.createStore({ persistPath, knownKeys: ['k1'] });
  assert.ok(oauth.getClient(restarted, client.client_id), 'registered client survives restart');
  const session = oauth.resolveAccessToken(restarted, tok.access_token);
  assert.equal(session && session.boundKey, 'k1', 'access token survives restart');
  assert.ok(oauth.refreshAccessToken(restarted, { refreshToken: tok.refresh_token, clientId: client.client_id }).access_token, 'refresh survives restart');

  const rotated = oauth.createStore({ persistPath, knownKeys: ['k2'] });
  assert.equal(oauth.resolveAccessToken(rotated, tok.access_token), null, 'rotating the key revokes its sessions');
});

function startServerProcess(env) {
  return new Promise((resolve, reject) => {
    const script = "const {startServer}=require('./src/api/server');startServer({port:0,host:'127.0.0.1'}).then(h=>process.stdout.write('PORT '+h.port+'\\n'));";
    const child = spawn(process.execPath, ['-e', script], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out}`)), 30000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/PORT (\d+)/);
      if (m) { clearTimeout(timer); resolve({ child, base: `http://127.0.0.1:${m[1]}` }); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${out}`)); });
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.removeAllListeners('exit');
  await new Promise((resolve) => { child.once('exit', resolve); child.kill('SIGTERM'); });
}

async function signIn(base) {
  const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
  const reg = await (await fetch(`${base}/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [REDIRECT_URI], client_name: 'Claude' }),
  })).json();
  const { verifier, challenge } = pkce();
  const url = new URL(`${base}/oauth/authorize`);
  for (const [k, v] of Object.entries({ client_id: reg.client_id, redirect_uri: REDIRECT_URI, code_challenge: challenge, code_challenge_method: 'S256', scope: 'mcp:read mcp:write', state: 's', resource: prm.resource })) url.searchParams.set(k, v);
  const html = await (await fetch(url)).text();
  const authToken = html.match(/name="auth_request_token" value="([^"]+)"/)[1];
  const auth = await fetch(`${base}/oauth/authorize`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ auth_request_token: authToken, api_key: OPERATOR_KEY, approve: 'yes' }).toString(),
  });
  const code = new URL(auth.headers.get('location')).searchParams.get('code');
  const tok = await (await fetch(`${base}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: REDIRECT_URI, resource: prm.resource }).toString(),
  })).json();
  return { tok, clientId: reg.client_id, resource: prm.resource };
}

function mcp(base, method, params, token) {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

test('end to end: chat thumbs-down via hosted connector after a redeploy and a token refresh', { timeout: 120000 }, async () => {
  const serverDir = tmpDir('tg-hosted-server-');
  const env = {
    THUMBGATE_ALLOW_INSECURE: 'true',
    THUMBGATE_OPERATOR_KEY: OPERATOR_KEY,
    THUMBGATE_API_KEY: '',
    THUMBGATE_REVIEWER_KEY: '',
    THUMBGATE_FEEDBACK_DIR: serverDir,
    THUMBGATE_PUBLIC_APP_ORIGIN: 'http://127.0.0.1',
  };
  let server = await startServerProcess(env);
  try {
    // The connector tells the model to record thumbs feedback.
    const init = await (await mcp(server.base, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })).json();
    assert.equal(init.result.protocolVersion, '2025-06-18', 'negotiates the client version');
    assert.match(init.result.instructions, /capture_feedback/);
    assert.match(init.result.instructions, /thumbs-down/);
    assert.equal((await mcp(server.base, 'notifications/initialized', {})).status, 202);
    const sse = await fetch(`${server.base}/mcp`, { headers: { Accept: 'text/event-stream' } });
    assert.equal(sse.status, 405, 'no SSE stream offered');

    const { tok, clientId, resource } = await signIn(server.base);
    assert.ok(tok.refresh_token, 'token response carries a refresh token');

    // Redeploy: new process, same volume.
    await stopServer(server.child);
    server = await startServerProcess(env);

    const okAfterRestart = await mcp(server.base, 'tools/call', { name: 'feedback_summary', arguments: {} }, tok.access_token);
    assert.equal(okAfterRestart.status, 200, 'access token still valid after a redeploy');

    const refreshed = await (await fetch(`${server.base}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: clientId, resource }).toString(),
    })).json();
    assert.ok(refreshed.access_token, `refresh works after a redeploy: ${JSON.stringify(refreshed)}`);

    const captured = await (await mcp(server.base, 'tools/call', {
      name: 'capture_feedback',
      arguments: {
        signal: 'down',
        context: 'In a claude.ai chat the assistant said the site was deployed without checking it',
        whatWentWrong: 'Said deployed without running curl on /health first',
        whatToChange: 'Run curl on /health and show the version before saying deployed',
        tags: ['claude-ai-chat'],
      },
    }, refreshed.access_token)).json();
    assert.match(captured.result.content[0].text, /"accepted": true/);

  } finally {
    await stopServer(server.child);
  }
});
