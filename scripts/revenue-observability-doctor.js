#!/usr/bin/env node
'use strict';

const path = require('node:path');

const {
  DEFAULT_PUBLIC_APP_ORIGIN,
} = require('./hosted-config');
const {
  resolveHostedAuditApiKey,
  parseHtmlSignals,
} = require('./revenue-status');
const {
  analyzePlausibleDomainCoverage,
  getConfiguredRegisteredDomains,
} = require('./plausible-domain-config');
const {
  resolvePayPalConfig,
} = require('./provider-live-evidence');

const DEFAULT_TIMEOUT_MS = 10000;
const QUERY_ACCESS_KEYS = Object.freeze({
  stripe: ['STRIPE_SECRET_KEY'],
  paypal: [
    'THUMBGATE_PAYPAL_CLIENT_ID',
    'THUMBGATE_PAYPAL_CLIENT_SECRET',
    'THUMBGATE_PAYPAL_EVIDENCE_RULES_JSON',
    'THUMBGATE_PAYPAL_WEBHOOK_ID',
    'THUMBGATE_PAYPAL_WEBHOOK_URL',
    'THUMBGATE_PAYPAL_WEBHOOK_LEDGER_PATH',
  ],
  plausible: ['PLAUSIBLE_API_KEY', 'PLAUSIBLE_SITE_ID'],
  posthog: ['POSTHOG_PERSONAL_API_KEY', 'POSTHOG_PROJECT_ID'],
  hosted: ['THUMBGATE_OPERATOR_KEY'],
});
const PAYPAL_BUYER_RAIL_KEYS = Object.freeze([
  'THUMBGATE_PAYPAL_DIAGNOSTIC_CHECKOUT_URL',
  'THUMBGATE_PAYPAL_WORKFLOW_SPRINT_CHECKOUT_URL',
  'THUMBGATE_MOR_SNAPSHOT_CHECKOUT_URL',
]);

function parseArgs(argv = []) {
  const options = {
    json: false,
    appOrigin: process.env.THUMBGATE_PUBLIC_APP_ORIGIN || DEFAULT_PUBLIC_APP_ORIGIN,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg.startsWith('--app-origin=')) {
      options.appOrigin = arg.slice('--app-origin='.length).trim() || options.appOrigin;
      continue;
    }
    if (arg.startsWith('--timeout-ms=')) {
      const parsed = Number(arg.slice('--timeout-ms='.length));
      if (Number.isInteger(parsed) && parsed > 0) options.timeoutMs = parsed;
    }
  }

  return options;
}

function hasAllEnv(env, keys) {
  return keys.every((key) => String(env[key] || '').trim().length > 0);
}

function envPresence(env, keys) {
  return Object.fromEntries(keys.map((key) => [key, String(env[key] || '').trim().length > 0]));
}

