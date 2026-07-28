'use strict';

// Configured-key path: when ThumbGate keys are set (production posture), the
// OAuth consent key MUST validate, and the reviewer key is read-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ADMIN_KEY = 'admin-key-for-tests';
const REVIEWER_KEY = 'reviewer-key-for-tests';
const SAVED_FEEDBACK_DIR = process.env.THUMBGATE_FEEDBACK_DIR;
const FEEDBACK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-mcp-oauth-kpi-'));
process.env.THUMBGATE_API_KEY = ADMIN_KEY;
process.env.THUMBGATE_REVIEWER_KEY = REVIEWER_KEY;
process.env.THUMBGATE_ALLOW_INSECURE = 'true';
process.env.THUMBGATE_PUBLIC_APP_ORIGIN = process.env.THUMBGATE_PUBLIC_APP_ORIGIN || 'http://127.0.0.1';
process.env.THUMBGATE_FEEDBACK_DIR = FEEDBACK_DIR;

const { startServer } = require('../src/api/server');

let handle;
let base;
let resource;

test.before(async () => {
  handle = await startServer({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${handle.port}`;
  const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
  resource = prm.resource;
});

test.after(async () => {
  if (handle && handle.server) await new Promise((r) => handle.server.close(r));
  if (SAVED_FEEDBACK_DIR === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
  else process.env.THUMBGATE_FEEDBACK_DIR = SAVED_FEEDBACK_DIR;
  fs.rmSync(FEEDBACK_DIR, { recursive: true, force: true });
});

function pkce() {
  const verifier = crypto.randomBytes(40).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

async function register() {
  const r = await (await fetch(`${base}/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: 'test' }),
  })).json();
  return r.client_id;
}

async function authorize(clientId, apiKey, scope = 'mcp:read mcp:write') {
  const { verifier, challenge } = pkce();
  const res = await fetch(`${base}/oauth/authorize`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge,
      code_challenge_method: 'S256', scope, state: 's',
      resource, api_key: apiKey, approve: 'yes',
    }).toString(),
  });
  return { res, verifier };
}

async function tokenFor(apiKey, scope) {
  const clientId = await register();
  const { res, verifier } = await authorize(clientId, apiKey, scope);
  assert.equal(res.status, 302, 'valid key authorizes');
  const code = new URL(res.headers.get('location')).searchParams.get('code');
  const tok = await (await fetch(`${base}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT, resource }).toString(),
  })).json();
  return tok.access_token;
}

async function callTool(token, name) {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: {} } }),
  });
  return (await r.json());
}

test('authorize rejects an unrecognized key when keys are configured', async () => {
  const clientId = await register();
  const { res } = await authorize(clientId, 'totally-bogus-key');
  assert.equal(res.status, 400, 'garbage key is rejected (no code issued)');
});

test('reviewer key is read-only: read tools execute, write tools are blocked', async () => {
  // Discover a read-only and a write tool from the live tool list.
  const list = await (await fetch(`${base}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })).json();
  const tools = list.result.tools;
  const readTool = tools.find((t) => t.annotations && t.annotations.readOnlyHint === true);
  const writeTool = tools.find((t) => !(t.annotations && t.annotations.readOnlyHint === true));
  assert.ok(readTool, 'a read-only tool exists');
  assert.ok(writeTool, 'a write tool exists');

  const reviewerTok = await tokenFor(REVIEWER_KEY, 'mcp:read');
  const readRes = await callTool(reviewerTok, readTool.name);
  assert.notEqual(readRes.error && readRes.error.code, -32002, `reviewer may call read tool ${readTool.name}`);
  const writeRes = await callTool(reviewerTok, writeTool.name);
  assert.equal(writeRes.error && writeRes.error.code, -32002, `reviewer is blocked from write tool ${writeTool.name}`);

  // Admin key has full access — not blocked on the same write tool.
  const adminTok = await tokenFor(ADMIN_KEY);
  const adminWrite = await callTool(adminTok, writeTool.name);
  assert.notEqual(adminWrite.error && adminWrite.error.code, -32002, 'admin is not read-only restricted');
});

test('OAuth scope blocks write tools even for an admin-bound token', async () => {
  const list = await (await fetch(`${base}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/list', params: {} }),
  })).json();
  const writeTool = list.result.tools.find((tool) => tool.annotations?.destructiveHint === true);
  assert.ok(writeTool);
  const readOnlyAdminToken = await tokenFor(ADMIN_KEY, 'mcp:read');
  const response = await callTool(readOnlyAdminToken, writeTool.name);
  assert.equal(response.error?.code, -32003);
  const kpiEntries = fs.readFileSync(path.join(FEEDBACK_DIR, 'tool-kpi.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.ok(kpiEntries.some((entry) => (
    entry.toolName === writeTool.name
      && entry.success === false
      && entry.metadata?.deniedReason === 'insufficient_scope'
      && entry.metadata?.requiredScope === 'mcp:write'
  )));
});
