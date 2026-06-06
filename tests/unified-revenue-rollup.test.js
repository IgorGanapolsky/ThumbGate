'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  REVENUE_SURFACES,
  parseArgs,
  joinSurfaceTraffic,
  diagnoseFunnel,
  renderMarkdown,
  buildSnapshot,
  gatherPlausible,
  gatherStripe,
  gatherSearchConsoleAiVisibility,
} = require('../scripts/unified-revenue-rollup');

test('REVENUE_SURFACES includes every public surface shipped through 2026-05-15', () => {
  for (const surface of ['/', '/pricing', '/case-studies', '/compare/heidi', '/learn/spec-driven-development', '/pro', '/go/teams']) {
    assert.ok(REVENUE_SURFACES.includes(surface), `missing surface: ${surface}`);
  }
});

test('parseArgs reads flags and defaults to 1d / reports/revenue', () => {
  const args = parseArgs(['--json', '--period=7d', '--output-dir=/tmp/x']);
  assert.equal(args.json, true);
  assert.equal(args.dryRun, false);
  assert.equal(args.period, '7d');
  assert.equal(args.outputDir, '/tmp/x');

  const defaults = parseArgs([]);
  assert.equal(defaults.json, false);
  assert.equal(defaults.dryRun, false);
  assert.equal(defaults.period, '1d');
  assert.equal(defaults.outputDir, 'reports/revenue');
});

test('joinSurfaceTraffic maps Plausible page breakdowns onto the revenue surface list, zero-filling absent surfaces', () => {
  const plausible = {
    configured: true,
    pages: [
      { page: '/', visitors: 100, pageviews: 250 },
      { page: '/pricing', visitors: 12, pageviews: 18 },
      { page: '/some-other-page', visitors: 5, pageviews: 5 },
    ],
  };
  const joined = joinSurfaceTraffic(plausible);
  assert.equal(joined.length, REVENUE_SURFACES.length);
  const home = joined.find((r) => r.surface === '/');
  const pricing = joined.find((r) => r.surface === '/pricing');
  const caseStudies = joined.find((r) => r.surface === '/case-studies');
  assert.deepEqual({ v: home.visitors, p: home.pageviews, live: home.live }, { v: 100, p: 250, live: true });
  assert.deepEqual({ v: pricing.visitors, p: pricing.pageviews, live: pricing.live }, { v: 12, p: 18, live: true });
  assert.deepEqual({ v: caseStudies.visitors, p: caseStudies.pageviews, live: caseStudies.live }, { v: 0, p: 0, live: false });
});

test('joinSurfaceTraffic returns [] when Plausible is unconfigured', () => {
  assert.deepEqual(joinSurfaceTraffic({ configured: false }), []);
  assert.deepEqual(joinSurfaceTraffic(null), []);
});

test('diagnoseFunnel emits "cash_available" win when Stripe shows positive dollar balance', () => {
  // stripe-live-status.getLiveStatus returns dollar-denominated values,
  // not cents. The rollup must trust those numbers as-is.
  const stripe = { configured: true, balance: { available: 149, pending: 0 }, checkout: { completed: 1 } };
  const surfaces = [{ surface: '/pricing', visitors: 5 }];
  const diagnostics = diagnoseFunnel(stripe, surfaces);
  const cashSignal = diagnostics.find((d) => d.signal === 'cash_available');
  assert.ok(cashSignal);
  assert.equal(cashSignal.severity, 'win');
  assert.match(cashSignal.message, /\$149\.00/);
});

test('diagnoseFunnel emits funnel-leak signals when traffic is present but cash and checkouts are not', () => {
  const stripe = { configured: true, balance: { available: 0, pending: 0 }, checkout: { completed: 0 } };
  const surfaces = [
    { surface: '/pricing', visitors: 8 },
    { surface: '/case-studies', visitors: 3 },
  ];
  const diagnostics = diagnoseFunnel(stripe, surfaces);
  const pricingSignal = diagnostics.find((d) => d.signal === 'pricing_traffic_no_cash');
  const caseSignal = diagnostics.find((d) => d.signal === 'case_study_traffic_no_checkout');
  assert.ok(pricingSignal, 'pricing leak signal must fire when /pricing has traffic but balance is $0');
  assert.ok(caseSignal, 'case-study leak signal must fire when /case-studies has traffic but 0 checkouts');
});

