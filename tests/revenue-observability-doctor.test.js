'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hasAllEnv,
  envPresence,
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

test('probePublicFunnel passes only when Pro checkout is focused and confirmed route redirects', async () => {
  const calls = [];
  const result = await probePublicFunnel({
    appOrigin: 'https://thumbgate.test',
    async fetchImpl(url) {
      calls.push(String(url));
      const pathname = new URL(String(url)).pathname;
      const search = new URL(String(url)).search;
      if (pathname === '/') {
        return response('<script defer data-domain="thumbgate.ai" src="https://plausible.io/js/script.js"></script><script>fetch("/v1/telemetry/ping")</script>');
      }
      if (pathname === '/checkout/pro' && search.includes('confirm=1')) {
        return response('', { status: 302, location: 'https://checkout.stripe.com/c/pay/test' });
      }
      return response('Start ThumbGate Pro <a>Pay $19/mo with Stripe</a><a>Not sure yet? Send the workflow first</a>');
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.checkout.focusedProCta, true);
  assert.equal(result.checkout.workflowFallback, true);
  assert.equal(result.checkout.leaksServiceLinks, false);
  assert.equal(result.confirm.redirects, true);
  assert.equal(calls.length, 3);
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
});
