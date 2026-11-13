'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const billing = require('../scripts/billing');
const {
  classifyRequester,
  isHumanCheckoutNavigation,
  checkoutRequesterKey,
} = require('../scripts/bot-detection');
const { detectEconomicAction } = require('../scripts/financial-control-plane');
const { appendTelemetryEvent, getTelemetryAnalytics } = require('../scripts/telemetry-analytics');

test('probe and audit requests are recognised as automated', () => {
  assert.equal(billing.isAutomatedCheckoutRequest({ source: 'internal_audit' }), true);
  assert.equal(billing.isAutomatedCheckoutRequest({ installId: 'consent_probe' }), true);
  assert.equal(billing.isAutomatedCheckoutRequest({ installId: 'probe_2026' }), true);
  assert.equal(billing.isAutomatedCheckoutRequest({ source: 'health_check' }), true);
});

test('visitor checkouts are not treated as automated', () => {
  assert.equal(billing.isAutomatedCheckoutRequest({ installId: 'unknown', utmMedium: 'cta_button' }), false);
  assert.equal(billing.isAutomatedCheckoutRequest({ installId: 'inst_8f2a' }), false);
  assert.equal(billing.isAutomatedCheckoutRequest({}), false);
});

// Production runs on a restricted key (rk_live_); an sk_live_-only check let a probe through on 2026-11-11.
for (const prefix of ['sk_live_', 'rk_live_']) test(`a probe never reaches Stripe with a ${prefix} key`, async () => {
  const savedKey = billing.CONFIG.STRIPE_SECRET_KEY;
  billing.CONFIG.STRIPE_SECRET_KEY = `${prefix}placeholder_not_a_real_key`;
  try {
    await assert.rejects(
      billing.createCheckoutSession({
        successUrl: 'https://thumbgate.ai/success',
        cancelUrl: 'https://thumbgate.ai/cancel',
        customerEmail: 'probe@example.com',
        installId: 'consent_probe',
        metadata: { source: 'internal_audit', planId: 'pro', billingCycle: 'monthly' },
      }),
      /Refusing to open a live Stripe Checkout session/,
    );
  } finally {
    billing.CONFIG.STRIPE_SECRET_KEY = savedKey;
  }
});

test('financial control plane blocks live ThumbGate /go/* session-minting routes unless ?probe=1 is passed', () => {
  assert.equal(
    detectEconomicAction('Bash', { command: 'curl -sI https://thumbgate.ai/go/pro-direct' }),
    true,
  );
  assert.equal(
    detectEconomicAction('Bash', { command: 'curl -sI https://thumbgate.ai/go/pro-annual' }),
    true,
  );
  assert.equal(
    detectEconomicAction('browser_navigate', { url: 'https://thumbgate.app/go/founding-100' }),
    true,
  );
  assert.equal(
    detectEconomicAction('Bash', {
      command: 'curl -sI https://thumbgate-production.up.railway.app/go/diagnostic-pay',
    }),
    true,
  );
  assert.equal(
    detectEconomicAction('Bash', {
      command: 'curl -sI https://thumbgate.ai/go/operator-diagnostic',
    }),
    true,
  );

  assert.equal(
    detectEconomicAction('Bash', { command: 'curl -sI "https://thumbgate.ai/go/pro-direct?probe=1"' }),
    false,
  );
  assert.equal(
    detectEconomicAction('Bash', {
      command: 'curl -sI "https://thumbgate.ai/go/pro-annual?utm_source=audit&probe=true"',
    }),
    false,
  );
  assert.equal(
    detectEconomicAction('Bash', { command: 'curl -sI https://thumbgate.ai/go/diagnostic-499' }),
    false,
  );
  assert.equal(
    detectEconomicAction('Bash', { command: 'curl -sI http://127.0.0.1:3000/go/pro-direct' }),
    false,
  );
});

