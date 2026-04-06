'use strict';

const { getBillingSummaryLive } = require('./billing');
const { resolveAnalyticsWindow } = require('./analytics-window');
const { resolveHostedBillingConfig } = require('./hosted-config');

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function shouldPreferHostedSummary() {
  return String(process.env.THUMBGATE_METRICS_SOURCE || '').trim().toLowerCase() !== 'local';
}

function resolveHostedSummaryConfig() {
  const runtimeConfig = resolveHostedBillingConfig();
  const apiBaseUrl = normalizeText(process.env.THUMBGATE_BILLING_API_BASE_URL) || runtimeConfig.billingApiBaseUrl;
  const apiKey = normalizeText(process.env.THUMBGATE_API_KEY);
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
    };
  } catch (err) {
    const reason = err && err.message ? err.message : 'hosted_summary_unavailable';
    // TODO: Configure hosted billing via THUMBGATE_BILLING_API_BASE_URL and THUMBGATE_API_KEY
    // to avoid falling back to local state. See docs/PRICING_RESEARCH_2026-03-10.md
    console.warn(`[operational-summary] Hosted billing not configured — falling back to local state. Reason: ${reason}`);
    return {
      source: 'local',
      summary: await getBillingSummaryLive(analyticsWindow),
      fallbackReason: reason,
    };
  }
}

module.exports = {
  fetchHostedBillingSummary,
  getOperationalBillingSummary,
  resolveHostedSummaryConfig,
  shouldPreferHostedSummary,
};
