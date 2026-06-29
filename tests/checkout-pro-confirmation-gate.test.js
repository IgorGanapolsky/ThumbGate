'use strict';

/**
 * Test: GET /checkout/pro with a real-browser User-Agent and no confirm=1
 * must NOT create a live Stripe session — it must render the price-labeled
 * interstitial first. This closes the observed 0/50 completion rate where
 * buyers were 302'd cold to checkout.stripe.com with no context and bailed.
 *
 * Confirmed checkout (?confirm=1 OR POST) still 302s straight to Stripe so
 * the "user has already seen the offer" path remains friction-free.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'checkout-confirm-gate-'));
const savedEnv = {};
const ENV = {
  _TEST_API_KEYS_PATH: path.join(tmpRoot, 'api-keys.json'),
  _TEST_FUNNEL_LEDGER_PATH: path.join(tmpRoot, 'funnel-events.jsonl'),
  _TEST_REVENUE_LEDGER_PATH: path.join(tmpRoot, 'revenue-events.jsonl'),
  _TEST_LOCAL_CHECKOUT_SESSIONS_PATH: path.join(tmpRoot, 'local-checkout-sessions.json'),
  THUMBGATE_FEEDBACK_DIR: path.join(tmpRoot, 'feedback'),
  THUMBGATE_API_KEY: 'test-api-key-for-confirm-gate',
  THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL: 'https://buy.stripe.com/test-diagnostic',
  THUMBGATE_WORKFLOW_SPRINT_CHECKOUT_URL: 'https://buy.stripe.com/test-sprint',
  STRIPE_SECRET_KEY: '',
  STRIPE_PRICE_ID: '',
};
for (const [k, v] of Object.entries(ENV)) {
  savedEnv[k] = process.env[k];
  process.env[k] = v;
}
fs.mkdirSync(ENV.THUMBGATE_FEEDBACK_DIR, { recursive: true });

const { startServer } = require('../src/api/server');

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const BROWSER_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

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

function clearTelemetry() {
  try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
}

describe('/checkout/pro confirmation gate (closes 0/50 conversion leak)', () => {
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

  it('real-browser GET without confirm → 200 interstitial, NO Stripe session created', async () => {
    clearTelemetry();
    const res = await fetch(`${origin}/checkout/pro`, {
      redirect: 'manual',
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    assert.equal(res.status, 200, 'real-browser bare GET must serve the interstitial, not 302 to Stripe');
    const body = await res.text();
    assert.match(body, /Start ThumbGate Pro/);
    assert.match(body, /Pay \$19\/mo with Stripe/);
    assert.match(body, /name="confirm" value="1"/, 'interstitial must include the confirm field as the primary CTA');
    assert.doesNotMatch(body, /name="customer_email"[^>]*required/, 'email must be optional before Stripe so the interstitial does not block checkout starts');
    assert.match(body, /Stripe can collect your email/);
    assert.match(body, /Not sure yet\? Send the workflow first/);
    assert.doesNotMatch(body, /Pay \$1 first rule/);
    assert.doesNotMatch(body, /Pay \$99 teardown/);
    assert.doesNotMatch(body, /Book \$499 diagnostic/);
    assert.doesNotMatch(body, /Start \$1500 sprint/);
    assert.doesNotMatch(body, /https:\/\/buy\.stripe\.com\//, 'Pro interstitial must not expose unrelated Payment Links');
    assert.doesNotMatch(body, /checkout\.stripe\.com/, 'interstitial must not pre-leak a Stripe URL');

    const events = readTelemetry();
    assert.ok(
      events.some((e) => e.eventType === 'checkout_interstitial_view' && e.isBot === 'false'),
      'real-browser interstitial view should fire checkout_interstitial_view with isBot=false',
    );
    assert.equal(
      events.filter((e) => e.eventType === 'checkout_bootstrap').length,
      0,
      'bare GET must NOT create a Stripe session — that was the 0/50 conversion leak',
    );
  });

  it('real-browser GET WITH ?confirm=1 but no email → 302 toward checkout and defers email to Stripe', async () => {
    clearTelemetry();
    const res = await fetch(`${origin}/checkout/pro?confirm=1`, {
      redirect: 'manual',
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    assert.ok(res.status >= 300 && res.status < 400, `confirmed checkout without email must 302, got ${res.status}`);
    const location = res.headers.get('location') || '';
    assert.ok(/\/success\?/.test(location) || /checkout\.stripe\.com/.test(location), `confirmed checkout must redirect to Stripe or success, got ${location}`);

    const events = readTelemetry();
    assert.equal(
      events.filter((e) => e.eventType === 'checkout_interstitial_view' && e.reasonCode === 'missing_customer_email').length,
      0,
      'missing email must not bounce a confirmed human click back to the interstitial',
    );
    assert.ok(
      events.some((e) => e.eventType === 'checkout_bootstrap'),
      'confirm=1 without email should create a checkout session',
    );
  });

  it('real-browser GET WITH ?confirm=1 and email → 302 toward checkout', async () => {
    clearTelemetry();
    const res = await fetch(`${origin}/checkout/pro?confirm=1&customer_email=buyer%40example.com`, {
      redirect: 'manual',
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    assert.ok(res.status >= 300 && res.status < 400, `confirmed checkout with email must 302, got ${res.status}`);
    const location = res.headers.get('location') || '';
    assert.ok(/\/success\?/.test(location) || /checkout\.stripe\.com/.test(location), `confirmed checkout must redirect to Stripe or success, got ${location}`);

    const events = readTelemetry();
    assert.ok(
      events.some((e) => e.eventType === 'checkout_bootstrap'),
      'confirmed checkout with email should reach the bootstrap path',
    );
  });

  // NOTE: POST /checkout/pro is intentionally NOT tested here. The route is
  // GET-only — the server.js handler matches on `isGetLikeRequest &&
  // pathname === '/checkout/pro'`, so POST 404s. The `req.method === 'POST'`
  // branch inside `isConfirmedCheckout` is dead code and confirmation comes
  // exclusively via `?confirm=1` (covered by the previous test case).

  it('Googlebot still gets the interstitial (no regression on bot path)', async () => {
    const res = await fetch(`${origin}/checkout/pro`, {
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        accept: 'text/html,*/*',
      },
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Start ThumbGate Pro/);
  });
});
