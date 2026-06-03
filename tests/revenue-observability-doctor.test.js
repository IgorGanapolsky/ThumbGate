'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hasAllEnv,
  envPresence,
  extractPlausibleDataDomains,
  probePublicFunnel,
  buildRevenueObservabilityDoctor,
  formatDoctorReport,
} = require('../scripts/revenue-observability-doctor');

function response(body, { status = 200, url = 'https://thumbgate.test/', location = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'location' ? location : null;
      },
    },
    async text() {
      return body;
    },
  };
}

test('hasAllEnv and envPresence treat blank strings as missing', () => {
  const env = {
    STRIPE_SECRET_KEY: 'sk_live_x',
    PLAUSIBLE_API_KEY: ' ',
  };

  assert.equal(hasAllEnv(env, ['STRIPE_SECRET_KEY']), true);
  assert.equal(hasAllEnv(env, ['STRIPE_SECRET_KEY', 'PLAUSIBLE_API_KEY']), false);
  assert.deepEqual(envPresence(env, ['STRIPE_SECRET_KEY', 'PLAUSIBLE_API_KEY']), {
    STRIPE_SECRET_KEY: true,
    PLAUSIBLE_API_KEY: false,
  });
});

test('probePublicFunnel passes when Pro checkout is focused; confirm-path probe disabled 2026-05-19 to stop zombie Stripe sessions', async () => {
  const calls = [];
  const result = await probePublicFunnel({
    appOrigin: 'https://thumbgate.test',
    async fetchImpl(url) {
      calls.push(String(url));
      const pathname = new URL(String(url)).pathname;
      const search = new URL(String(url)).search;
      // 2026-05-19: doctor no longer GETs /checkout/pro?confirm=1 because
      // it was creating one Stripe session per healthcheck tick. If a
      // test ever sees a fetch with confirm=1 from the doctor again, this
      // assertion catches the regression.
      if (search.includes('confirm=1')) {
        throw new Error('regression: doctor must not fetch confirm=1 (creates zombie Stripe sessions)');
      }
      if (pathname === '/') {
        return response('<script defer data-domain="thumbgate.ai" src="https://plausible.io/js/script.js"></script><script>fetch("/v1/telemetry/ping")</script>');
      }
      return response('Start ThumbGate Pro <a>Pay $19/mo with Stripe</a><a>Not sure yet? Send the workflow first</a>');
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.checkout.focusedProCta, true);
  assert.equal(result.checkout.workflowFallback, true);
  assert.equal(result.checkout.leaksServiceLinks, false);
  assert.equal(result.confirm.probeDisabled, true);
  assert.equal(result.confirm.redirects, null);
  // Exactly 2 fetches (root + /checkout/pro). Was 3 before — the third was
  // the confirm=1 GET that's now disabled.
  assert.equal(calls.length, 2);
});

test('probePublicFunnel fails when service links leak into Pro checkout interstitial', async () => {
  const result = await probePublicFunnel({
    appOrigin: 'https://thumbgate.test',
    async fetchImpl(url) {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/' || parsed.search.includes('confirm=1')) {
        return response('', { status: parsed.search.includes('confirm=1') ? 302 : 200 });
      }
      return response('Pay $19/mo with Stripe Book $499 diagnostic https://buy.stripe.com/test');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.checkout.leaksServiceLinks, true);
});

test('extractPlausibleDataDomains reads every emitted Plausible data-domain', () => {
  assert.deepEqual(extractPlausibleDataDomains(`
    <script data-domain="thumbgate.ai"></script>
    <script data-domain='thumbgate-production.up.railway.app'></script>
    <script data-domain="thumbgate.ai"></script>
  `), ['thumbgate.ai', 'thumbgate-production.up.railway.app']);
});

test('doctor blocks revenue claims when Stripe and hosted auth are missing', async () => {
  const report = await buildRevenueObservabilityDoctor({
    env: {},
    appOrigin: 'https://thumbgate.test',
    async fetchImpl(url) {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/' || parsed.search.includes('confirm=1')) {
        return response('', { status: parsed.search.includes('confirm=1') ? 302 : 200 });
      }
      return response('Start ThumbGate Pro Pay $19/mo with Stripe Not sure yet? Send the workflow first');
    },
  });

  assert.equal(report.verdict, 'blocked');
  assert.equal(report.canProveRevenue, false);
  assert.equal(report.canProveVisitorBehavior, false);
  assert.ok(report.nextActions.some((line) => /Stripe secret key/.test(line)));
  assert.ok(formatDoctorReport(report).includes('Revenue Observability Doctor: BLOCKED'));
});

test('doctor blocks when live markup emits thumbgate.ai but Plausible registration only covers Railway', async () => {
  const report = await buildRevenueObservabilityDoctor({
    env: {
      THUMBGATE_OPERATOR_KEY: 'operator',
      STRIPE_SECRET_KEY: 'sk_live_x',
      PLAUSIBLE_API_KEY: 'plausible',
      PLAUSIBLE_SITE_ID: 'thumbgate-production.up.railway.app',
      POSTHOG_PERSONAL_API_KEY: 'phx',
      POSTHOG_PROJECT_ID: '123',
    },
    appOrigin: 'https://thumbgate.ai',
    async fetchImpl(url) {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/') {
        return response('<script defer data-domain="thumbgate.ai" src="https://plausible.io/js/script.js"></script><script>fetch("/v1/telemetry/ping")</script>');
      }
      return response('Start ThumbGate Pro Pay $19/mo with Stripe Not sure yet? Send the workflow first');
    },
  });

  const coverage = report.checks.find((check) => check.id === 'plausible_primary_domain_registered');
  assert.equal(report.verdict, 'blocked');
  assert.equal(coverage.ok, false);
  assert.equal(coverage.evidence.primaryRegistered, false);
  assert.deepEqual(coverage.evidence.missingEmittedDomains, ['thumbgate.ai']);
  assert.ok(report.nextActions.some((line) => /Register thumbgate\.ai in Plausible/.test(line)));
});

test('doctor is ready when proof access and focused public funnel are present', async () => {
  const report = await buildRevenueObservabilityDoctor({
    env: {
      THUMBGATE_OPERATOR_KEY: 'operator',
      STRIPE_SECRET_KEY: 'sk_live_x',
      PLAUSIBLE_API_KEY: 'plausible',
      PLAUSIBLE_SITE_ID: 'thumbgate.ai',
      POSTHOG_PERSONAL_API_KEY: 'phx',
      POSTHOG_PROJECT_ID: '123',
    },
    appOrigin: 'https://thumbgate.test',
    async fetchImpl(url) {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/' || parsed.search.includes('confirm=1')) {
        return response('', { status: parsed.search.includes('confirm=1') ? 302 : 200 });
      }
      return response('Start ThumbGate Pro Pay $19/mo with Stripe Not sure yet? Send the workflow first');
    },
  });

  assert.equal(report.verdict, 'ready');
  assert.equal(report.canProveRevenue, true);
  assert.equal(report.canProveVisitorBehavior, true);
  assert.ok(report.checks.some((check) => check.id === 'first_party_journey_export' && check.ok));
});
