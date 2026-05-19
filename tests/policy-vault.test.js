'use strict';

/**
 * Tests for the /policy-vault landing page route handler.
 * Without these, SonarCloud's new-code coverage gate sees the route
 * handler block in src/api/server.js as untested.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-vault-'));
const savedEnv = {};
const ENV = {
  _TEST_API_KEYS_PATH: path.join(tmpRoot, 'api-keys.json'),
  _TEST_FUNNEL_LEDGER_PATH: path.join(tmpRoot, 'funnel-events.jsonl'),
  _TEST_REVENUE_LEDGER_PATH: path.join(tmpRoot, 'revenue-events.jsonl'),
  _TEST_LOCAL_CHECKOUT_SESSIONS_PATH: path.join(tmpRoot, 'local-checkout-sessions.json'),
  THUMBGATE_FEEDBACK_DIR: path.join(tmpRoot, 'feedback'),
  THUMBGATE_API_KEY: 'test-api-key-pv',
  STRIPE_SECRET_KEY: '',
  STRIPE_PRICE_ID: '',
};
for (const [k, v] of Object.entries(ENV)) {
  savedEnv[k] = process.env[k];
  process.env[k] = v;
}
fs.mkdirSync(ENV.THUMBGATE_FEEDBACK_DIR, { recursive: true });

const { startServer } = require('../src/api/server');

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

let handle;
let origin = '';

function readTelemetry() {
  const p = path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl');
  try {
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

describe('/policy-vault landing page', () => {
  before(async () => {
    handle = await startServer({ port: 0, host: '127.0.0.1' });
    origin = `http://127.0.0.1:${handle.port}`;
  });

  after(async () => {
    if (handle) handle.server.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('GET /policy-vault returns 200 HTML with the eight-prescription contract intact', async () => {
    const res = await fetch(`${origin}/policy-vault`, {
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get('content-type')), /text\/html/);
    const body = await res.text();
    // Headline + every prescription row in the mapping table.
    assert.match(body, /covers six of the eight prescriptions deterministically/);
    assert.match(body, /Map the last-mile surface/);
    assert.match(body, /Identity, context, delegation explicit/);
    assert.match(body, /Vault \/ gateway in front of legacy/);
    assert.match(body, /ABAC \/ PBAC policies/);
    assert.match(body, /Replace shared keys with short-lived credentials/);
    assert.match(body, /Telemetry \+ feedback loops/);
    assert.match(body, /Constrain tool chaining/);
    assert.match(body, /Threat model the agent as a potential attacker/);
    // Honest boundary: prescription 5 must be explicitly marked as
    // out of scope, not silently claimed.
    assert.match(body, /Out of scope/);
    assert.match(body, /HashiCorp Vault/);
    assert.match(body, /AWS STS/);
    // JSON-LD for AEO.
    assert.match(body, /"@type"\s*:\s*"TechArticle"/);
    assert.match(body, /AI agent policy vault/);
    assert.match(body, /Tool-call boundary enforcement/);
    // Links to sibling ICP pages.
    assert.match(body, /href="\/long-running-agents"/);
    assert.match(body, /href="\/agent-manager"/);
    assert.match(body, /href="\/evals"/);
  });

  it('GET /policy-vault.html serves the same content (alias parity)', async () => {
    const a = await fetch(`${origin}/policy-vault`, { headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT } });
    const b = await fetch(`${origin}/policy-vault.html`, { headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT } });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const aBody = await a.text();
    const bBody = await b.text();
    const headlineMatch = /AI-agent policy vault is the new last-mile control/;
    assert.match(aBody, headlineMatch);
    assert.match(bBody, headlineMatch);
  });

  it('HEAD /policy-vault returns 200', async () => {
    const res = await fetch(`${origin}/policy-vault`, { method: 'HEAD' });
    assert.equal(res.status, 200);
  });

  it('emits pageType:policy_vault telemetry for attribution', async () => {
    try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
    await fetch(`${origin}/policy-vault?utm_source=vault_video&utm_medium=youtube&utm_campaign=last_mile`, {
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    const events = readTelemetry();
    const found = events.some((e) => e.pageType === 'policy_vault' || (e.props || {}).pageType === 'policy_vault');
    assert.ok(found, `expected pageType:'policy_vault' tag; got: ${events.map((e) => e.eventType).join(', ')}`);
  });

  it('preserves UTM attribution in telemetry', async () => {
    try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
    await fetch(`${origin}/policy-vault?utm_source=hashicorp&utm_medium=outbound&utm_campaign=enforcement_layer&cta_id=hashicorp_partner_post`, {
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    const events = readTelemetry();
    const withUtm = events.find((e) => e.utmSource === 'hashicorp' || (e.props || {}).utmSource === 'hashicorp');
    assert.ok(withUtm, 'utm_source should land in attribution metadata for /policy-vault');
  });
});
