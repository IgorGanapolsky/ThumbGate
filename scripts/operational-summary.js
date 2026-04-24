'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { getBillingSummaryLive } = require('./billing');
const { resolveAnalyticsWindow } = require('./analytics-window');
const { resolveHostedBillingConfig } = require('./hosted-config');

// Configure fetch proxy when running behind a corporate/sandbox proxy
(function configureProxy() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxyUrl) return;
  try {
    const { ProxyAgent, setGlobalDispatcher } = require('undici');
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  } catch {
    // undici not available — fetch will use default dispatcher
  }
}());

const OPERATOR_CONFIG_PATH = path.join(os.homedir(), '.config', 'thumbgate', 'operator.json');

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function loadOperatorConfig(configPath = OPERATOR_CONFIG_PATH) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      operatorKey: normalizeText(parsed.operatorKey),
      baseUrl: normalizeText(parsed.baseUrl),
    };
  } catch {
    return { operatorKey: null, baseUrl: null };
  }
}

function shouldPreferHostedSummary() {
  return String(process.env.THUMBGATE_METRICS_SOURCE || '').trim().toLowerCase() !== 'local';
}

function resolveHostedSummaryConfig() {
  const runtimeConfig = resolveHostedBillingConfig();
  const operatorConfig = loadOperatorConfig();
  // Priority: env THUMBGATE_OPERATOR_KEY > local config file > env THUMBGATE_API_KEY
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

async function fetchHostedBillingSummary(options = {}, config = resolveHostedSummaryConfig()) {
  const analyticsWindow = resolveAnalyticsWindow(options);
  if (!shouldPreferHostedSummary()) {
    const err = new Error('Hosted operational summary is disabled.');
    err.code = 'hosted_summary_disabled';
    throw err;
  }
  if (!config.apiBaseUrl || !config.apiKey) {
    const err = new Error('Hosted operational summary is not configured.');
    err.code = 'hosted_summary_unconfigured';
    throw err;
  }

  const requestUrl = new URL('/v1/billing/summary', config.apiBaseUrl);
  requestUrl.searchParams.set('window', analyticsWindow.window);
  requestUrl.searchParams.set('timezone', analyticsWindow.timeZone);
  if (options.now !== undefined && options.now !== null && options.now !== '') {
    requestUrl.searchParams.set('now', analyticsWindow.now);
  }

  const response = await fetch(requestUrl, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const err = new Error(`Hosted operational summary request failed (${response.status}): ${detail || 'unknown error'}`);
    err.code = 'hosted_summary_http_error';
    err.status = response.status;
    throw err;
  }

  return response.json();
}

async function getOperationalBillingSummary(options = {}) {
  const analyticsWindow = resolveAnalyticsWindow(options);
  try {
    const summary = await fetchHostedBillingSummary(analyticsWindow);
    return {
      source: 'hosted',
      summary,
      fallbackReason: null,
      hostedStatus: 200,
    };
  } catch (err) {
    const reason = err && err.message ? err.message : 'hosted_summary_unavailable';
    const status = err && typeof err.status === 'number' ? err.status : null;
    const code = err && err.code ? err.code : null;

    // Hosted deliberately disabled or never configured — local fallback is
    // intentional, not a degraded state. Tag as plain 'local'.
    if (code === 'hosted_summary_disabled' || code === 'hosted_summary_unconfigured') {
      return {
        source: 'local',
        summary: await getBillingSummaryLive(analyticsWindow),
        fallbackReason: reason,
        hostedStatus: null,
      };
    }

    // Auth failure is the most dangerous case: if hosted Stripe data says
    // we have paid customers and local ledgers are empty, silently returning
    // "$0.00" is a lie that hides actual revenue. Refuse to guess — surface
    // an actionable error so the operator fixes the key before any
    // downstream report renders wrong numbers.
    if (status === 401 || status === 403) {
      const authErr = new Error(
        `Hosted billing summary rejected credentials (HTTP ${status}). ` +
        `The operator key on this machine does not match the one on the ` +
        `hosted deployment. Fix: set THUMBGATE_OPERATOR_KEY in this shell, ` +
        `or update the operatorKey field in ~/.config/thumbgate/operator.json, ` +
        `to match Railway's THUMBGATE_OPERATOR_KEY. ` +
        `Running this command without hosted auth would report local-only ` +
        `data as ground truth, which may not reflect actual Stripe revenue. ` +
        `Original response: ${reason}`
      );
      authErr.code = 'hosted_summary_unauthorized';
      authErr.status = status;
      throw authErr;
    }

    // Non-auth failure (network, 5xx, config) — local fallback is still
    // useful for dev workflows, but tag the source so downstream renderers
    // and agents do not mistake it for verified hosted truth.
    //
    // Log only the status code (trusted) — the full reason contains upstream
    // response text and is only returned structurally via fallbackReason.
    console.warn(
      `[operational-summary] Hosted billing unreachable (status=${status ?? 'network'}); ` +
      `falling back to LOCAL-UNVERIFIED state. Numbers below may not reflect actual Stripe revenue.`
    );
    return {
      source: 'local-unverified',
      summary: await getBillingSummaryLive(analyticsWindow),
      fallbackReason: reason,
      hostedStatus: status,
    };
  }
}

module.exports = {
  fetchHostedBillingSummary,
  getOperationalBillingSummary,
  resolveHostedSummaryConfig,
  shouldPreferHostedSummary,
  loadOperatorConfig,
};