function assessPayPalPaymentProofReadiness(env = process.env) {
  const proofPresence = envPresence(env, QUERY_ACCESS_KEYS.paypal);
  const buyerRailPresence = envPresence(env, PAYPAL_BUYER_RAIL_KEYS);
  const fallbackCredentialPresence = {
    PAYPAL_CLIENT_ID: String(env.PAYPAL_CLIENT_ID || '').trim().length > 0,
    PAYPAL_CLIENT_SECRET: String(env.PAYPAL_CLIENT_SECRET || '').trim().length > 0,
  };
  const providerIsPayPal = String(env.THUMBGATE_MOR_PROVIDER || '').trim().toLowerCase() === 'paypal';
  const required = providerIsPayPal ||
    Object.values(buyerRailPresence).some(Boolean) ||
    Object.values(proofPresence).some(Boolean) ||
    Object.values(fallbackCredentialPresence).some(Boolean);
  if (!required) {
    return {
      required: false,
      ready: true,
      providerIsPayPal: false,
      directAuditConfigured: false,
      recentPaymentReconciliationConfigured: false,
      proofPresence,
      buyerRailPresence,
      fallbackCredentialPresence,
      gap: null,
    };
  }

  const config = resolvePayPalConfig(env);
  let webhookUrl = null;
  try {
    webhookUrl = new URL(config.webhookUrl || '');
  } catch {
    webhookUrl = null;
  }
  const webhookIdValid = /^[A-Za-z0-9]{1,50}$/.test(String(config.webhookId || ''));
  const webhookUrlValid = Boolean(webhookUrl && webhookUrl.protocol === 'https:' &&
    !webhookUrl.username && !webhookUrl.password && !webhookUrl.hash &&
    webhookUrl.pathname === '/v1/billing/paypal-webhook');
  const ledgerPathValid = path.isAbsolute(String(config.webhookLedgerPath || ''));
  const recentPaymentReconciliationConfigured = Boolean(
    config.configured && webhookIdValid && webhookUrlValid && ledgerPathValid
  );
  let gap = null;
  if (!config.configured) gap = config.gap;
  else if (!recentPaymentReconciliationConfigured) {
    gap = 'PayPal payment proof requires a valid webhook ID, HTTPS /v1/billing/paypal-webhook URL, and absolute ledger path.';
  }

  return {
    required: true,
    ready: recentPaymentReconciliationConfigured,
    providerIsPayPal,
    directAuditConfigured: Boolean(config.configured),
    recentPaymentReconciliationConfigured,
    proofPresence,
    buyerRailPresence,
    fallbackCredentialPresence,
    gap,
  };
}

function extractPlausibleDataDomains(html = '') {
  const domains = [];
  const pattern = /\bdata-domain=["']([^"']+)["']/gi;
  let match = pattern.exec(String(html || ''));
  while (match) {
    domains.push(match[1]);
    match = pattern.exec(String(html || ''));
  }
  return [...new Set(domains)];
}