test('diagnoseFunnel warns when Search Console AI visibility readback is missing', () => {
  const stripe = { configured: true, balance: { available: 0, pending: 0 }, checkout: { completed: 0 } };
  const diagnostics = diagnoseFunnel(stripe, [], {
    configured: false,
    gap: 'GOOGLE_SEARCH_CONSOLE_SITE_URL is not set',
  });
  const signal = diagnostics.find((d) => d.signal === 'search_console_ai_visibility_unconfigured');
  assert.ok(signal);
  assert.equal(signal.severity, 'warning');
  assert.match(signal.message, /AI Overviews/);
});

test('diagnoseFunnel surfaces Stripe-unconfigured as a warning, not silently zero', () => {
  const stripe = { configured: false, gap: 'STRIPE_SECRET_KEY is not set' };
  const diagnostics = diagnoseFunnel(stripe, []);
  const warn = diagnostics.find((d) => d.signal === 'stripe_unconfigured');
  assert.ok(warn);
  assert.equal(warn.severity, 'warning');
  assert.match(warn.message, /STRIPE_SECRET_KEY/);
});

test('renderMarkdown produces a well-formed report that includes cash, surfaces, diagnostics, and honest limits', () => {
  const snapshot = {
    generatedAt: '2026-05-15T13:30:00Z',
    period: '1d',
    stripe: {
      // Dollar-denominated — stripe-live-status converts cents internally.
      configured: true,
      balance: { available: 49, pending: 0, currency: 'USD' },
      revenue: { today: 0, todayChargeCount: 0, netLifetime: 0 },
      subscriptions: { active: 0, mrr: 0 },
      checkout: { completed: 0, total: 0, conversionRate: '0%' },
    },
    plausible: {
      configured: true,
      aggregate: { visitors: { value: 42 }, pageviews: { value: 78 }, bounce_rate: { value: 51 }, visit_duration: { value: 38 } },
      sources: [{ source: 'reddit.com', visitors: 12 }, { source: 'Direct', visitors: 30 }],
    },
    searchConsoleAi: {
      configured: true,
      siteUrl: 'sc-domain:thumbgate.ai',
      credentialMode: 'service_account',
      report: {
        source: 'https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports',
        surfaces: ['AI Overviews', 'AI Mode'],
        metrics: ['impressions', 'pages'],
      },
    },
    surfaces: [
      { surface: '/', visitors: 30, pageviews: 60, live: true },
      { surface: '/pricing', visitors: 4, pageviews: 6, live: true },
    ],
    diagnostics: [
      { severity: 'info', signal: 'pricing_traffic_no_cash', message: '4 unique visitors on /pricing but $0 Stripe balance — funnel inbound but no buyer conversion yet.' },
    ],
  };
  const md = renderMarkdown(snapshot);
  assert.match(md, /# Unified Revenue Rollup/);
  assert.match(md, /Available: \$49\.00/);
  assert.match(md, /Visitors: 42/);
  assert.match(md, /\/pricing/);
  assert.match(md, /reddit\.com/);
  assert.match(md, /AI Search Visibility/);
  assert.match(md, /sc-domain:thumbgate\.ai/);
  assert.match(md, /pricing_traffic_no_cash/);
  assert.match(md, /## Honest Limits/);
});

test('renderMarkdown gracefully describes unconfigured Stripe and unconfigured Plausible', () => {
  const md = renderMarkdown({
    generatedAt: '2026-05-15T13:30:00Z',
    period: '1d',
    stripe: { configured: false, gap: 'STRIPE_SECRET_KEY is not set' },
    plausible: { configured: false, gap: 'PLAUSIBLE_API_KEY is not set' },
    searchConsoleAi: { configured: false, gap: 'GOOGLE_SEARCH_CONSOLE_SITE_URL is not set' },
    surfaces: [],
    diagnostics: [],
  });
  assert.match(md, /Stripe: NOT CONFIGURED.*STRIPE_SECRET_KEY/);
  assert.match(md, /Plausible: NOT CONFIGURED.*PLAUSIBLE_API_KEY/);
});

test('gatherSearchConsoleAiVisibility reports missing site property honestly', () => {
  const result = gatherSearchConsoleAiVisibility({ env: {} });
  assert.equal(result.configured, false);
  assert.equal(result.siteUrl, null);
  assert.match(result.gap, /GOOGLE_SEARCH_CONSOLE_SITE_URL/);
  assert.match(result.report.source, /gen-ai-performance-reports/);
});

test('gatherSearchConsoleAiVisibility is configured with site property and credentials', () => {
  const result = gatherSearchConsoleAiVisibility({
    env: {
      GOOGLE_SEARCH_CONSOLE_SITE_URL: 'sc-domain:thumbgate.ai',
      GOOGLE_APPLICATION_CREDENTIALS: '/tmp/gsc.json',
    },
  });
  assert.equal(result.configured, true);
  assert.equal(result.siteUrl, 'sc-domain:thumbgate.ai');
  assert.equal(result.credentialMode, 'service_account');
  assert.deepEqual(result.report.surfaces, ['AI Overviews', 'AI Mode', 'Discover generative AI features']);
});

test('gatherPlausible returns a gap object when PLAUSIBLE_API_KEY is missing', async () => {
  const result = await gatherPlausible({
    period: '1d',
    env: {},
    fetchImpl: () => {
      throw new Error('fetch must not be called when API key is missing');
    },
  });
  assert.equal(result.configured, false);
  assert.match(result.gap, /PLAUSIBLE_API_KEY/);
});

test('gatherPlausible joins aggregate + pages + sources from a fake Plausible API', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    let body;
    if (url.includes('/stats/aggregate')) {
      body = { results: { visitors: { value: 5 }, pageviews: { value: 9 }, bounce_rate: { value: 40 }, visit_duration: { value: 28 } } };
    } else if (url.includes('property=event%3Apage')) {
      body = { results: [{ page: '/pricing', visitors: 2, pageviews: 3 }] };
    } else if (url.includes('property=visit%3Asource')) {
      body = { results: [{ source: 'reddit.com', visitors: 4 }] };
    } else {
      throw new Error('unexpected url: ' + url);
    }
    return { ok: true, json: async () => body, text: async () => JSON.stringify(body) };
  };
  const result = await gatherPlausible({
    period: '1d',
    env: { PLAUSIBLE_API_KEY: 'tok', PLAUSIBLE_SITE_ID: 'example.com' },
    fetchImpl: fakeFetch,
  });
  assert.equal(result.configured, true);
  assert.equal(result.siteId, 'example.com');
  assert.equal(result.aggregate.visitors.value, 5);
  assert.equal(result.pages[0].page, '/pricing');
  assert.equal(result.sources[0].source, 'reddit.com');
  assert.equal(calls.length, 3);
});

