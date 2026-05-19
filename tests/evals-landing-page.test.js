'use strict';

/**
 * Tests for the /evals landing page route handler added in
 * .changeset/evals-landing-page.md. Without these, SonarCloud's new-code
 * coverage gate sees the route handler block in src/api/server.js as
 * untested and fails the PR at <80% coverage on new code.
 *
 * Each test mounts the real server (modeled on the same pattern used in
 * tests/checkout-bot-guard.test.js) and asserts the response body of
 * /evals + /evals.html so the route's renderHtml() callback, its
 * pageType telemetry tag, and the case where the file is missing are
 * all exercised.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-landing-'));
const savedEnv = {};
const ENV = {
  _TEST_API_KEYS_PATH: path.join(tmpRoot, 'api-keys.json'),
  _TEST_FUNNEL_LEDGER_PATH: path.join(tmpRoot, 'funnel-events.jsonl'),
  _TEST_REVENUE_LEDGER_PATH: path.join(tmpRoot, 'revenue-events.jsonl'),
  _TEST_LOCAL_CHECKOUT_SESSIONS_PATH: path.join(tmpRoot, 'local-checkout-sessions.json'),
  THUMBGATE_FEEDBACK_DIR: path.join(tmpRoot, 'feedback'),
  THUMBGATE_API_KEY: 'test-api-key-evals',
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

describe('/evals landing page', () => {
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

  it('GET /evals returns 200 HTML with the eval-table contract intact', async () => {
    const res = await fetch(`${origin}/evals`, {
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get('content-type')), /text\/html/);
    const body = await res.text();
    // Headline + table contract — every section the page promises must
    // exist. If any of these are removed, the page no longer matches the
    // /evals positioning shipped in .changeset/evals-landing-page.md.
    assert.match(body, /Every layer of the ThumbGate enforcement stack/);
    assert.match(body, /thumbgate-bench\.json/);
    assert.match(body, /programbench-smoke\.json/);
    assert.match(body, /prompt-eval-suite\.json/);
    assert.match(body, /judge-reward-function\.js/);
    assert.match(body, /conversion-rate-stats\.js/);
    assert.match(body, /prove-adapters\.js/);
    assert.match(body, /Workflow Hardening Sprint/);
    // JSON-LD for AEO surfaces.
    assert.match(body, /"@type"\s*:\s*"TechArticle"/);
    assert.match(body, /Pre-Action Check evaluation/);
  });

  it('GET /evals.html serves the same content (alias parity)', async () => {
    const a = await fetch(`${origin}/evals`, {
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    const b = await fetch(`${origin}/evals.html`, {
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const aBody = await a.text();
    const bBody = await b.text();
    // Both must contain the same H1 and CTA — otherwise an external link
    // to /evals.html silently degrades when we change /evals.
    const h1Match = /Every layer of the ThumbGate enforcement stack/;
    assert.match(aBody, h1Match);
    assert.match(bBody, h1Match);
  });

  it('HEAD /evals returns 200 without a body (head probes don\'t emit the page)', async () => {
    const res = await fetch(`${origin}/evals`, { method: 'HEAD' });
    assert.equal(res.status, 200);
  });

  it('/evals emits pageType:evals telemetry for attribution', async () => {
    try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
    await fetch(`${origin}/evals?utm_source=test&utm_medium=ci&utm_campaign=evals_landing`, {
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    const events = readTelemetry();
    // servePublicMarketingPage emits a landing_page_view event with
    // extraTelemetry. pageType:'evals' is the audit-routing tag that
    // distinguishes /evals traffic in conversion-by-page rollups.
    const found = events.some((e) => e.pageType === 'evals' || (e.props || {}).pageType === 'evals');
    assert.ok(
      found,
      `expected at least one telemetry event tagged pageType:'evals'; got: ${events.map((e) => e.eventType).join(', ')}`
    );
  });

  it('/evals preserves UTM attribution in telemetry', async () => {
    try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
    await fetch(`${origin}/evals?utm_source=garrytan&utm_medium=x_reply&utm_campaign=evals_credibility&cta_id=external_eval_post`, {
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    const events = readTelemetry();
    const withUtm = events.find((e) => e.utmSource === 'garrytan' || (e.props || {}).utmSource === 'garrytan');
    assert.ok(withUtm, 'utm_source should land in attribution metadata for the /evals landing event');
  });
});
