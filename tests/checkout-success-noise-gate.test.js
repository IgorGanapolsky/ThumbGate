'use strict';

/**
 * Regression test for the /success telemetry noise gate.
 *
 * 2026-05-19 audit showed 6 successViews / 0 paid confirmations over 30
 * days. Root cause: /success was emitting `checkout_success_page_view`
 * on every GET — direct nav, bot crawls, monitoring probes, copy-pasted
 * shared links. Audit aggregates that event into the conversion metric,
 * masking signal.
 *
 * Fix: only emit the canonical `checkout_success_page_view` event when
 *   (a) ?session_id starts with `cs_` (the prefix Stripe uses on its
 *       post-payment redirect)
 *   AND
 *   (b) the requester is NOT classified as a bot.
 *
 * Unverified hits still emit telemetry under
 * `checkout_success_page_view_unverified` so we keep observability for
 * raw traffic — they just don't inflate the conversion metric.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'checkout-success-noise-gate-'));
const savedEnv = {};
const ENV = {
  _TEST_API_KEYS_PATH: path.join(tmpRoot, 'api-keys.json'),
  _TEST_FUNNEL_LEDGER_PATH: path.join(tmpRoot, 'funnel-events.jsonl'),
  _TEST_REVENUE_LEDGER_PATH: path.join(tmpRoot, 'revenue-events.jsonl'),
  _TEST_LOCAL_CHECKOUT_SESSIONS_PATH: path.join(tmpRoot, 'local-checkout-sessions.json'),
  THUMBGATE_FEEDBACK_DIR: path.join(tmpRoot, 'feedback'),
  THUMBGATE_API_KEY: 'test-api-key-for-success-gate',
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
const GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

let handle;
let origin = '';

function readSuccessEvents() {
  const p = path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl');
  try {
    return fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((e) => (e.eventType || '').startsWith('checkout_success_page_view'));
  } catch {
    return [];
  }
}

function clearTelemetry() {
  try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
}

describe('/success telemetry noise gate', () => {
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

  it('does NOT emit checkout_success_page_view when session_id is absent', async () => {
    clearTelemetry();
    const res = await fetch(`${origin}/success`, {
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    assert.equal(res.status, 200);
    const events = readSuccessEvents();
    assert.equal(events.filter((e) => e.eventType === 'checkout_success_page_view').length, 0, 'should NOT inflate the conversion metric');
    assert.ok(events.some((e) => e.eventType === 'checkout_success_page_view_unverified'), 'should still emit observability event under unverified eventType');
  });

  it('does NOT emit canonical event when session_id has a non-Stripe prefix', async () => {
    clearTelemetry();
    const res = await fetch(`${origin}/success?session_id=not_a_stripe_session`, {
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    assert.equal(res.status, 200);
    const events = readSuccessEvents();
    assert.equal(events.filter((e) => e.eventType === 'checkout_success_page_view').length, 0);
    assert.ok(events.some((e) => e.eventType === 'checkout_success_page_view_unverified'));
  });

  it('does NOT emit canonical event for a bot UA even with a real-shaped session_id', async () => {
    clearTelemetry();
    const res = await fetch(`${origin}/success?session_id=cs_live_test_abc123`, {
      headers: { 'user-agent': GOOGLEBOT_UA, accept: 'text/html,*/*' },
    });
    assert.equal(res.status, 200);
    const events = readSuccessEvents();
    assert.equal(events.filter((e) => e.eventType === 'checkout_success_page_view').length, 0, 'bot UA should not count as a conversion');
    assert.ok(events.some((e) => e.eventType === 'checkout_success_page_view_unverified'));
  });

  it('DOES emit canonical checkout_success_page_view for human UA + cs_-prefixed session_id', async () => {
    clearTelemetry();
    const res = await fetch(`${origin}/success?session_id=cs_live_test_abc123`, {
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    assert.equal(res.status, 200);
    const events = readSuccessEvents();
    assert.equal(events.filter((e) => e.eventType === 'checkout_success_page_view').length, 1, 'real Stripe post-payment redirect should count');
    assert.equal(events.filter((e) => e.eventType === 'checkout_success_page_view_unverified').length, 0);
  });

  it('accepts cs_test_ session_id prefix (Stripe test mode) the same as cs_live_', async () => {
    clearTelemetry();
    const res = await fetch(`${origin}/success?session_id=cs_test_abc123`, {
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT },
    });
    assert.equal(res.status, 200);
    const events = readSuccessEvents();
    assert.equal(events.filter((e) => e.eventType === 'checkout_success_page_view').length, 1, 'test-mode session_id should also count');
  });
});
