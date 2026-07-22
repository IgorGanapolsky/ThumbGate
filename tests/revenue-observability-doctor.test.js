'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hasAllEnv,
  envPresence,
  assessPayPalPaymentProofReadiness,
  extractPlausibleDataDomains,
  probePublicFunnel,
  buildRevenueObservabilityDoctor,
  classifyDoctorVerdict,
  formatDoctorReport,
  doctorExitCode,
  probeHostedJson,
} = require('../scripts/revenue-observability-doctor');

function paypalProofEnv(overrides = {}) {
  return {
    THUMBGATE_MOR_PROVIDER: 'PayPal',
    THUMBGATE_PAYPAL_DIAGNOSTIC_CHECKOUT_URL: 'https://www.paypal.com/ncp/payment/DIAGNOSTIC',
    THUMBGATE_PAYPAL_CLIENT_ID: 'paypal-client',
    THUMBGATE_PAYPAL_CLIENT_SECRET: 'paypal-secret',
    THUMBGATE_PAYPAL_EVIDENCE_RULES_JSON: JSON.stringify({
      invoiceIdPrefixes: ['thumbgate-'],
      ownerIdentifiersReviewed: true,
      ownerAccountIds: [],
      ownerEmails: [],
      subscriptionsEnabled: false,
    }),
    THUMBGATE_PAYPAL_WEBHOOK_ID: 'WEBHOOK1',
    THUMBGATE_PAYPAL_WEBHOOK_URL: 'https://thumbgate.test/v1/billing/paypal-webhook',
    THUMBGATE_PAYPAL_WEBHOOK_LEDGER_PATH: '/data/feedback/paypal-webhook-deliveries.jsonl',
    NODE_ENV: 'test',
    ...overrides,
  };
}


function jsonResponse(body, { status = 200, url = 'https://thumbgate.test/' } = {}) {
  return response(JSON.stringify(body), { status, url });
}

function billingSummaryBody(overrides = {}) {
  return {
    coverage: { tracksBookedRevenue: true, tracksPaidOrders: true },
    trafficMetrics: { visitors: 10, pageViews: 12, checkoutStarts: 0 },
    revenue: { paidOrders: 0, bookedRevenueCents: 0 },
    funnel: { stageCounts: { acquisition: 2, activation: 1, paid: 0 } },
    ...overrides,
  };
}

function journeyExportBody() {
  return {
    generatedAt: new Date().toISOString(),
    telemetry: { rows: [], truncated: false, totalAfterSince: 0 },
    funnel: { rows: [{ stage: 'acquisition', event: 'page_view' }], truncated: false, totalAfterSince: 1 },
    journeySummary: { stageCounts: { acquisition: 1, activation: 0, paid: 0 }, dropoff: [] },
  };
}

function makeDoctorFetch({ rootHtml, checkoutHtml } = {}) {
  const root = rootHtml || '<script defer data-domain="thumbgate.ai" src="https://plausible.io/js/script.js"></script><script>fetch("/v1/telemetry/ping")</script>';
  const checkout = checkoutHtml || 'Start ThumbGate Pro <input name="customer_email" required> Pay $19/mo with Stripe Not sure yet? Send the workflow first';
  return async function fetchImpl(url) {
    const parsed = new URL(String(url));
    const pathname = parsed.pathname;
    if (pathname === '/v1/billing/summary') {
      return jsonResponse(billingSummaryBody());
    }
    if (pathname === '/v1/telemetry/export') {
      return jsonResponse(journeyExportBody());
    }
    if (pathname === '/') {
      return response(root);
    }
    if (pathname.startsWith('/checkout/pro')) {
      return response(checkout);
    }
    return response(checkout);
  };
}

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

test('CLI exit status fails closed in JSON and text modes whenever the report is blocked', () => {
  assert.equal(doctorExitCode({ verdict: 'blocked' }), 1);
  assert.equal(doctorExitCode({ verdict: 'degraded' }), 0);
  assert.equal(doctorExitCode({ verdict: 'ready' }), 0);
});

