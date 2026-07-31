'use strict';

/**
 * Test: GET /checkout/pro with a real-browser User-Agent and no confirm=1
 * must NOT create a live Stripe session — it must render the price-labeled
 * interstitial first. This closes the observed 0/50 completion rate where
 * buyers were 302'd cold to checkout.stripe.com with no context and bailed.
 *
 * Confirmed checkout requires ?confirm=1 plus a valid buyer email before it
 * can create a session. The single field keeps the path short and makes the
 * resulting session attributable and recoverable.
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

  it('real-browser GET without confirm renders the email-backed intent form', async () => {
    clearTelemetry();
    const res = await fetch(`${origin}/checkout/pro`, {
      redirect: 'manual',
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    assert.equal(res.status, 200, 'real-browser bare GET should render the intent form');
    const body = await res.text();
    assert.match(body, /action="\/checkout\/pro" method="POST"/);
    assert.match(body, /name="confirm" value="1"/);
    assert.match(body, /name="customer_email"[^>]*required/);
    assert.match(body, /pro_checkout_direct_stripe/);
    assert.match(body, /\/go\/pro-direct/);
    assert.doesNotMatch(body, /buy\.stripe\.com\//);
    assert.match(body, /hosted team sync and a hosted org dashboard are not generally available/i);
    assert.doesNotMatch(body, /Shared hosted lessons and org dashboards are Enterprise/i);
    assert.doesNotMatch(body, /<form action="https:\/\/buy\.stripe\.com\//);
  });

  it('real-browser GET WITH ?confirm=1 but no email stays on the intent form', async () => {
    clearTelemetry();
    const res = await fetch(`${origin}/checkout/pro?confirm=1`, {
      redirect: 'manual',
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /name="customer_email"[^>]*required/);

    const events = readTelemetry();
    assert.ok(
      events.some((e) => e.eventType === 'checkout_interstitial_view' && e.reasonCode === 'missing_customer_email'),
      'missing email should remain on the attributable intent form',
    );
    assert.equal(events.filter((e) => e.eventType === 'checkout_bootstrap').length, 0);
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

  it('real-browser form POST with email creates an attributable checkout', async () => {
    clearTelemetry();
    const res = await fetch(`${origin}/checkout/pro`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'user-agent': BROWSER_UA,
        accept: BROWSER_ACCEPT,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        confirm: '1',
        customer_email: 'buyer@example.com',
        utm_source: 'intent_form',
        cta_id: 'pro_checkout_confirmed',
      }),
    });
    assert.ok(res.status >= 300 && res.status < 400, `confirmed form must redirect, got ${res.status}`);
    const events = readTelemetry();
    const bootstrap = events.find((e) => e.eventType === 'checkout_bootstrap');
    assert.ok(bootstrap, 'form POST should reach checkout bootstrap');
    assert.equal(bootstrap.utmSource, 'intent_form');
    assert.equal(bootstrap.ctaId, 'pro_checkout_confirmed');
  });

  it('rejects non-form POST bodies before checkout evaluation', async () => {
    const res = await fetch(`${origin}/checkout/pro`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'user-agent': BROWSER_UA,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ confirm: '1', customer_email: 'buyer@example.com' }),
    });
    assert.equal(res.status, 415);
  });

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

  it('Googlebot confirm=1 without email records missing email and stays on interstitial', async () => {
    clearTelemetry();
    const res = await fetch(`${origin}/checkout/pro?confirm=1`, {
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        accept: 'text/html,*/*',
      },
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Start ThumbGate Pro/);

    const events = readTelemetry();
    const interstitial = events.find((e) => e.eventType === 'checkout_bot_deflected');
    assert.ok(interstitial, 'bot confirm=1 without email must emit a deflection event');
    assert.equal(interstitial.reasonCode, 'missing_customer_email');
    assert.equal(interstitial.isBot, 'true');
  });

  it('Googlebot confirm=1 with invalid email records invalid email and stays on interstitial', async () => {
    clearTelemetry();
    const res = await fetch(`${origin}/checkout/pro?confirm=1&customer_email=not-an-email`, {
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        accept: 'text/html,*/*',
      },
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Start ThumbGate Pro/);

    const events = readTelemetry();
    const interstitial = events.find((e) => e.eventType === 'checkout_bot_deflected');
    assert.ok(interstitial, 'bot confirm=1 with invalid email must emit a deflection event');
    assert.equal(interstitial.reasonCode, 'invalid_customer_email');
    assert.equal(interstitial.isBot, 'true');
  });
});
