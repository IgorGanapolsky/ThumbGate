'use strict';

/**
 * Integration tests: GET /checkout/pro must not create Stripe sessions for
 * bots or raw GETs. All non-confirmed visitors get a focused HTML
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
    assert.match(body, /Start ThumbGate Pro/);
    assert.match(body, /Not sure yet\? Send the workflow first/);
    assert.match(body, /href="\/#workflow-sprint-intake"/);
    assert.match(body, /checkout_interstitial_cta_clicked/);
    assert.match(body, /aria-label="Checkout feedback"/);
    assert.match(body, /data-reason="price_unclear"/);
    assert.match(body, /data-reason="need_more_proof"/);
    assert.match(body, /data-reason="need_team_plan"/);
    assert.match(body, /reason_not_buying/);
    assert.match(body, /checkout_interstitial_abandoned/);
    assert.match(body, /name="confirm" value="1"/);
    assert.doesNotMatch(body, /Pay \$1 first rule/);
    assert.doesNotMatch(body, /Pay \$19 quick read/);
    assert.doesNotMatch(body, /Pay \$99 teardown/);
    assert.doesNotMatch(body, /Book \$499 diagnostic/);
    assert.doesNotMatch(body, /Start \$1500 sprint/);
    assert.doesNotMatch(body, /checkout_interstitial_first_failure_rule_checkout/);
    assert.doesNotMatch(body, /checkout_interstitial_quick_read_checkout/);
    assert.doesNotMatch(body, /checkout_interstitial_workflow_teardown_checkout/);
    assert.doesNotMatch(body, /checkout_interstitial_sprint_diagnostic_checkout/);
    assert.doesNotMatch(body, /checkout_interstitial_workflow_sprint_checkout/);
    assert.doesNotMatch(body, /https:\/\/buy\.stripe\.com\//);
    assert.doesNotMatch(body, /checkout\.stripe\.com/);
  });

  it('keeps attribution out of bot-safe checkout HTML while logging it first-party', async () => {
    const res = await fetch(`${origin}/checkout/pro?utm_source=reddit&utm_campaign=first_dollar&cta_id=pricing_pro&billing_cycle=annual&landing_path=%2Fpricing`, {
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        accept: 'text/html,*/*',
      },
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.doesNotMatch(body, /name="utm_source" value="reddit"/);
    assert.doesNotMatch(body, /name="utm_campaign" value="first_dollar"/);
    assert.doesNotMatch(body, /name="cta_id" value="pricing_pro"/);
    assert.doesNotMatch(body, /name="billing_cycle" value="annual"/);
    assert.doesNotMatch(body, /name="landing_path" value="\/pricing"/);
    assert.match(body, /href="\/#workflow-sprint-intake"/);
    assert.doesNotMatch(body, /checkout_interstitial_first_failure_rule_checkout/);
    assert.doesNotMatch(body, /checkout_interstitial_quick_read_checkout/);
    assert.doesNotMatch(body, /checkout_interstitial_workflow_teardown_checkout/);
    assert.doesNotMatch(body, /checkout_interstitial_sprint_diagnostic_checkout/);
    assert.doesNotMatch(body, /checkout_interstitial_workflow_sprint_checkout/);

    const telemetryEvents = readFunnelEvents();
    const event = telemetryEvents.find((entry) =>
      entry.eventType === 'checkout_bot_deflected' &&
      entry.utmSource === 'reddit' &&
      entry.utmCampaign === 'first_dollar' &&
      entry.ctaId === 'pricing_pro' &&
      entry.landingPath === '/pricing'
    );
    assert.ok(event, 'expected first-party telemetry to preserve attribution');
  });

  it('keeps service payment links off the Pro interstitial when paid path env vars are missing', async () => {
    const diagnosticCheckoutUrl = process.env.THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL;
    const workflowSprintCheckoutUrl = process.env.THUMBGATE_WORKFLOW_SPRINT_CHECKOUT_URL;
    delete process.env.THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL;
    delete process.env.THUMBGATE_WORKFLOW_SPRINT_CHECKOUT_URL;

    try {
      const res = await fetch(`${origin}/checkout/pro`, {
        redirect: 'manual',
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          accept: 'text/html,*/*',
        },
      });
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.match(body, /Pay \$19\/mo with Stripe/);
      assert.match(body, /Not sure yet\? Send the workflow first/);
      assert.doesNotMatch(body, /https:\/\/buy\.stripe\.com\/28E00j3Uge1E2dzgWL3sI2J/);
      assert.doesNotMatch(body, /https:\/\/buy\.stripe\.com\/6oU00j8aw2iWdWh9uj3sI2K/);
      assert.doesNotMatch(body, /href=""/);
    } finally {
      process.env.THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL = diagnosticCheckoutUrl;
      process.env.THUMBGATE_WORKFLOW_SPRINT_CHECKOUT_URL = workflowSprintCheckoutUrl;
    }
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
    assert.match(body, /Start ThumbGate Pro/);
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
      assert.match(body, /Start ThumbGate Pro/);
    }
  });

  it('deflects bots that follow the confirm=1 link inside the interstitial HTML', async () => {
    // 2026-05-19 audit: 2,210 of 2,251 Stripe sessions ever created were
    // zombies (expired with no email). Cause: the interstitial HTML renders
    // a `/checkout/pro?confirm=1` link; bot crawlers discovered it and
    // followed it, bypassing the bot deflection and creating cs_live_*
    // sessions per crawl. Belt + suspenders: rel="nofollow" on the link
    // plus a server-side check that bot+confirm still gets the interstitial.
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'curl/8.4.0',
    ]) {
      try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
      const res = await fetch(`${origin}/checkout/pro?confirm=1`, {
        redirect: 'manual',
        headers: { 'user-agent': ua, accept: 'text/html,*/*' },
      });
      assert.equal(res.status, 200, `bot+confirm should still see interstitial for ${ua}, got ${res.status}`);
      const body = await res.text();
      assert.match(body, /Start ThumbGate Pro/);
      const events = readFunnelEvents();
      assert.equal(
        events.filter((e) => e.eventType === 'checkout_bootstrap').length,
        0,
        `bot+confirm must NOT create a Stripe session (${ua})`,
      );
      assert.ok(
        events.some((e) => e.eventType === 'checkout_bot_deflected'),
        `bot+confirm should still emit checkout_bot_deflected (${ua})`,
      );
    }
  });

  it('interstitial checkout links directly to Stripe so crawlers see the form but cannot create sessions', async () => {
    const res = await fetch(`${origin}/checkout/pro`, {
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        accept: 'text/html,*/*',
      },
    });
    const body = await res.text();
    // Form now links directly to Stripe Payment Link (fix: 99 visitors, 0 paid)
    assert.match(body, /<form action="https:\/\/buy\.stripe\.com\//);
    assert.match(body, /name="prefilled_email"/);
    assert.doesNotMatch(body, /name="prefilled_email"[^>]*required/);
    assert.match(body, /Stripe can collect your email on the secure checkout page/);
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
      assert.match(body, /Start ThumbGate Pro/);
    }
  });

  it('keeps direct-to-Stripe bypass for unsampled human traffic when bypass is enabled', async () => {
    const previousBypass = process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS;
    const previousSampleRate = process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE;
    const previousProStripeUrl = process.env.THUMBGATE_CHECKOUT_PRO_STRIPE_URL;
    process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS = '1';
    process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE = '0';
    process.env.THUMBGATE_CHECKOUT_PRO_STRIPE_URL = 'https://buy.stripe.com/test-pro';

    try {
      try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
      const res = await fetch(`${origin}/checkout/pro?visitor_id=visitor_unsampled`, {
        redirect: 'manual',
        headers: {
          'user-agent': BROWSER_UA,
          accept: BROWSER_ACCEPT,
        },
      });
      assert.equal(res.status, 302);
      assert.match(res.headers.get('location') || '', /^https:\/\/buy\.stripe\.com\/test-pro/);

      const events = readFunnelEvents();
      const event = events.find((entry) =>
        entry.eventType === 'checkout_interstitial_bypass_redirect' &&
        entry.visitorId === 'visitor_unsampled'
      );
      assert.ok(event, 'expected bypass redirect telemetry for unsampled human traffic');
      assert.equal(event.interstitialSampleRate, 0);
    } finally {
      if (previousBypass === undefined) delete process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS;
      else process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS = previousBypass;
      if (previousSampleRate === undefined) delete process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE;
      else process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE = previousSampleRate;
      if (previousProStripeUrl === undefined) delete process.env.THUMBGATE_CHECKOUT_PRO_STRIPE_URL;
      else process.env.THUMBGATE_CHECKOUT_PRO_STRIPE_URL = previousProStripeUrl;
    }
  });

  it('samples human bypass traffic into the checkout feedback interstitial', async () => {
    const previousBypass = process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS;
    const previousSampleRate = process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE;
    process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS = '1';
    process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE = '1';

    try {
      try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
      const res = await fetch(`${origin}/checkout/pro?visitor_id=visitor_sampled`, {
        redirect: 'manual',
        headers: {
          'user-agent': BROWSER_UA,
          accept: BROWSER_ACCEPT,
        },
      });
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.match(body, /aria-label="Checkout feedback"/);
      assert.match(body, /data-reason="price_unclear"/);
      assert.match(body, /reason_not_buying/);

      const events = readFunnelEvents();
      const event = events.find((entry) =>
        entry.eventType === 'checkout_interstitial_view' &&
        entry.visitorId === 'visitor_sampled'
      );
      assert.ok(event, 'expected interstitial telemetry for sampled human traffic');
      assert.equal(event.interstitialSampled, 'true');
      assert.equal(event.interstitialSampleRate, 1);
    } finally {
      if (previousBypass === undefined) delete process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS;
      else process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS = previousBypass;
      if (previousSampleRate === undefined) delete process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE;
      else process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE = previousSampleRate;
    }
  });

  it('accepts percentage syntax for checkout interstitial sampling', async () => {
    const previousBypass = process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS;
    const previousSampleRate = process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE;
    process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS = '1';
    process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE = '100';

    try {
      try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
      const res = await fetch(`${origin}/checkout/pro?visitor_id=visitor_percent_sampled`, {
        redirect: 'manual',
        headers: {
          'user-agent': BROWSER_UA,
          accept: BROWSER_ACCEPT,
        },
      });
      assert.equal(res.status, 200);

      const events = readFunnelEvents();
      const event = events.find((entry) =>
        entry.eventType === 'checkout_interstitial_view' &&
        entry.visitorId === 'visitor_percent_sampled'
      );
      assert.ok(event, 'expected interstitial telemetry for percent sampling');
      assert.equal(event.interstitialSampled, 'true');
      assert.equal(event.interstitialSampleRate, 1);
    } finally {
      if (previousBypass === undefined) delete process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS;
      else process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS = previousBypass;
      if (previousSampleRate === undefined) delete process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE;
      else process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE = previousSampleRate;
    }
  });

  it('treats invalid checkout interstitial sample rates as zero', async () => {
    const previousBypass = process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS;
    const previousSampleRate = process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE;
    const previousProStripeUrl = process.env.THUMBGATE_CHECKOUT_PRO_STRIPE_URL;
    process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS = '1';
    process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE = 'not-a-rate';
    process.env.THUMBGATE_CHECKOUT_PRO_STRIPE_URL = 'https://buy.stripe.com/test-pro';

    try {
      try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
      const res = await fetch(`${origin}/checkout/pro?visitor_id=visitor_invalid_sample_rate`, {
        redirect: 'manual',
        headers: {
          'user-agent': BROWSER_UA,
          accept: BROWSER_ACCEPT,
        },
      });
      assert.equal(res.status, 302);
      assert.match(res.headers.get('location') || '', /^https:\/\/buy\.stripe\.com\/test-pro/);

      const events = readFunnelEvents();
      const event = events.find((entry) =>
        entry.eventType === 'checkout_interstitial_bypass_redirect' &&
        entry.visitorId === 'visitor_invalid_sample_rate'
      );
      assert.ok(event, 'expected bypass telemetry for invalid sampling');
      assert.equal(event.interstitialSampleRate, 0);
    } finally {
      if (previousBypass === undefined) delete process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS;
      else process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS = previousBypass;
      if (previousSampleRate === undefined) delete process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE;
      else process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE = previousSampleRate;
      if (previousProStripeUrl === undefined) delete process.env.THUMBGATE_CHECKOUT_PRO_STRIPE_URL;
      else process.env.THUMBGATE_CHECKOUT_PRO_STRIPE_URL = previousProStripeUrl;
    }
  });

  it('shows real browsers the intent interstitial before checkout session creation', async () => {
    try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
    const res = await fetch(`${origin}/checkout/pro`, {
      redirect: 'manual',
      headers: {
        'user-agent': BROWSER_UA,
        accept: BROWSER_ACCEPT,
      },
    });
    assert.equal(res.status, 200, `expected checkout interstitial, got ${res.status}`);
    const body = await res.text();
    assert.match(body, /Start ThumbGate Pro/);
    assert.match(body, /name="confirm" value="1"/);

    const events = readFunnelEvents();
    assert.equal(
      events.filter((e) => e.eventType === 'checkout_interstitial_view').length,
      1,
      'real browsers should see the intent interstitial before Stripe',
    );
    assert.equal(
      events.filter((e) => e.eventType === 'checkout_bootstrap').length,
      0,
      'unconfirmed real browsers must not create checkout sessions',
    );
  });

  it('lets confirmed real browsers reach checkout and defer email capture to Stripe', async () => {
    try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
    const res = await fetch(`${origin}/checkout/pro?confirm=1`, {
      redirect: 'manual',
      headers: {
        'user-agent': BROWSER_UA,
        accept: BROWSER_ACCEPT,
      },
    });
    assert.ok(res.status >= 300 && res.status < 400, `expected checkout redirect, got ${res.status}`);
    const location = res.headers.get('location') || '';
    assert.ok(/\/success\?/.test(location) || /checkout\.stripe\.com/.test(location), `expected Stripe or success redirect, got ${location}`);

    const events = readFunnelEvents();
    assert.equal(
      events.filter((e) => e.eventType === 'checkout_interstitial_view' && e.reasonCode === 'missing_customer_email').length,
      0,
      'confirmed browsers without email must not be bounced back to the interstitial',
    );
    assert.ok(
      events.some((e) => e.eventType === 'checkout_email_deferred_to_stripe'),
      'missing email should be tracked as deferred to Stripe',
    );
    assert.ok(
      events.some((e) => e.eventType === 'checkout_bootstrap'),
      'confirmed browsers without email should create a checkout session',
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