test('gatherStripe returns a gap object when the stripe-live-status module is unavailable', async () => {
  const result = await gatherStripe({
    liveStatusModule: {
      getLiveStatus: async () => ({ configured: false, gaps: ['STRIPE_SECRET_KEY is not set'] }),
    },
  });
  assert.equal(result.configured, false);
});

test('gatherStripe surfaces a configured status with revenue + checkout data', async () => {
  const result = await gatherStripe({
    liveStatusModule: {
      getLiveStatus: async () => ({
        configured: true,
        balance: { available: 4900, pending: 0, currency: 'USD' },
        revenue: { today: 4900, todayChargeCount: 1, netLifetime: 4900, grossLifetime: 4900 },
        subscriptions: { active: 1, cancelled: 0, total: 1, mrr: 4900 },
        checkout: { completed: 1, total: 2, expired: 1, conversionRate: '50%' },
        products: [],
      }),
    },
  });
  assert.equal(result.configured, true);
  assert.equal(result.balance.available, 4900);
  assert.equal(result.checkout.completed, 1);
});

test('buildSnapshot wires gather + join + diagnose into one object', async () => {
  const snapshot = await buildSnapshot({
    argv: [],
    env: {},
    fetchImpl: () => {
      throw new Error('should not be reached when env is empty');
    },
    liveStatusModule: {
      getLiveStatus: async () => ({ configured: false, gaps: ['STRIPE_SECRET_KEY is not set'] }),
    },
    now: new Date('2026-05-15T13:30:00Z'),
  });
  assert.equal(snapshot.period, '1d');
  assert.equal(snapshot.stripe.configured, false);
  assert.equal(snapshot.plausible.configured, false);
  assert.equal(snapshot.searchConsoleAi.configured, false);
  assert.deepEqual(snapshot.surfaces, []);
  assert.ok(snapshot.diagnostics.find((d) => d.signal === 'stripe_unconfigured'));
  assert.ok(snapshot.diagnostics.find((d) => d.signal === 'search_console_ai_visibility_unconfigured'));
});
