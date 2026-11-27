'use strict';

const crypto = require('node:crypto');
const {
  PRO_MONTHLY_PAYMENT_LINK,
  PRO_MONTHLY_PRICE_DOLLARS,
  PRO_PRICE_LABEL,
} = require('./commercial-offer');

const DEFAULT_PUBLIC_APP_ORIGIN = 'https://thumbgate-production.up.railway.app';
const DEFAULT_CHECKOUT_FALLBACK_URL = PRO_MONTHLY_PAYMENT_LINK;
const DEFAULT_PRO_PRICE_DOLLARS = PRO_MONTHLY_PRICE_DOLLARS;
const DEFAULT_PRO_PRICE_LABEL = PRO_PRICE_LABEL;
const DEFAULT_SPRINT_DIAGNOSTIC_PRICE_DOLLARS = 499;
const DEFAULT_WORKFLOW_SPRINT_PRICE_DOLLARS = 1500;
// Keep fallbacks price-aligned. Sprint must NOT share the diagnostic Stripe slug.
const DEFAULT_SPRINT_DIAGNOSTIC_CHECKOUT_URL = 'https://buy.stripe.com/9B69ATbmI4r4aK5eOD3sI3k';
const DEFAULT_WORKFLOW_SPRINT_CHECKOUT_URL = 'https://www.paypal.com/ncp/payment/LTQFR7P9AR3QG';
const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]+$/i;
// The one GA4 web stream for thumbgate.ai: property "ThumbGate" (properties/565856706), the only property with
// thumbgate.ai traffic. THUMBGATE_GA_MEASUREMENT_ID replaces it; "off" removes the tag.
const DEFAULT_GA_MEASUREMENT_ID = 'G-QKENZBW1V8';
// Ids that belong to other sites and must never tag thumbgate.ai. G-SZR5039QN4 is the ApplyOps stream
// (igorganapolsky.github.io, skills/applyops-deploy); a stale Railway variable still carries it.
const FOREIGN_GA_MEASUREMENT_IDS = new Set(['G-SZR5039QN4']);
// No second property by default. THUMBGATE_GA_EXTRA_MEASUREMENT_ID adds one; kept for compatibility.
const DEFAULT_GA_EXTRA_MEASUREMENT_ID = '';
const isOff = (raw) => typeof raw === 'string' && raw.trim().toLowerCase() === 'off';

function resolveGaMeasurementId(raw) {
  if (isOff(raw)) return '';
  const id = normalizeTrackingId(raw, GA_MEASUREMENT_ID_PATTERN).toUpperCase();
  return id && !FOREIGN_GA_MEASUREMENT_IDS.has(id) ? id : DEFAULT_GA_MEASUREMENT_ID;
}

function resolveGaExtraMeasurementId(raw, primaryId = '') {
  if (isOff(raw)) return '';
  const id = normalizeTrackingId(raw, GA_MEASUREMENT_ID_PATTERN).toUpperCase();
  if (!id || FOREIGN_GA_MEASUREMENT_IDS.has(id) || id === primaryId) return DEFAULT_GA_EXTRA_MEASUREMENT_ID;
  return id;
}

// Every GA id the public pages configure, primary first, without duplicates.
function resolveGaMeasurementIds(env = process.env) {
  const primary = resolveGaMeasurementId(env.THUMBGATE_GA_MEASUREMENT_ID);
  const extra = resolveGaExtraMeasurementId(env.THUMBGATE_GA_EXTRA_MEASUREMENT_ID, primary);
  return [primary, extra].filter(Boolean);
}

function normalizeOrigin(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/.test(parsed.protocol)) {
      return '';
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    parsed.search = '';
    parsed.hash = '';
    const serialized = parsed.toString();
    return serialized.endsWith('/') ? serialized.slice(0, -1) : serialized;
  } catch {
    return '';
  }
}

function normalizeAbsoluteUrl(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/.test(parsed.protocol)) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizeTrackingId(value, pattern) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (pattern && !pattern.test(trimmed)) {
    return '';
  }

  return trimmed;
}

function resolveNormalizedOrigin(value, fallback = '') {
  return normalizeOrigin(value) || normalizeOrigin(fallback);
}