test('bot detection deflects headless programmatic navigation, self-referring /go/* scrapers, and audit UAs', () => {
  assert.equal(
    classifyRequester({
      'user-agent': 'MONEY-v6-Audit/1.0',
      accept: 'text/html',
    }).isBot,
    true,
  );
  assert.equal(
    classifyRequester({
      'user-agent': 'Fuzz Faster U Fool v2.1.0-dev',
      accept: 'text/html',
    }).isBot,
    true,
  );
  assert.equal(classifyRequester({}).isBot, true);

  const chromiumUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const safariUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
  const iosCriOsUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1';

  assert.equal(
    isHumanCheckoutNavigation({
      'user-agent': chromiumUa,
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
      'sec-fetch-site': 'none',
    }, 'https://thumbgate.ai'),
    false,
  );
  assert.equal(
    isHumanCheckoutNavigation({
      'user-agent': chromiumUa,
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
      'sec-fetch-site': 'cross-site',
    }, 'https://thumbgate.ai'),
    false,
  );
  assert.equal(
    isHumanCheckoutNavigation({
      'user-agent': safariUa,
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
      'sec-fetch-site': 'cross-site',
    }, 'https://thumbgate.ai'),
    true,
  );
  assert.equal(
    isHumanCheckoutNavigation({
      'user-agent': iosCriOsUa,
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
      'sec-fetch-site': 'none',
    }, 'https://thumbgate.ai'),
    true,
  );
  assert.equal(
    isHumanCheckoutNavigation({
      'user-agent': chromiumUa,
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
      'sec-fetch-site': 'same-origin',
      referer: 'https://thumbgate.ai/go/pro-direct',
    }, 'https://thumbgate.ai'),
    false,
  );
  assert.equal(
    isHumanCheckoutNavigation({
      'user-agent': chromiumUa,
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-user': '?1',
      referer: 'https://external-blog.example/go/article',
    }, 'https://thumbgate.ai'),
    true,
  );
  assert.equal(
    isHumanCheckoutNavigation({
      referer: ':::malformed-url:::',
    }, 'https://thumbgate.ai'),
    false,
  );

  assert.equal(
    isHumanCheckoutNavigation({
      'user-agent': chromiumUa,
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
      'sec-fetch-site': 'same-origin',
    }, 'https://thumbgate.ai'),
    true,
  );
  assert.equal(
    isHumanCheckoutNavigation({
      'user-agent': chromiumUa,
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-user': '?1',
    }, 'https://thumbgate.ai'),
    true,
  );
  assert.equal(
    checkoutRequesterKey({
      'cf-connecting-ip': '203.0.113.10',
      'user-agent': 'Mozilla/5.0',
    }),
    '203.0.113.10|Mozilla/5.0',
  );
  assert.equal(checkoutRequesterKey({}), null);
});

