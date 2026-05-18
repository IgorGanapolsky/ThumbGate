#!/usr/bin/env node
'use strict';

const {
  DEFAULT_PUBLIC_APP_ORIGIN,
} = require('./hosted-config');
const {
  resolveHostedAuditApiKey,
  parseHtmlSignals,
} = require('./revenue-status');

const DEFAULT_TIMEOUT_MS = 10000;
const QUERY_ACCESS_KEYS = Object.freeze({
  stripe: ['STRIPE_SECRET_KEY'],
  plausible: ['PLAUSIBLE_API_KEY', 'PLAUSIBLE_SITE_ID'],
  posthog: ['POSTHOG_PERSONAL_API_KEY', 'POSTHOG_PROJECT_ID'],
  hosted: ['THUMBGATE_OPERATOR_KEY'],
});

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
    const confirmUrl = new URL('/checkout/pro?confirm=1', appOrigin);
    const [root, checkout, confirm] = await Promise.all([
      fetchTextWithTimeout(fetchImpl, rootUrl, {}, timeoutMs),
      fetchTextWithTimeout(fetchImpl, checkoutUrl, {}, timeoutMs),
      fetchTextWithTimeout(fetchImpl, confirmUrl, { redirect: 'manual' }, timeoutMs),
    ]);

    const checkoutBody = checkout.text || '';
    const rootSignals = parseHtmlSignals(root.text || '');
    const checkoutHasFocusedProCta = /Pay \$19\/mo with Stripe/.test(checkoutBody);
    const checkoutHasFallback = /Send the workflow first/.test(checkoutBody);
    const checkoutLeaksServiceLinks = /https:\/\/buy\.stripe\.com\/|Pay \$1 first rule|Pay \$99 teardown|Book \$499 diagnostic|Start \$1500 sprint/.test(checkoutBody);
    const confirmRedirects = confirm.status >= 300 && confirm.status < 400;

    return {
      ok: root.ok && checkout.ok && confirmRedirects && checkoutHasFocusedProCta && !checkoutLeaksServiceLinks,
      root: {
        status: root.status,
        ok: root.ok,
        signals: rootSignals,
      },
      checkout: {
        status: checkout.status,
        ok: checkout.ok,
        focusedProCta: checkoutHasFocusedProCta,
        workflowFallback: checkoutHasFallback,
        leaksServiceLinks: checkoutLeaksServiceLinks,
      },
      confirm: {
        status: confirm.status,
        redirects: confirmRedirects,
        location: confirm.location,
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
      'plausible_query_access',
      hasAllEnv(env, QUERY_ACCESS_KEYS.plausible),
      'high',
      'Plausible API key and site id are required to query source, page, and event data from automation.',
      envPresence(env, QUERY_ACCESS_KEYS.plausible)
    ),
    buildCheck(
      'posthog_query_access',
      hasAllEnv(env, QUERY_ACCESS_KEYS.posthog),
      'high',
      'PostHog public project token only ingests events; a personal/project API key pair is required for operator readback.',
      envPresence(env, QUERY_ACCESS_KEYS.posthog)
    ),
    buildCheck(
      'public_funnel_health',
      publicFunnel.ok,
      'critical',
      'Public home, Pro interstitial, and confirmed checkout route must be healthy and focused.',
      publicFunnel
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

  return {
    generatedAt: new Date().toISOString(),
    appOrigin,
    verdict,
    canProveRevenue: checks.find((check) => check.id === 'stripe_query_access')?.ok === true,
    canProveVisitorBehavior: (
      checks.find((check) => check.id === 'plausible_query_access')?.ok === true ||
      checks.find((check) => check.id === 'posthog_query_access')?.ok === true
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
    `Can prove revenue: ${report.canProveRevenue ? 'yes' : 'no'}`,
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

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await buildRevenueObservabilityDoctor(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(formatDoctorReport(report));
  if (report.verdict === 'blocked') process.exitCode = 1;
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  QUERY_ACCESS_KEYS,
  parseArgs,
  hasAllEnv,
  envPresence,
  probePublicFunnel,
  buildRevenueObservabilityDoctor,
  formatDoctorReport,
};

if (require('node:path').resolve(process.argv[1] || '') === require('node:path').resolve(__filename)) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exit(1);
  });
}
