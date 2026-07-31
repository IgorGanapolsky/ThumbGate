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
    assert.doesNotMatch(body, /buy\.stripe\.com\//);
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
    // The buyer submits a required-email form back to ThumbGate; no Stripe
    // destination is discoverable from the crawler-visible HTML.
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

  it('requires an email-backed POST before the diagnostic Payment Link', async () => {
    const diagnosticCheckoutUrl = process.env.THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL;
    delete process.env.THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL;
    try {
      const landing = await fetch(`${origin}/go/diagnostic?utm_source=aiventyx`, {
        redirect: 'manual',
      });
      assert.equal(landing.status, 302);
      assert.equal(new URL(landing.headers.get('location')).pathname, '/diagnostic');

      const getPay = await fetch(`${origin}/go/diagnostic-pay`, { redirect: 'manual' });
      assert.equal(getPay.status, 405);

      const res = await fetch(`${origin}/go/diagnostic-pay`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          customer_email: 'buyer@example.com',
          utm_source: 'direct',
        }),
      });
      assert.equal(res.status, 303);
      const destination = new URL(res.headers.get('location'));
      assert.equal(destination.origin + destination.pathname, 'https://buy.stripe.com/9B69ATbmI4r4aK5eOD3sI3k');
      assert.equal(destination.searchParams.get('utm_source'), 'direct');
      assert.equal(destination.searchParams.get('prefilled_email'), 'buyer@example.com');
      const reference = destination.searchParams.get('client_reference_id');
      assert.match(reference, /^tg2/);
      assert.equal(require('../scripts/checkout-attribution-reference').parseCheckoutReference(reference).source, 'direct');
    } finally {
      process.env.THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL = diagnosticCheckoutUrl;
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

  it('interstitial keeps Stripe URLs out of crawler-visible form actions', async () => {
    const res = await fetch(`${origin}/checkout/pro`, {
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        accept: 'text/html,*/*',
      },
    });
    const body = await res.text();
    assert.match(body, /<form action="\/checkout\/pro" method="POST"/);
    assert.match(body, /name="confirm" value="1"/);
    assert.match(body, /name="customer_email"[^>]*required/);
    assert.doesNotMatch(body, /<form action="https:\/\/buy\.stripe\.com\//);
    assert.match(body, /attributable buyer intent/);
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

  it('keeps email-backed direct-to-Stripe bypass for unsampled human traffic when bypass is enabled', async () => {
    const previousBypass = process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS;
    const previousSampleRate = process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE;
    const previousProStripeUrl = process.env.THUMBGATE_CHECKOUT_PRO_STRIPE_URL;
    process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS = '1';
    process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE = '0';
    process.env.THUMBGATE_CHECKOUT_PRO_STRIPE_URL = 'https://buy.stripe.com/test-pro';

    try {
      try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
      const res = await fetch(`${origin}/checkout/pro?visitor_id=visitor_unsampled&customer_email=buyer%40example.com`, {
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

  it('does not let the legacy bypass mint an anonymous checkout session', async () => {
    const previousBypass = process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS;
    const previousSampleRate = process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE;
    process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS = '1';
    process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE = '0';

    try {
      try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
      const res = await fetch(`${origin}/checkout/pro?visitor_id=visitor_anonymous_bypass`, {
        redirect: 'manual',
        headers: {
          'user-agent': BROWSER_UA,
          accept: BROWSER_ACCEPT,
        },
      });
      assert.equal(res.status, 200);
      assert.match(await res.text(), /name="customer_email"[^>]*required/);
      assert.equal(
        readFunnelEvents().filter((entry) => entry.eventType === 'checkout_interstitial_bypass_redirect').length,
        0,
      );
    } finally {
      if (previousBypass === undefined) delete process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS;
      else process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS = previousBypass;
      if (previousSampleRate === undefined) delete process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE;
      else process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE = previousSampleRate;
    }
  });

  it('samples human bypass traffic into the checkout feedback interstitial', async () => {
    const previousBypass = process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS;
    const previousSampleRate = process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE;
    process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_BYPASS = '1';
    process.env.THUMBGATE_CHECKOUT_INTERSTITIAL_SAMPLE_RATE = '1';

    try {
      try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
      const res = await fetch(`${origin}/checkout/pro?visitor_id=visitor_sampled&customer_email=buyer%40example.com`, {
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
      const res = await fetch(`${origin}/checkout/pro?visitor_id=visitor_percent_sampled&customer_email=buyer%40example.com`, {
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
      const res = await fetch(`${origin}/checkout/pro?visitor_id=visitor_invalid_sample_rate&customer_email=buyer%40example.com`, {
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

  it('keeps real browsers on the intent form when bypass is not explicitly enabled', async () => {
    try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
    const res = await fetch(`${origin}/checkout/pro`, {
      redirect: 'manual',
      headers: {
        'user-agent': BROWSER_UA,
        accept: BROWSER_ACCEPT,
      },
    });
    assert.equal(res.status, 200, `expected intent form, got ${res.status}`);
    const body = await res.text();
    assert.match(body, /name="customer_email"[^>]*required/);
  });

  it('does not let confirm=1 without email create a checkout session', async () => {
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
    assert.match(body, /name="customer_email"[^>]*required/);

    const events = readFunnelEvents();
    assert.ok(
      events.some((e) => e.eventType === 'checkout_interstitial_view' && e.reasonCode === 'missing_customer_email'),
      'missing email should remain on the intent form',
    );
    assert.equal(events.filter((e) => e.eventType === 'checkout_bootstrap').length, 0);
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

  it('deflects bot-classified traffic even when it supplies an email', async () => {
    try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
    const res = await fetch(`${origin}/checkout/pro?confirm=1&customer_email=buyer@example.com`, {
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
        accept: 'text/html,*/*',
      },
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Start ThumbGate Pro/);
    const events = readFunnelEvents();
    assert.equal(events.filter((e) => e.eventType === 'checkout_bootstrap').length, 0);
    assert.ok(events.some((e) => e.eventType === 'checkout_bot_deflected'));
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

  it('bot deflects /go/pro-direct to /checkout/pro without Stripe URL', async () => {
    try { fs.unlinkSync(path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl')); } catch {}
    const res = await fetch(`${origin}/go/pro-direct`, {
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        accept: 'text/html,*/*',
      },
    });
    assert.equal(res.status, 302);
    const loc = res.headers.get('location') || '';
    assert.match(loc, /\/checkout\/pro/);
    assert.doesNotMatch(loc, /buy\.stripe\.com/);
    const events = readFunnelEvents();
    assert.ok(
      events.some((e) => e.eventType === 'checkout_bot_deflected'),
      'bot pro-direct should log checkout_bot_deflected',
    );
  });

  it('human /go/pro-direct redirects to live Stripe Payment Link', async () => {
    const res = await fetch(`${origin}/go/pro-direct?utm_content=skip_form`, {
      redirect: 'manual',
      headers: {
        'user-agent': BROWSER_UA,
        accept: BROWSER_ACCEPT,
      },
    });
    assert.equal(res.status, 302);
    const loc = res.headers.get('location') || '';
    assert.match(loc, /buy\.stripe\.com\//);
  });
});
