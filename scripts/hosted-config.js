'use strict';

const crypto = require('node:crypto');

const DEFAULT_PUBLIC_APP_ORIGIN = 'https://rlhf-feedback-loop-production.up.railway.app';
const DEFAULT_CHECKOUT_FALLBACK_URL = 'https://iganapolsky.gumroad.com/l/tjovof';
const DEFAULT_PRO_PRICE_DOLLARS = 29;
const DEFAULT_PRO_PRICE_LABEL = '$29/mo';

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

function resolveHostedBillingConfig({ requestOrigin } = {}) {
  const inferredOrigin = normalizeOrigin(requestOrigin) || DEFAULT_PUBLIC_APP_ORIGIN;
  const appOrigin = normalizeOrigin(process.env.RLHF_PUBLIC_APP_ORIGIN) || inferredOrigin;
  const billingApiBaseUrl = normalizeOrigin(
    process.env.RLHF_BILLING_API_BASE_URL || process.env.RLHF_CANONICAL_API_BASE_URL || appOrigin
  ) || appOrigin;
  const proPriceDollars = normalizePriceDollars(process.env.RLHF_PRO_PRICE_DOLLARS) || DEFAULT_PRO_PRICE_DOLLARS;
  const proPriceLabel = process.env.RLHF_PRO_PRICE_LABEL || DEFAULT_PRO_PRICE_LABEL;

  return {
    appOrigin,
    billingApiBaseUrl,
    checkoutEndpoint: joinPublicUrl(billingApiBaseUrl, '/v1/billing/checkout'),
    sessionEndpoint: joinPublicUrl(billingApiBaseUrl, '/v1/billing/session'),
    checkoutFallbackUrl: normalizeAbsoluteUrl(
      process.env.RLHF_CHECKOUT_FALLBACK_URL || DEFAULT_CHECKOUT_FALLBACK_URL
    ) || DEFAULT_CHECKOUT_FALLBACK_URL,
    proPriceDollars,
    proPriceLabel,
  };
}

module.exports = {
  DEFAULT_PUBLIC_APP_ORIGIN,
  DEFAULT_CHECKOUT_FALLBACK_URL,
  DEFAULT_PRO_PRICE_DOLLARS,
  DEFAULT_PRO_PRICE_LABEL,
  normalizeAbsoluteUrl,
  normalizeOrigin,
  normalizePriceDollars,
  joinPublicUrl,
  createTraceId,
  buildHostedSuccessUrl,
  buildHostedCancelUrl,
  resolveHostedBillingConfig,
};
