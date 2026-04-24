'use strict';

const { resolveAnalyticsWindow } = require('./analytics-window');
const { getBillingSummaryLive } = require('./billing');
const { generateDashboard } = require('./dashboard');
const { getFeedbackPaths } = require('./feedback-loop');
const { resolveHostedBillingConfig } = require('./hosted-config');
const { loadOperatorConfig } = require('./operational-summary');

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function shouldPreferHostedDashboard() {
  return String(process.env.THUMBGATE_METRICS_SOURCE || '').trim().toLowerCase() !== 'local';
}

function resolveHostedDashboardConfig() {
  const runtimeConfig = resolveHostedBillingConfig();
  const operatorConfig = loadOperatorConfig();
  // Match operational-summary's key priority chain so north-star and cfo
  // authenticate against the same hosted deployment consistently. Prior to
  // this change, north-star only read THUMBGATE_API_KEY, silently 401'ing
  // on machines configured via operator.json or THUMBGATE_OPERATOR_KEY.
  const apiKey = normalizeText(process.env.THUMBGATE_OPERATOR_KEY)
    || operatorConfig.operatorKey
    || normalizeText(process.env.THUMBGATE_API_KEY);
  const apiBaseUrl = normalizeText(process.env.THUMBGATE_BILLING_API_BASE_URL)
    || operatorConfig.baseUrl
    || runtimeConfig.billingApiBaseUrl;
  return {
    apiBaseUrl,
    apiKey,
  };
}

async function buildOperationalDashboard(options = {}) {
  const analyticsWindow = resolveAnalyticsWindow(options);
  const feedbackDir = options.feedbackDir || getFeedbackPaths().FEEDBACK_DIR;
  const billingSummary = await getBillingSummaryLive(analyticsWindow);

  return generateDashboard(feedbackDir, {
    analyticsWindow,
    billingSummary,
    billingSource: 'live',
    billingFallbackReason: null,
  });
}

async function fetchHostedDashboard(options = {}, config = resolveHostedDashboardConfig()) {
  const analyticsWindow = resolveAnalyticsWindow(options);
  if (!shouldPreferHostedDashboard()) {
    const err = new Error('Hosted operational dashboard is disabled.');
    err.code = 'hosted_dashboard_disabled';
    throw err;
  }
  if (!config.apiBaseUrl || !config.apiKey) {
    const err = new Error('Hosted operational dashboard is not configured.');
    err.code = 'hosted_dashboard_unconfigured';
    throw err;
  }

  const requestUrl = new URL('/v1/dashboard', config.apiBaseUrl);
  requestUrl.searchParams.set('window', analyticsWindow.window);
  requestUrl.searchParams.set('timezone', analyticsWindow.timeZone);
  requestUrl.searchParams.set('now', analyticsWindow.now);

  const response = await fetch(requestUrl, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const err = new Error(`Hosted operational dashboard request failed (${response.status}): ${detail || 'unknown error'}`);
    err.code = 'hosted_dashboard_http_error';
    err.status = response.status;
    throw err;
  }

  return response.json();
}

async function getOperationalDashboard(options = {}) {
  const analyticsWindow = resolveAnalyticsWindow(options);
  try {
    const data = await fetchHostedDashboard(analyticsWindow);
    return {
      source: 'hosted',
      data,
      fallbackReason: null,
      hostedStatus: 200,
    };
  } catch (err) {
    const reason = err && err.message ? err.message : 'hosted_dashboard_unavailable';
    const status = err && typeof err.status === 'number' ? err.status : null;
    const code = err && err.code ? err.code : null;

    // Hosted deliberately disabled or never configured — local fallback is
    // intentional, not a degraded state. Tag as plain 'local'.
    if (code === 'hosted_dashboard_disabled' || code === 'hosted_dashboard_unconfigured') {
      return {
        source: 'local',
        data: await buildOperationalDashboard(analyticsWindow),
        fallbackReason: reason,
        hostedStatus: null,
      };
    }

    // Mirror operational-summary: auth failure is the dangerous case. A
    // dashboard that silently shows $0 revenue (from the local ledger) when
    // Stripe actually has paid customers is a lie the operator acts on.
    // Refuse to guess — surface an actionable error.
    if (status === 401 || status === 403) {
      const authErr = new Error(
        `Hosted operational dashboard rejected credentials (HTTP ${status}). ` +
        `The operator key on this machine does not match the one on the ` +
        `hosted deployment. Fix: set THUMBGATE_OPERATOR_KEY in this shell, ` +
        `or update the operatorKey field in ~/.config/thumbgate/operator.json, ` +
        `to match Railway's THUMBGATE_OPERATOR_KEY. ` +
        `Running north-star without hosted auth would report local-only ` +
        `data as ground truth, which may not reflect actual Stripe revenue. ` +
        `Original response: ${reason}`
      );
      authErr.code = 'hosted_dashboard_unauthorized';
      authErr.status = status;
      throw authErr;
    }

    // Non-auth failure — local fallback is still useful for dev workflows,
    // but tag the source so downstream renderers do not mistake it for
    // verified hosted truth.
    //
    // Log only the status code (trusted) — the full reason contains upstream
    // response text and is only returned structurally via fallbackReason.
    console.warn(
      `[operational-dashboard] Hosted dashboard unreachable (status=${status ?? 'network'}); ` +
      `falling back to LOCAL-UNVERIFIED state. Numbers below may not reflect actual Stripe revenue.`
    );
    return {
      source: 'local-unverified',
      data: await buildOperationalDashboard(analyticsWindow),
      fallbackReason: reason,
      hostedStatus: status,
    };
  }
}

module.exports = {
  buildOperationalDashboard,
  fetchHostedDashboard,
  getOperationalDashboard,
  resolveHostedDashboardConfig,
  shouldPreferHostedDashboard,
};