function joinPublicUrl(baseOrigin, pathname) {
  const normalized = normalizeOrigin(baseOrigin);
  if (!normalized) {
    throw new Error(`Invalid public origin: ${String(baseOrigin || '')}`);
  }
  const cleanPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${normalized}${cleanPath}`;
}

function createTraceId(prefix = 'trace') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function normalizePriceDollars(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.round(parsed);
}

function buildHostedSuccessUrl(appOrigin, traceId) {
  const encodedTraceId = encodeURIComponent(String(traceId || ''));
  const traceQuery = traceId ? `&trace_id=${encodedTraceId}` : '';
  return `${joinPublicUrl(appOrigin, '/success')}?session_id={CHECKOUT_SESSION_ID}${traceQuery}`;
}

function buildHostedCancelUrl(appOrigin, traceId) {
  const encodedTraceId = encodeURIComponent(String(traceId || ''));
  const traceQuery = traceId ? `?trace_id=${encodedTraceId}` : '';
  return `${joinPublicUrl(appOrigin, '/cancel')}${traceQuery}`;
}

function resolveHostedBillingConfig({ requestOrigin } = {}, env = process.env) {
  const inferredOrigin = normalizeOrigin(requestOrigin) || DEFAULT_PUBLIC_APP_ORIGIN;
  const appOrigin = resolveNormalizedOrigin(env.THUMBGATE_PUBLIC_APP_ORIGIN, inferredOrigin) || inferredOrigin;
  const billingApiBaseUrl = resolveNormalizedOrigin(env.THUMBGATE_BILLING_API_BASE_URL, appOrigin) || appOrigin;
  const proPriceDollars = normalizePriceDollars(env.THUMBGATE_PRO_PRICE_DOLLARS) || DEFAULT_PRO_PRICE_DOLLARS;
  const proPriceLabel = env.THUMBGATE_PRO_PRICE_LABEL || DEFAULT_PRO_PRICE_LABEL;
  const [gaMeasurementId = '', gaExtraMeasurementId = ''] = resolveGaMeasurementIds(env);
  const posthogApiKey = env.POSTHOG_API_KEY || '';
  const googleSiteVerification = normalizeTrackingId(env.THUMBGATE_GOOGLE_SITE_VERIFICATION);
  const sprintDiagnosticCheckoutUrl = normalizeAbsoluteUrl(env.THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL)
    || DEFAULT_SPRINT_DIAGNOSTIC_CHECKOUT_URL;
  const workflowSprintCheckoutUrl = normalizeAbsoluteUrl(env.THUMBGATE_WORKFLOW_SPRINT_CHECKOUT_URL)
    || DEFAULT_WORKFLOW_SPRINT_CHECKOUT_URL;

  return {
    appOrigin,
    billingApiBaseUrl,
    checkoutEndpoint: joinPublicUrl(billingApiBaseUrl, '/v1/billing/checkout'),
    sessionEndpoint: joinPublicUrl(billingApiBaseUrl, '/v1/billing/session'),
    checkoutFallbackUrl: normalizeAbsoluteUrl(
      env.THUMBGATE_CHECKOUT_FALLBACK_URL || DEFAULT_CHECKOUT_FALLBACK_URL
    ) || DEFAULT_CHECKOUT_FALLBACK_URL,
    proPriceDollars,
    proPriceLabel,
    sprintDiagnosticCheckoutUrl,
    workflowSprintCheckoutUrl,
    sprintDiagnosticPriceDollars: normalizePriceDollars(env.THUMBGATE_SPRINT_DIAGNOSTIC_PRICE_DOLLARS)
      || DEFAULT_SPRINT_DIAGNOSTIC_PRICE_DOLLARS,
    workflowSprintPriceDollars: normalizePriceDollars(env.THUMBGATE_WORKFLOW_SPRINT_PRICE_DOLLARS)
      || DEFAULT_WORKFLOW_SPRINT_PRICE_DOLLARS,
    gaMeasurementId,
    gaExtraMeasurementId,
    googleSiteVerification,
    posthogApiKey,
  };
}

module.exports = {
  DEFAULT_GA_MEASUREMENT_ID,
  DEFAULT_GA_EXTRA_MEASUREMENT_ID,
  FOREIGN_GA_MEASUREMENT_IDS,
  resolveGaMeasurementId,
  resolveGaExtraMeasurementId,
  resolveGaMeasurementIds,
  DEFAULT_PUBLIC_APP_ORIGIN,
  DEFAULT_CHECKOUT_FALLBACK_URL,
  DEFAULT_PRO_PRICE_DOLLARS,
  DEFAULT_PRO_PRICE_LABEL,
  DEFAULT_SPRINT_DIAGNOSTIC_PRICE_DOLLARS,
  DEFAULT_WORKFLOW_SPRINT_PRICE_DOLLARS,
  DEFAULT_SPRINT_DIAGNOSTIC_CHECKOUT_URL,
  DEFAULT_WORKFLOW_SPRINT_CHECKOUT_URL,
  GA_MEASUREMENT_ID_PATTERN,
  normalizeAbsoluteUrl,
  normalizeOrigin,
  normalizeTrackingId,
  normalizePriceDollars,
  joinPublicUrl,
  createTraceId,
  buildHostedSuccessUrl,
  buildHostedCancelUrl,
  resolveHostedBillingConfig,
};
