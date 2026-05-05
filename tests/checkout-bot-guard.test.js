'use strict';

/**
 * Integration tests: GET /checkout/pro must not create Stripe sessions for
 * bots. Browsers hit the session-create path as before; bots get an HTML
 * interstitial that only creates the session on explicit confirm.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'checkout-bot-guard-'));
const savedEnv = {};
const ENV = {
  _TEST_API_KEYS_PATH: path.join(tmpRoot, 'api-keys.json'),
  _TEST_FUNNEL_LEDGER_PATH: path.join(tmpRoot, 'funnel-events.jsonl'),
  _TEST_REVENUE_LEDGER_PATH: path.join(tmpRoot, 'revenue-events.jsonl'),
  _TEST_LOCAL_CHECKOUT_SESSIONS_PATH: path.join(tmpRoot, 'local-checkout-sessions.json'),
  THUMBGATE_FEEDBACK_DIR: path.join(tmpRoot, 'feedback'),
  THUMBGATE_API_KEY: 'test-api-key-for-bot-guard',
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

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

let handle;
let origin = '';

function readFunnelEvents() {
  // Server telemetry goes through appendBestEffortTelemetry ->
  // appendTelemetryPing -> telemetry-pings.jsonl inside THUMBGATE_FEEDBACK_DIR.
  const p = path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl');
  try {
    return fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

describe('/checkout/pro bot guard', () => {
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

  it('returns HTML interstitial for Googlebot (no Stripe session)', async () => {
    const res = await fetch(`${origin}/checkout/pro`, {
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        accept: 'text/html,*/*',
      },
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Choose the right paid path/);
    assert.match(body, /Send workflow first/);
    assert.match(body, /checkout_interstitial_workflow_sprint_intake/);
    assert.match(body, /checkout_interstitial_cta_clicked/);
    assert.match(body, /\/checkout\/pro\?confirm=1/);
    assert.match(body, /Book \$499 diagnostic/);
    assert.match(body, /Start \$1500 sprint/);
    assert.match(body, /checkout_interstitial_sprint_diagnostic_checkout/);
    assert.match(body, /checkout_interstitial_workflow_sprint_checkout/);
    assert.match(body, /https:\/\/buy\.stripe\.com\/test-diagnostic/);
    assert.match(body, /https:\/\/buy\.stripe\.com\/test-sprint/);
    assert.doesNotMatch(body, /checkout\.stripe\.com/);
  });

  it('preserves attribution params through the bot-safe confirmation link', async () => {
    const res = await fetch(`${origin}/checkout/pro?utm_source=reddit&utm_campaign=first_dollar&cta_id=pricing_pro&billing_cycle=annual&landing_path=%2Fpricing`, {
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        accept: 'text/html,*/*',
      },
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /href="\/checkout\/pro\?confirm=1&amp;utm_source=reddit&amp;utm_campaign=first_dollar/);
    assert.match(body, /&amp;cta_id=pricing_pro/);
    assert.match(body, /&amp;billing_cycle=annual/);
    assert.match(body, /&amp;landing_path=%2Fpricing/);
    assert.match(body, /utm_medium=checkout_interstitial_recovery/);
    assert.match(body, /cta_id=checkout_interstitial_workflow_sprint_intake/);
    assert.match(body, /cta_id=checkout_interstitial_sprint_diagnostic_checkout/);
    assert.match(body, /cta_id=checkout_interstitial_workflow_sprint_checkout/);
  });

  it('returns HTML interstitial for curl (missing browser headers)', async () => {
    const res = await fetch(`${origin}/checkout/pro`, {
      redirect: 'manual',
      headers: {
        'user-agent': 'curl/8.4.0',
        accept: '*/*',
      },
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Choose the right paid path/);
  });

  it('returns HTML interstitial for LLM crawlers (ClaudeBot, GPTBot)', async () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
      'Mozilla/5.0 (compatible; PerplexityBot/1.0)',
    ]) {
      const res = await fetch(`${origin}/checkout/pro`, {
        redirect: 'manual',
        headers: { 'user-agent': ua, accept: 'text/html,*/*' },
      });
      assert.equal(res.status, 200, `expected 200 interstitial for ${ua}`);
      const body = await res.text();
      assert.match(body, /Choose the right paid path/);
    }
  });

  it('returns HTML interstitial for link-preview bots (Slackbot, LinkedInBot, Twitterbot)', async () => {
    for (const ua of [
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'LinkedInBot/1.0 (compatible; Mozilla/5.0)',
      'Twitterbot/1.0',
      'facebookexternalhit/1.1',
    ]) {
      const res = await fetch(`${origin}/checkout/pro`, {
        redirect: 'manual',
        headers: { 'user-agent': ua, accept: 'text/html,*/*' },
      });
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.match(body, /Choose the right paid path/);
    }
  });

  it('asks real browsers for email without the extra intent interstitial', async () => {
    try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
    const res = await fetch(`${origin}/checkout/pro`, {
      redirect: 'manual',
      headers: {
        'user-agent': BROWSER_UA,
        accept: BROWSER_ACCEPT,
      },
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Email for Stripe receipt/);
    assert.match(body, /name="?customer_email"?/);
    assert.match(body, /name="?confirm"? value="?1"?/);
    assert.doesNotMatch(body, /Choose the right paid path/);
    assert.doesNotMatch(body, /checkout\.stripe\.com/);

    const events = readFunnelEvents();
    assert.equal(
      events.filter((e) => e.eventType === 'checkout_interstitial_view').length,
      0,
      'real browsers should not be slowed by the intent interstitial',
    );
    assert.ok(
      events.some((e) => e.eventType === 'checkout_email_gate_shown'),
      'email gate should be tracked before checkout session creation',
    );
  });

  it('asks confirmed real browsers for an email before creating Stripe sessions', async () => {
    try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
    const res = await fetch(`${origin}/checkout/pro?confirm=1`, {
      redirect: 'manual',
      headers: {
        'user-agent': BROWSER_UA,
        accept: BROWSER_ACCEPT,
      },
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Email for Stripe receipt/);
    assert.match(body, /name="?customer_email"?/);
    assert.match(body, /name="?confirm"? value="?1"?/);

    const events = readFunnelEvents();
    assert.equal(
      events.filter((e) => e.eventType === 'checkout_bootstrap').length,
      0,
      'email gate should not create a checkout session',
    );
    assert.ok(
      events.some((e) => e.eventType === 'checkout_email_gate_shown'),
      'email gate should be tracked separately from checkout starts',
    );
  });

  it('proceeds with checkout flow for a real browser user-agent after confirmation and email capture', async () => {
    const res = await fetch(`${origin}/checkout/pro?confirm=1&customer_email=buyer@example.com`, {
      redirect: 'manual',
      headers: {
        'user-agent': BROWSER_UA,
        accept: BROWSER_ACCEPT,
      },
    });
    // Expect either 302 to a Stripe URL / local fallback OR 200 with stripe URL content.
    // With STRIPE_SECRET_KEY='' the local-mode fallback is used, which 302s to a /success URL.
    assert.ok(
      res.status === 302 || res.status === 200,
      `expected redirect or success page, got ${res.status}`,
    );
    if (res.status === 200) {
      const body = await res.text();
      assert.doesNotMatch(body, /Continue to secure checkout/,
        'browser should skip the interstitial');
    }
  });

  it('proceeds with checkout when ?confirm=1 and an email are passed even from a bot UA', async () => {
    const res = await fetch(`${origin}/checkout/pro?confirm=1&customer_email=buyer@example.com`, {
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
        accept: 'text/html,*/*',
      },
    });
    // Not a 200 interstitial — should be a redirect to Stripe or local fallback.
    assert.notEqual(res.status, 200);
    assert.ok(res.status >= 300 && res.status < 400);
  });

  it('logs checkout_bot_deflected telemetry events for bots (no checkout_bootstrap)', async () => {
    // Clear the telemetry ledger, then hit as a bot
    try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
    await fetch(`${origin}/checkout/pro`, {
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; bingbot/2.0)',
        accept: 'text/html,*/*',
      },
    });
    const events = readFunnelEvents();
    const deflected = events.filter((e) => e.eventType === 'checkout_bot_deflected');
    const bootstrapped = events.filter((e) => e.eventType === 'checkout_bootstrap');
    assert.ok(deflected.length >= 1, `expected at least 1 bot-deflected event, got ${deflected.length}`);
    assert.equal(bootstrapped.length, 0, 'bot should not reach checkout_bootstrap');
    assert.ok(
      deflected[0].reasonCode || deflected[0].reason,
      'deflection reason should be populated',
    );
  });
});
