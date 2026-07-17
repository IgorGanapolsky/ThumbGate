'use strict';

const DEFAULT_APP_ORIGIN = 'https://thumbgate.ai';

function normalizeAppOrigin(value = DEFAULT_APP_ORIGIN) {
  const parsed = new URL(String(value || DEFAULT_APP_ORIGIN));
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Buyer-path app origin must use http or https.');
  }
  parsed.pathname = '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.origin;
}

function buildBuyerUrl(pathname, params = {}, appOrigin = DEFAULT_APP_ORIGIN) {
  const normalizedOrigin = normalizeAppOrigin(appOrigin);
  const url = new URL(pathname, `${normalizedOrigin}/`);
  if (url.origin !== normalizedOrigin) {
    throw new Error('Buyer URL must remain on the configured first-party origin.');
  }
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || String(value).trim() === '') continue;
    url.searchParams.set(key, String(value).trim());
  }
  return url.toString();
}

function buildProBuyerUrl({
  billingCycle = 'monthly',
  appOrigin = DEFAULT_APP_ORIGIN,
  source = null,
  medium = null,
  campaign = null,
  content = null,
} = {}) {
  return buildBuyerUrl('/go/pro', {
    plan_id: 'pro',
    billing_cycle: billingCycle === 'annual' ? 'annual' : 'monthly',
    utm_source: source,
    utm_medium: medium,
    utm_campaign: campaign,
    utm_content: content,
  }, appOrigin);
}

function buildDiagnosticBuyerUrl({
  appOrigin = DEFAULT_APP_ORIGIN,
  source = null,
  medium = null,
  campaign = null,
  content = null,
} = {}) {
  return buildBuyerUrl('/diagnostic', {
    plan_id: 'sprint_diagnostic',
    utm_source: source,
    utm_medium: medium,
    utm_campaign: campaign,
    utm_content: content,
  }, appOrigin);
}

function buildSprintBuyerUrl({
  appOrigin = DEFAULT_APP_ORIGIN,
  source = null,
  medium = null,
  campaign = null,
  content = null,
} = {}) {
  return buildBuyerUrl('/go/sprint', {
    plan_id: 'workflow_sprint',
    utm_source: source,
    utm_medium: medium,
    utm_campaign: campaign,
    utm_content: content,
  }, appOrigin);
}

function buildEnterpriseBuyerUrl({ appOrigin = DEFAULT_APP_ORIGIN } = {}) {
  const url = new URL('/', `${normalizeAppOrigin(appOrigin)}/`);
  url.hash = 'workflow-sprint-intake';
  return url.toString();
}

function isFirstPartyBuyerUrl(value, appOrigin = DEFAULT_APP_ORIGIN) {
  try {
    return new URL(value).origin === normalizeAppOrigin(appOrigin);
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULT_APP_ORIGIN,
  buildBuyerUrl,
  buildDiagnosticBuyerUrl,
  buildEnterpriseBuyerUrl,
  buildProBuyerUrl,
  buildSprintBuyerUrl,
  isFirstPartyBuyerUrl,
  normalizeAppOrigin,
};