test('billing blocks synthetic/probe/owner checkout emails on live Stripe keys and excludes agent sweeps from funnel analytics', async () => {
  const savedOwnerEmails = process.env.THUMBGATE_OWNER_EMAILS;
  const savedKey = billing.CONFIG.STRIPE_SECRET_KEY;
  process.env.THUMBGATE_OWNER_EMAILS = 'founder@company.test';
  billing.CONFIG.STRIPE_SECRET_KEY = `${'rk_live_'}placeholder_not_a_real_key`;

  try {
    assert.equal(billing.isAutomatedCheckoutRequest({}, 'probe@example.com'), true);
    assert.equal(billing.isAutomatedCheckoutRequest({}, 'buyer@acme.com'), true);
    assert.equal(billing.isAutomatedCheckoutRequest({}, 'buyer@acme.io'), true);
    assert.equal(billing.isAutomatedCheckoutRequest({}, 'dev@acme.io'), true);
    assert.equal(billing.isAutomatedCheckoutRequest({}, 'buyer+tag@acme.com'), true);
    assert.equal(billing.isAutomatedCheckoutRequest({}, 'founder+tag@agent-startup.io'), true);
    assert.equal(billing.isAutomatedCheckoutRequest({}, 'mkjkjuwj@formtests.info'), true);
    assert.equal(billing.isAutomatedCheckoutRequest({}, 'e2e-probe@custom-domain.io'), true);
    assert.equal(billing.isAutomatedCheckoutRequest({}, 'founder@company.test'), true);
    assert.equal(billing.isAutomatedCheckoutRequest({}, 'founder+probe@company.test'), true);
    assert.equal(billing.isAutomatedCheckoutRequest({}, 'stranger+founder@company.test'), false);
    assert.equal(billing.isAutomatedCheckoutRequest({ utmCampaign: 'codex_verification_run' }), true);
    assert.equal(billing.isAutomatedCheckoutRequest({ probe: true }), true);
    assert.equal(billing.isAutomatedCheckoutRequest({}, null), false);
    assert.equal(billing.isAutomatedCheckoutRequest(undefined, ''), false);
    assert.equal(billing.isAutomatedCheckoutRequest({ installId: 'inst_real' }, 'cto@customer-corp.io'), false);

    await assert.rejects(
      billing.createCheckoutSession({
        successUrl: 'https://thumbgate.ai/success',
        cancelUrl: 'https://thumbgate.ai/cancel',
        customerEmail: 'e2e-probe@custom-domain.io',
        installId: 'inst_unknown',
        metadata: { planId: 'pro', billingCycle: 'monthly' },
      }),
      (err) => err.code === 'AUTOMATED_CHECKOUT_BLOCKED'
        && err.statusCode === 403
        && /Refusing to open a live Stripe Checkout session/.test(err.message),
    );
    await assert.rejects(
      billing.createCheckoutSession({
        successUrl: 'https://thumbgate.ai/success',
        cancelUrl: 'https://thumbgate.ai/cancel',
        customerEmail: 'mkjkjuwj@formtests.info',
        installId: 'inst_unknown',
        metadata: { planId: 'pro', billingCycle: 'monthly', source: 'website', ctaId: 'pricing_pro' },
      }),
      (err) => err.code === 'AUTOMATED_CHECKOUT_BLOCKED' && err.statusCode === 403,
    );
    await assert.rejects(
      billing.createCheckoutSession({
        successUrl: 'https://thumbgate.ai/success',
        cancelUrl: 'https://thumbgate.ai/cancel',
        customerEmail: 'buyer+tag@acme.com',
        installId: 'inst_unknown',
        metadata: { planId: 'pro', billingCycle: 'monthly', source: 'website', ctaId: 'pricing_pro' },
      }),
      (err) => err.code === 'AUTOMATED_CHECKOUT_BLOCKED' && err.statusCode === 403,
    );
    await assert.rejects(
      billing.createCheckoutSession({
        successUrl: 'https://thumbgate.ai/success',
        cancelUrl: 'https://thumbgate.ai/cancel',
        customerEmail: 'dev@acme.io',
        installId: 'inst_unknown',
        metadata: { planId: 'pro', billingCycle: 'monthly', source: 'website', ctaId: 'pricing_pro' },
      }),
      (err) => err.code === 'AUTOMATED_CHECKOUT_BLOCKED' && err.statusCode === 403,
    );
  } finally {
    billing.CONFIG.STRIPE_SECRET_KEY = savedKey;
    if (savedOwnerEmails === undefined) delete process.env.THUMBGATE_OWNER_EMAILS;
    else process.env.THUMBGATE_OWNER_EMAILS = savedOwnerEmails;
  }

  assert.deepEqual(billing._filterQualifiedCheckoutFunnelEvents([]), {
    events: [],
    excludedSyntheticCheckoutSessions: 0,
  });
  assert.deepEqual(billing._filterQualifiedCheckoutFunnelEvents(null), {
    events: [],
    excludedSyntheticCheckoutSessions: 0,
  });

  const filtered = billing._filterQualifiedCheckoutFunnelEvents([
    null,
    {
      timestamp: 'invalid-date',
      stage: 'acquisition',
      event: 'checkout_session_created',
      visitorId: 'vis_malformed_ts',
      metadata: { planId: 'pro' },
    },
    {
      timestamp: '2026-11-12T12:00:02.000Z',
      stage: 'acquisition',
      event: 'checkout_session_created',
      visitorId: 'vis_real_buyer',
      sessionId: 'sess_real_buyer',
      installId: 'inst_real_buyer',
      metadata: { planId: 'pro', billingCycle: 'monthly', ctaId: 'pricing_pro' },
    },
    {
      timestamp: '2026-11-12T11:00:00.000Z',
      stage: 'acquisition',
      event: 'checkout_session_created',
      installId: 'unknown',
      metadata: { source: 'internal_audit', planId: 'pro' },
    },
    {
      timestamp: '2026-11-12T12:00:01.000Z',
      stage: 'acquisition',
      event: 'checkout_session_created',
      visitorId: 'visitor_ephemeral_1',
      metadata: { planId: 'pro', billingCycle: 'monthly', ctaId: 'hero_pro' },
    },
    {
      timestamp: '2026-11-12T12:00:05.000Z',
      stage: 'acquisition',
      event: 'checkout_session_created',
      visitorId: 'visitor_ephemeral_2',
      metadata: { planId: 'pro', billingCycle: 'annual', ctaId: 'pricing_annual' },
    },
    {
      timestamp: '2026-11-12T12:00:09.000Z',
      stage: 'acquisition',
      event: 'checkout_session_created',
      visitorId: 'visitor_ephemeral_3',
      metadata: { packId: 'sprint_diagnostic', ctaId: 'diagnostic_499' },
    },
    {
      timestamp: '2026-11-12T12:00:03.000Z',
      stage: 'acquisition',
      event: 'checkout_session_created',
      visitorId: 'visitor_email_buyer',
      customerEmail: 'realbuyer@customer-corp.io',
      metadata: { planId: 'pro', billingCycle: 'monthly', ctaId: 'checkout_pro' },
    },
    {
      timestamp: '2026-11-12T11:59:30.000Z',
      stage: 'activation',
      event: 'first_api_usage',
      visitorId: 'vis_real_buyer',
      metadata: {},
    },
  ]);

  assert.equal(filtered.excludedSyntheticCheckoutSessions, 4);
  assert.ok(filtered.events.some((entry) => entry && entry.visitorId === 'vis_real_buyer'));
  assert.ok(filtered.events.some((entry) => entry && entry.visitorId === 'visitor_email_buyer'));
});