async function fetchTextWithTimeout(fetchImpl, url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    return {
      ok: res.ok,
      status: res.status,
      url: res.url || String(url),
      text,
      location: res.headers && typeof res.headers.get === 'function'
        ? res.headers.get('location')
        : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probePublicFunnel({ appOrigin, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: 'fetch_unavailable' };
  }

  try {
    const rootUrl = new URL('/', appOrigin);
    const checkoutUrl = new URL('/checkout/pro', appOrigin);
    // 2026-05-19: the confirm=1 verification was creating one zombie Stripe
    // session per cron tick (50+ in 24h, matched the diagnostic pattern).
    // Verifying the redirect contract by GETting the confirm path required
    // hitting the Stripe-session-creation code path, which is the exact
    // behavior we want to prevent in production. The interstitial-page
    // checkout body already proves the deflection path is live; if buyers
    // get past the interstitial and the confirm path is broken, that's a
    // post-deflection regression separately covered by checkout-bot-guard
    // integration tests, not by this prod healthcheck.
    const headers = { 'User-Agent': 'thumbgate-bot-healthcheck' };
    const [root, checkout] = await Promise.all([
      fetchTextWithTimeout(fetchImpl, rootUrl, { headers }, timeoutMs),
      fetchTextWithTimeout(fetchImpl, checkoutUrl, { headers }, timeoutMs),
    ]);

    const checkoutBody = checkout.text || '';
    const emittedPlausibleDomains = [
      ...extractPlausibleDataDomains(root.text || ''),
      ...extractPlausibleDataDomains(checkoutBody),
    ];
    const rootSignals = parseHtmlSignals(root.text || '');
    const checkoutHasFocusedProCta = /Pay \$19\/mo with Stripe/.test(checkoutBody);
    const checkoutHasFallback = /Send the workflow first/.test(checkoutBody);
    const checkoutHasEmailInput = /name=["']customer_email["']/i.test(checkoutBody);
    const checkoutRequiresEmailBeforeStripe = /name=["']customer_email["'][^>]*\brequired\b/i.test(checkoutBody);
    const checkoutEmailOptionalBeforeStripe = checkoutHasEmailInput && !checkoutRequiresEmailBeforeStripe;
    const checkoutLeaksServiceLinks = /https:\/\/buy\.stripe\.com\/|https:\/\/(?:www\.)?paypal\.com\/ncp\/payment\/|Pay \$1 first rule|Pay \$99 teardown|Book \$499 diagnostic|Start \$1500 sprint/.test(checkoutBody);

    return {
      ok: root.ok && checkout.ok && checkoutHasFocusedProCta && checkoutHasFallback && checkoutRequiresEmailBeforeStripe && !checkoutLeaksServiceLinks,
      root: {
        status: root.status,
        ok: root.ok,
        signals: rootSignals,
        plausibleDomains: extractPlausibleDataDomains(root.text || ''),
      },
      checkout: {
        status: checkout.status,
        ok: checkout.ok,
        focusedProCta: checkoutHasFocusedProCta,
        workflowFallback: checkoutHasFallback,
        emailInputPresent: checkoutHasEmailInput,
        emailOptionalBeforeStripe: checkoutEmailOptionalBeforeStripe,
        requiresEmailBeforeStripe: checkoutRequiresEmailBeforeStripe,
        leaksServiceLinks: checkoutLeaksServiceLinks,
        plausibleDomains: extractPlausibleDataDomains(checkoutBody),
      },
      plausibleDomains: [...new Set(emittedPlausibleDomains)],
      confirm: {
        // Confirm-path probe disabled 2026-05-19 — was creating zombie Stripe
        // sessions on every healthcheck. Kept the field shape so downstream
        // consumers don't break; null/false values indicate "not probed".
        status: null,
        redirects: null,
        location: null,
        probeDisabled: true,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.name === 'AbortError'
        ? `timeout_after_${timeoutMs}ms`
        : (error?.message || String(error)),
    };
  }
}

function buildCheck(id, ok, severity, message, evidence = {}) {
  return {
    id,
    ok: Boolean(ok),
    severity,
    message,
    evidence,
  };
}

async function buildRevenueObservabilityDoctor({
  env = process.env,
  appOrigin = env.THUMBGATE_PUBLIC_APP_ORIGIN || DEFAULT_PUBLIC_APP_ORIGIN,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const hostedApiKey = resolveHostedAuditApiKey(env, { operatorKey: null });
  const publicFunnel = await probePublicFunnel({ appOrigin, fetchImpl, timeoutMs });
  const paypalPaymentProof = assessPayPalPaymentProofReadiness(env);
  const plausibleDomainCoverage = analyzePlausibleDomainCoverage({
    emittedDomains: publicFunnel.plausibleDomains || [],
    registeredDomains: getConfiguredRegisteredDomains(env),
  });
  const checks = [
    buildCheck(
      'hosted_operator_auth',
      Boolean(hostedApiKey),
      'critical',
      'Operator key must be available before hosted billing and analytics can be treated as business truth.',
      envPresence(env, QUERY_ACCESS_KEYS.hosted)
    ),
    buildCheck(
      'stripe_query_access',
      hasAllEnv(env, QUERY_ACCESS_KEYS.stripe),
      'critical',
      'Stripe secret key must be available before revenue claims can be verified directly.',
      envPresence(env, QUERY_ACCESS_KEYS.stripe)
    ),
    buildCheck(
      'paypal_payment_proof_access',
      paypalPaymentProof.ready,
      'critical',
      'When PayPal is an active or partially configured buyer rail, direct-audit rules and recent webhook reconciliation must be configured before revenue observability is ready.',
      paypalPaymentProof
    ),
    buildCheck(
      'plausible_query_access',
      hasAllEnv(env, QUERY_ACCESS_KEYS.plausible),
      'high',
      'Plausible API key and site id are required to query source, page, and event data from automation.',
      envPresence(env, QUERY_ACCESS_KEYS.plausible)
    ),
    buildCheck(
      'plausible_primary_domain_registered',
      plausibleDomainCoverage.ok,
      'critical',
      'Register thumbgate.ai in Plausible and keep emitted data-domain values aligned with registered site ids; otherwise primary-domain traffic is invisible.',
      plausibleDomainCoverage
    ),
    buildCheck(
      'posthog_query_access',
      hasAllEnv(env, QUERY_ACCESS_KEYS.posthog),
      'high',
      'PostHog public project token only ingests events; a personal/project API key pair is required for operator readback.',
      envPresence(env, QUERY_ACCESS_KEYS.posthog)
    ),
    buildCheck(
      'first_party_journey_export',
      Boolean(hostedApiKey),
      'high',
      'Operator-key gated /v1/telemetry/export now returns session-level journeySummary, stage counts, and dropoff buckets from first-party ledgers.',
      { endpoint: '/v1/telemetry/export', requires: 'THUMBGATE_OPERATOR_KEY or THUMBGATE_API_KEY' }
    ),
    buildCheck(
      'public_funnel_health',
      publicFunnel.ok,
      'critical',
      'Public home, Pro interstitial, and confirmed checkout route must be healthy and focused.',
      publicFunnel
    ),
    buildCheck(
      'checkout_email_required_before_provider',
      publicFunnel.checkout?.requiresEmailBeforeStripe === true,
      'critical',
      'Pro checkout must require a valid buyer email before provider session creation.',
      publicFunnel.checkout || {}
    ),
  ];

  const criticalFailures = checks.filter((check) => !check.ok && check.severity === 'critical');
  const highFailures = checks.filter((check) => !check.ok && check.severity === 'high');
  let verdict;
  if (criticalFailures.length) {
    verdict = 'blocked';
  } else if (highFailures.length) {
    verdict = 'degraded';
  } else {
    verdict = 'ready';
  }

  const stripeQueryReady = checks.find((check) => check.id === 'stripe_query_access')?.ok === true;
  const activeProviderProofReady = stripeQueryReady && paypalPaymentProof.ready;
  return {
    generatedAt: new Date().toISOString(),
    appOrigin,
    verdict,
    canProveRevenue: activeProviderProofReady,
    canProveIndividualPayment: stripeQueryReady || (paypalPaymentProof.required && paypalPaymentProof.ready),
    globalRevenueClaimVerified: false,
    revenueProofBoundary: 'Configuration readiness is not payment evidence. Run the strict revenue target control with provider-origin data before making a global revenue claim.',
    canProveVisitorBehavior: (
      checks.find((check) => check.id === 'plausible_query_access')?.ok === true ||
      checks.find((check) => check.id === 'posthog_query_access')?.ok === true ||
      checks.find((check) => check.id === 'first_party_journey_export')?.ok === true
    ),
    checks,
    nextActions: checks
      .filter((check) => !check.ok)
      .map((check) => check.message),
  };
}

function formatDoctorReport(report) {
  const lines = [
    `Revenue Observability Doctor: ${report.verdict.toUpperCase()}`,
    `App origin: ${report.appOrigin}`,
    `Active-provider proof prerequisites ready: ${report.canProveRevenue ? 'yes' : 'no'}`,
    `Can prove an individual payment: ${report.canProveIndividualPayment ? 'yes' : 'no'}`,
    `Global revenue claim verified: ${report.globalRevenueClaimVerified ? 'yes' : 'no'}`,
    `Can prove visitor behavior: ${report.canProveVisitorBehavior ? 'yes' : 'no'}`,
    '',
    'Checks:',
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.ok ? 'PASS' : 'FAIL'} [${check.severity}] ${check.id}: ${check.message}`);
  }

  if (report.nextActions.length) {
    lines.push('', 'Next actions:');
    for (const action of report.nextActions) lines.push(`- ${action}`);
  }

  return `${lines.join('\n')}\n`;
}

function doctorExitCode(report) {
  return report?.verdict === 'blocked' ? 1 : 0;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await buildRevenueObservabilityDoctor(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatDoctorReport(report));
  }
  process.exitCode = doctorExitCode(report);
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  QUERY_ACCESS_KEYS,
  parseArgs,
  hasAllEnv,
  envPresence,
  assessPayPalPaymentProofReadiness,
  probePublicFunnel,
  extractPlausibleDataDomains,
  buildRevenueObservabilityDoctor,
  formatDoctorReport,
  doctorExitCode,
};

if (require('node:path').resolve(process.argv[1] || '') === require('node:path').resolve(__filename)) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exit(1);
  });
}
