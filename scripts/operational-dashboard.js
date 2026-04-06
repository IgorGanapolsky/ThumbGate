'use strict';

const { resolveAnalyticsWindow } = require('./analytics-window');
const { getBillingSummaryLive } = require('./billing');
const { generateDashboard } = require('./dashboard');
const { getFeedbackPaths } = require('./feedback-loop');
const { resolveHostedBillingConfig } = require('./hosted-config');

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
  const apiBaseUrl = normalizeText(process.env.THUMBGATE_BILLING_API_BASE_URL) || runtimeConfig.billingApiBaseUrl;
  const apiKey = normalizeText(process.env.THUMBGATE_API_KEY);
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
    };
  } catch (err) {
    return {
      source: 'local',
      data: await buildOperationalDashboard(analyticsWindow),
      fallbackReason: err && err.message ? err.message : 'hosted_dashboard_unavailable',
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