test('telemetry qualifiedCheckoutStarts preserves concurrent human buyers while excluding bots, probes, and sweeps', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-checkout-telemetry-'));
  const savedOwners = process.env.THUMBGATE_OWNER_EMAILS;
  process.env.THUMBGATE_OWNER_EMAILS = 'igor@gmail.com';
  try {
    appendTelemetryEvent(tmpDir, {
      eventType: 'landing_page_view',
      clientType: 'web',
      visitorId: 'vis_human_1',
      sessionId: 'sess_human_1',
      source: 'google',
      page: '/',
    }, { 'user-agent': 'Mozilla/5.0' });

    appendTelemetryEvent(tmpDir, {
      eventType: 'checkout_start',
      clientType: 'web',
      visitorId: 'vis_human_1',
      sessionId: 'sess_human_1',
      customerEmail: 'rodrigor@gmail.com',
      audienceReasons: ['injected_fake_reason'],
      source: 'google',
      page: '/',
      ctaId: 'hero_pro_direct_19',
    }, { 'user-agent': 'Mozilla/5.0' });

    appendTelemetryEvent(tmpDir, {
      eventType: 'checkout_start',
      clientType: 'web',
      visitorId: 'vis_owner_plus',
      customerEmail: 'igor+audit@gmail.com',
      source: 'direct',
      page: '/pricing',
      ctaId: 'pricing_pro',
    }, { 'user-agent': 'Mozilla/5.0' });

    for (const [idx, ctaId] of ['cta_a', 'cta_b', 'cta_c'].entries()) {
      appendTelemetryEvent(tmpDir, {
        eventType: 'checkout_start',
        clientType: 'web',
        visitorId: `visitor_uuid_${idx}`,
        source: 'direct',
        page: '/',
        ctaId,
      }, { 'user-agent': 'Mozilla/5.0' });
    }

    const analytics = getTelemetryAnalytics(tmpDir, { window: '30d' });
    assert.equal(analytics.ctas.checkoutStarts, 5);
    assert.equal(analytics.ctas.qualifiedCheckoutStarts, 1);
    assert.equal(analytics.trafficQuality.byExclusionReason.injected_fake_reason, undefined);
  } finally {
    if (savedOwners === undefined) delete process.env.THUMBGATE_OWNER_EMAILS;
    else process.env.THUMBGATE_OWNER_EMAILS = savedOwners;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('/go/pro-direct deflects ?probe=1 and blocked synthetic emails to /checkout/pro instead of live Payment Links', async () => {
  const http = require('node:http');
  const { startServer } = require('../src/api/server');
  const tmpFeedback = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-probe-deflect-'));
  const savedFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const savedApiKey = process.env.THUMBGATE_API_KEY;
  const savedStripeKey = billing.CONFIG.STRIPE_SECRET_KEY;
  const savedStripePrice = billing.CONFIG.STRIPE_PRICE_ID;
  const savedEnvKey = process.env.STRIPE_SECRET_KEY;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedback;
  process.env.THUMBGATE_API_KEY = 'test-probe-deflect-api-key';
  billing.CONFIG.STRIPE_SECRET_KEY = `${'rk_live_'}placeholder_not_a_real_key`;
  billing.CONFIG.STRIPE_PRICE_ID = 'price_placeholder_pro';
  process.env.STRIPE_SECRET_KEY = billing.CONFIG.STRIPE_SECRET_KEY;
  const handle = await startServer({ port: 0, host: '127.0.0.1' });
  const getRedirect = (urlPath) => new Promise((resolve, reject) => {
    http.get({
      host: '127.0.0.1',
      port: handle.port,
      path: urlPath,
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
        accept: 'text/html,application/xhtml+xml',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
      },
    }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, location: res.headers.location || '' });
    }).on('error', reject);
  });
  try {
    const probeRes = await getRedirect('/go/pro-direct?probe=1');
    assert.equal(probeRes.status, 302);
    assert.match(probeRes.location, /\/checkout\/pro\b/);
    assert.doesNotMatch(probeRes.location, /stripe\.com/i);

    const blockedRes = await getRedirect('/go/pro-direct?customer_email=e2e-probe%40example.com');
    assert.equal(blockedRes.status, 302);
    assert.match(blockedRes.location, /\/checkout\/pro\b/);
    assert.doesNotMatch(blockedRes.location, /stripe\.com/i);

    const postRes = await fetch(`http://127.0.0.1:${handle.port}/v1/billing/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerEmail: 'e2e-probe@example.com',
        planId: 'pro',
        billingCycle: 'monthly',
      }),
    });
    assert.equal(postRes.status, 403);

    const confirmRes = await fetch(`http://127.0.0.1:${handle.port}/checkout/pro?confirm=1&customer_email=mkjkjuwj%40formtests.info&plan_id=pro&billing_cycle=monthly`, {
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
        accept: 'text/html,application/xhtml+xml',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
      },
    });
    assert.equal(confirmRes.status, 403);
    assert.equal(confirmRes.headers.get('location'), null);
    const plusConfirm = await fetch(`http://127.0.0.1:${handle.port}/checkout/pro?confirm=1&customer_email=buyer%2Btag%40acme.com&plan_id=pro&billing_cycle=monthly`, {
      redirect: 'manual',
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
        accept: 'text/html,application/xhtml+xml',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
      },
    });
    assert.equal(plusConfirm.status, 403);
    assert.equal(plusConfirm.headers.get('location'), null);

    const bundleRes = await getRedirect('/go/bundle-49?customer_email=dev%40acme.io');
    assert.equal(bundleRes.status, 302);
    assert.match(bundleRes.location, /\/checkout\/pro\b/);
    assert.doesNotMatch(bundleRes.location, /stripe\.com/i);
    assert.doesNotMatch(bundleRes.location, /prefilled_email/i);

    const playbookRes = await getRedirect('/go/playbook-999?prefilled_email=founder%2Btag%40agent-startup.io');
    assert.equal(playbookRes.status, 302);
    assert.match(playbookRes.location, /\/checkout\/pro\b/);
    assert.doesNotMatch(playbookRes.location, /stripe\.com/i);

    const humanBundle = await getRedirect('/go/bundle-49?customer_email=cto%40customer-corp.io');
    assert.equal(humanBundle.status, 302);
    assert.match(humanBundle.location, /^https:\/\/buy\.stripe\.com\//);
    assert.match(humanBundle.location, /prefilled_email=cto%40customer-corp\.io/i);

    const liveDiagnosticRes = await fetch(`http://127.0.0.1:${handle.port}/go/diagnostic-pay`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
        accept: 'text/html,application/xhtml+xml',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
      },
      body: new URLSearchParams({ customer_email: 'mkjkjuwj@formtests.info' }),
    });
    assert.equal(liveDiagnosticRes.status, 302);
    assert.match(liveDiagnosticRes.headers.get('location') || '', /\/checkout\/pro\b/);
    assert.doesNotMatch(liveDiagnosticRes.headers.get('location') || '', /stripe\.com/i);

    billing.CONFIG.STRIPE_SECRET_KEY = `${'sk_test_'}placeholder_not_a_real_key`;
    process.env.STRIPE_SECRET_KEY = billing.CONFIG.STRIPE_SECRET_KEY;
    const testModeDiagnosticRes = await fetch(`http://127.0.0.1:${handle.port}/go/diagnostic-pay`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
        accept: 'text/html,application/xhtml+xml',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
      },
      body: new URLSearchParams({ customer_email: 'buyer@example.com' }),
    });
    assert.equal(testModeDiagnosticRes.status, 303);
    assert.match(testModeDiagnosticRes.headers.get('location') || '', /^https:\/\/buy\.stripe\.com\//);
    assert.match(testModeDiagnosticRes.headers.get('location') || '', /prefilled_email=buyer%40example\.com/i);
  } finally {
    await new Promise((resolve) => handle.server.close(resolve));
    billing.CONFIG.STRIPE_SECRET_KEY = savedStripeKey;
    billing.CONFIG.STRIPE_PRICE_ID = savedStripePrice;
    if (savedEnvKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedEnvKey;
    if (savedApiKey === undefined) delete process.env.THUMBGATE_API_KEY;
    else process.env.THUMBGATE_API_KEY = savedApiKey;
    if (savedFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = savedFeedbackDir;
    fs.rmSync(tmpFeedback, { recursive: true, force: true });
  }
});