test('PayPal proof readiness follows the active buyer rail and never returns secrets', () => {
  const absent = assessPayPalPaymentProofReadiness({
    THUMBGATE_MOR_PROVIDER: 'PayPal',
    THUMBGATE_PAYPAL_DIAGNOSTIC_CHECKOUT_URL: 'https://www.paypal.com/ncp/payment/DIAGNOSTIC',
  });
  assert.equal(absent.required, true);
  assert.equal(absent.ready, false);
  assert.match(absent.gap, /client ID and secret/i);

  const ready = assessPayPalPaymentProofReadiness(paypalProofEnv());
  assert.equal(ready.required, true);
  assert.equal(ready.ready, true);
  assert.equal(ready.directAuditConfigured, true);
  assert.equal(ready.recentPaymentReconciliationConfigured, true);
  const serialized = JSON.stringify(ready);
  assert.equal(serialized.includes('paypal-secret'), false);
  assert.equal(serialized.includes('paypal-client'), false);
});

test('PayPal proof readiness fails closed on partial rules and unsafe webhook evidence paths', () => {
  const invalidRules = assessPayPalPaymentProofReadiness(paypalProofEnv({
    THUMBGATE_PAYPAL_EVIDENCE_RULES_JSON: JSON.stringify({
      invoiceIdPrefixes: [], ownerIdentifiersReviewed: true, subscriptionsEnabled: false,
    }),
  }));
  assert.equal(invalidRules.ready, false);
  assert.match(invalidRules.gap, /attribution matcher/i);

  const relativeLedger = assessPayPalPaymentProofReadiness(paypalProofEnv({
    THUMBGATE_PAYPAL_WEBHOOK_LEDGER_PATH: 'relative/deliveries.jsonl',
  }));
  assert.equal(relativeLedger.ready, false);
  assert.match(relativeLedger.gap, /absolute ledger path/i);

  const wrongRoute = assessPayPalPaymentProofReadiness(paypalProofEnv({
    THUMBGATE_PAYPAL_WEBHOOK_URL: 'https://thumbgate.test/wrong-route',
  }));
  assert.equal(wrongRoute.ready, false);
  assert.match(wrongRoute.gap, /webhook/i);
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
      return response('Start ThumbGate Pro <input name="customer_email" required><a>Pay $19/mo with Stripe</a><a>Not sure yet? Send the workflow first</a>');
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.checkout.focusedProCta, true);
  assert.equal(result.checkout.workflowFallback, true);
  assert.equal(result.checkout.emailInputPresent, true);
  assert.equal(result.checkout.emailOptionalBeforeStripe, false);
  assert.equal(result.checkout.requiresEmailBeforeStripe, true);
  assert.equal(result.checkout.leaksServiceLinks, false);
  assert.equal(result.confirm.probeDisabled, true);
  assert.equal(result.confirm.redirects, null);
  // Exactly 2 fetches (root + /checkout/pro). Was 3 before — the third was
  // the confirm=1 GET that's now disabled.
  assert.equal(calls.length, 2);
});

test('probePublicFunnel fails when Pro checkout email is optional before Stripe', async () => {
  const result = await probePublicFunnel({
    appOrigin: 'https://thumbgate.test',
    async fetchImpl(url) {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/') {
        return response('<script defer data-domain="thumbgate.ai" src="https://plausible.io/js/script.js"></script><script>fetch("/v1/telemetry/ping")</script>');
      }
      return response('Start ThumbGate Pro <input name="customer_email"><a>Pay $19/mo with Stripe</a><a>Not sure yet? Send the workflow first</a>');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.checkout.emailInputPresent, true);
  assert.equal(result.checkout.emailOptionalBeforeStripe, true);
  assert.equal(result.checkout.requiresEmailBeforeStripe, false);
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
    loadLocalSecrets: false,
    env: {},
    appOrigin: 'https://thumbgate.test',
    async fetchImpl(url) {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/' || parsed.search.includes('confirm=1')) {
        return response('', { status: parsed.search.includes('confirm=1') ? 302 : 200 });
      }
      return response('Start ThumbGate Pro <input name="customer_email" required> Pay $19/mo with Stripe Not sure yet? Send the workflow first');
    },
  });

  assert.equal(report.verdict, 'blocked');
  assert.equal(report.canProveRevenue, false);
  assert.equal(report.canProveIndividualPayment, false);
  assert.equal(report.globalRevenueClaimVerified, false);
  assert.equal(report.canProveVisitorBehavior, false);
  assert.ok(report.nextActions.some((line) => /Stripe secret key/.test(line)));
  assert.ok(formatDoctorReport(report).includes('Revenue Observability Doctor: BLOCKED'));
});

