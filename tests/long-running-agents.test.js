'use strict';

/**
 * Tests for the /long-running-agents landing page route handler.
 * Without these, SonarCloud's new-code coverage gate sees the route
 * handler block in src/api/server.js as untested and fails at <80%.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'long-running-agents-'));
const savedEnv = {};
const ENV = {
  _TEST_API_KEYS_PATH: path.join(tmpRoot, 'api-keys.json'),
  _TEST_FUNNEL_LEDGER_PATH: path.join(tmpRoot, 'funnel-events.jsonl'),
  _TEST_REVENUE_LEDGER_PATH: path.join(tmpRoot, 'revenue-events.jsonl'),
  _TEST_LOCAL_CHECKOUT_SESSIONS_PATH: path.join(tmpRoot, 'local-checkout-sessions.json'),
  THUMBGATE_FEEDBACK_DIR: path.join(tmpRoot, 'feedback'),
  THUMBGATE_API_KEY: 'test-api-key-lra',
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

describe('/long-running-agents landing page', () => {
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

  it('GET /long-running-agents returns 200 HTML with the runtime-story contract intact', async () => {
    const res = await fetch(`${origin}/long-running-agents`, {
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get('content-type')), /text\/html/);
    const body = await res.text();
    // Headline + the five attributed-quote contracts.
    assert.match(body, /Long-running agents need deterministic pre-action gates/);
    assert.match(body, /Seth Rogers/);
    assert.match(body, /Devin Cheevers/);
    assert.match(body, /Yaron Schneider/);
    assert.match(body, /Kyndryl/);
    assert.match(body, /Grafana Labs/);
    assert.match(body, /Diagrid/);
    // Mapping table contract.
    assert.match(body, /Durable execution graphs/);
    assert.match(body, /Long-lived state/);
    assert.match(body, /Asynchronous orchestration/);
    assert.match(body, /Delegated permissions/);
    // JSON-LD for AEO.
    assert.match(body, /"@type"\s*:\s*"TechArticle"/);
    assert.match(body, /Long-running AI agent governance/);
    assert.match(body, /Deterministic Pre-Action Checks/);
    // CTAs to existing pages.
    assert.match(body, /Workflow Hardening Sprint/);
    assert.match(body, /href="\/agent-manager"/);
    assert.match(body, /href="\/evals"/);
  });

  it('GET /long-running-agents.html serves the same content (alias parity)', async () => {
    const a = await fetch(`${origin}/long-running-agents`, { headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT } });
    const b = await fetch(`${origin}/long-running-agents.html`, { headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT } });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const aBody = await a.text();
    const bBody = await b.text();
    const h1Match = /Long-running agents need deterministic pre-action gates/;
    assert.match(aBody, h1Match);
    assert.match(bBody, h1Match);
  });

  it('HEAD /long-running-agents returns 200', async () => {
    const res = await fetch(`${origin}/long-running-agents`, { method: 'HEAD' });
    assert.equal(res.status, 200);
  });

  it('emits pageType:long_running_agents telemetry for attribution', async () => {
    try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
    await fetch(`${origin}/long-running-agents?utm_source=remy&utm_medium=tns_reply&utm_campaign=runtime_story`, {
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    const events = readTelemetry();
    const found = events.some((e) => e.pageType === 'long_running_agents' || (e.props || {}).pageType === 'long_running_agents');
    assert.ok(found, `expected pageType:'long_running_agents' tag; got: ${events.map((e) => e.eventType).join(', ')}`);
  });

  it('preserves UTM attribution in telemetry', async () => {
    try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
    await fetch(`${origin}/long-running-agents?utm_source=tns&utm_medium=article&utm_campaign=remy_runtime&cta_id=external_remy_post`, {
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    const events = readTelemetry();
    const withUtm = events.find((e) => e.utmSource === 'tns' || (e.props || {}).utmSource === 'tns');
    assert.ok(withUtm, 'utm_source should land in attribution metadata for /long-running-agents');
  });
});