test('doctor blocks active PayPal revenue readiness when checkout exists without audit and webhook proof settings', async () => {
  const report = await buildRevenueObservabilityDoctor({
    loadLocalSecrets: false,
    env: {
      THUMBGATE_OPERATOR_KEY: 'operator',
      STRIPE_SECRET_KEY: 'sk_live_x',
      THUMBGATE_MOR_PROVIDER: 'PayPal',
      THUMBGATE_PAYPAL_DIAGNOSTIC_CHECKOUT_URL: 'https://www.paypal.com/ncp/payment/DIAGNOSTIC',
      PLAUSIBLE_API_KEY: 'plausible',
      PLAUSIBLE_SITE_ID: 'thumbgate.ai',
      POSTHOG_PERSONAL_API_KEY: 'phx',
      POSTHOG_PROJECT_ID: '123',
    },
    appOrigin: 'https://thumbgate.test',
    async fetchImpl(url) {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/') {
        return response('<script data-domain="thumbgate.ai"></script><script>fetch("/v1/telemetry/ping")</script>');
      }
      return response('Start ThumbGate Pro <input name="customer_email" required> Pay $19/mo with Stripe Not sure yet? Send the workflow first');
    },
  });

  const paypal = report.checks.find((check) => check.id === 'paypal_payment_proof_access');
  assert.equal(report.verdict, 'blocked');
  assert.equal(report.canProveRevenue, false);
  assert.equal(report.canProveIndividualPayment, true);
  assert.equal(paypal.ok, false);
  assert.equal(paypal.evidence.providerIsPayPal, true);
  assert.match(report.revenueProofBoundary, /not payment evidence/i);
});

test('doctor blocks when deployed checkout leaves email optional before provider creation', async () => {
  const report = await buildRevenueObservabilityDoctor({
    loadLocalSecrets: false,
    env: {
      THUMBGATE_OPERATOR_KEY: 'operator',
      STRIPE_SECRET_KEY: 'sk_live_x',
      PLAUSIBLE_API_KEY: 'plausible',
      PLAUSIBLE_SITE_ID: 'thumbgate.ai',
      POSTHOG_PERSONAL_API_KEY: 'phx',
      POSTHOG_PROJECT_ID: '123',
    },
    appOrigin: 'https://thumbgate.test',
    fetchImpl: makeDoctorFetch({
      checkoutHtml: 'Start ThumbGate Pro <input name="customer_email"> Pay $19/mo with Stripe Not sure yet? Send the workflow first',
    }),
  });

  const check = report.checks.find((entry) => entry.id === 'checkout_email_required_before_provider');
  assert.equal(report.verdict, 'blocked');
  assert.equal(check.ok, false);
  assert.equal(check.evidence.requiresEmailBeforeStripe, false);
  assert.ok(report.nextActions.some((line) => /must require a valid buyer email/.test(line)));
});

test('doctor blocks when live markup emits an unregistered Plausible data-domain', async () => {
  const report = await buildRevenueObservabilityDoctor({
    loadLocalSecrets: false,
    env: {
      THUMBGATE_OPERATOR_KEY: 'operator',
      STRIPE_SECRET_KEY: 'sk_live_x',
      PLAUSIBLE_API_KEY: 'plausible',
      PLAUSIBLE_SITE_ID: 'thumbgate.ai',
      POSTHOG_PERSONAL_API_KEY: 'phx',
      POSTHOG_PROJECT_ID: '123',
    },
    appOrigin: 'https://thumbgate.ai',
    fetchImpl: makeDoctorFetch({
      rootHtml: '<script defer data-domain="rogue.example.com" src="https://plausible.io/js/script.js"></script><script>fetch("/v1/telemetry/ping")</script>',
    }),
  });

  const coverage = report.checks.find((check) => check.id === 'plausible_primary_domain_registered');
  assert.equal(report.verdict, 'blocked');
  assert.equal(coverage.ok, false);
  assert.deepEqual(coverage.evidence.missingEmittedDomains, ['rogue.example.com']);
  assert.ok(report.nextActions.some((line) => /Register thumbgate\.ai in Plausible|aligned with registered site ids/.test(line)));
});

test('doctor is ready when proof access and focused public funnel are present', async () => {
  const report = await buildRevenueObservabilityDoctor({
    loadLocalSecrets: false,
    env: {
      ...paypalProofEnv(),
      THUMBGATE_OPERATOR_KEY: 'operator',
      STRIPE_SECRET_KEY: 'sk_live_x',
      PLAUSIBLE_API_KEY: 'plausible',
      PLAUSIBLE_SITE_ID: 'thumbgate.ai',
      POSTHOG_PERSONAL_API_KEY: 'phx',
      POSTHOG_PROJECT_ID: '123',
    },
    appOrigin: 'https://thumbgate.test',
    fetchImpl: makeDoctorFetch(),
  });

  assert.equal(report.verdict, 'ready');
  assert.equal(report.canProveRevenue, true);
  assert.equal(report.canProveIndividualPayment, true);
  assert.equal(report.globalRevenueClaimVerified, false);
  assert.equal(report.canProveVisitorBehavior, true);
  assert.ok(report.checks.some((check) => check.id === 'first_party_journey_export' && check.ok));
  assert.ok(report.checks.some((check) => check.id === 'hosted_billing_summary_access' && check.ok));
  assert.ok(report.checks.some((check) => check.id === 'paypal_payment_proof_access' && check.ok));
});

test('classifyDoctorVerdict maps critical and high failures', () => {
  assert.equal(classifyDoctorVerdict([{ ok: true, severity: 'critical' }]), 'ready');
  assert.equal(classifyDoctorVerdict([{ ok: false, severity: 'high' }]), 'degraded');
  assert.equal(classifyDoctorVerdict([{ ok: false, severity: 'critical' }]), 'blocked');
});

test('probeHostedJson returns missing_api_key_or_fetch without a key', async () => {
  const result = await probeHostedJson({
    appOrigin: 'https://thumbgate.test',
    apiKey: null,
    pathname: '/v1/billing/summary',
    async fetchImpl() { throw new Error('should_not_fetch'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'missing_api_key_or_fetch');
});

test('probeHostedJson parses JSON and surfaces http errors', async () => {
  const ok = await probeHostedJson({
    appOrigin: 'https://thumbgate.test',
    apiKey: 'op',
    pathname: '/v1/billing/summary',
    async fetchImpl() {
      return response(JSON.stringify({ coverage: { tracksBookedRevenue: true } }));
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.body.coverage.tracksBookedRevenue, true);

  const bad = await probeHostedJson({
    appOrigin: 'https://thumbgate.test',
    apiKey: 'op',
    pathname: '/v1/billing/summary',
    async fetchImpl() {
      return response('nope', { status: 500 });
    },
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'http_500');
});

test('doctor can prove revenue via hosted ledger without local Stripe secret', async () => {
  const report = await buildRevenueObservabilityDoctor({
    loadLocalSecrets: false,
    env: {
      THUMBGATE_OPERATOR_KEY: 'operator',
      PLAUSIBLE_API_KEY: 'plausible',
      PLAUSIBLE_SITE_ID: 'thumbgate.ai',
      POSTHOG_PERSONAL_API_KEY: 'phx',
      POSTHOG_PROJECT_ID: '123',
    },
    appOrigin: 'https://thumbgate.test',
    fetchImpl: makeDoctorFetch(),
  });

  assert.equal(report.checks.find((c) => c.id === 'hosted_billing_summary_access').ok, true);
  assert.equal(report.checks.find((c) => c.id === 'stripe_query_access').ok, false);
  assert.equal(report.checks.find((c) => c.id === 'stripe_query_access').severity, 'high');
  assert.equal(report.canProveRevenue, true);
  assert.equal(report.canProveIndividualPayment, true);
  assert.equal(report.verdict, 'degraded');
});

test('doctor marks first_party_journey_export failed when export times out', async () => {
  const report = await buildRevenueObservabilityDoctor({
    loadLocalSecrets: false,
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
      if (parsed.pathname === '/v1/telemetry/export') {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      return makeDoctorFetch()(url);
    },
  });
  const journey = report.checks.find((c) => c.id === 'first_party_journey_export');
  assert.equal(journey.ok, false);
  assert.match(String(journey.evidence.error || ''), /timeout/i);
});

