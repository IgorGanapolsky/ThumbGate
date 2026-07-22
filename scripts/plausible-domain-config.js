'use strict';

const PRIMARY_PLAUSIBLE_DOMAIN = 'thumbgate.ai';
const FALLBACK_REGISTERED_PLAUSIBLE_DOMAIN = 'thumbgate-production.up.railway.app';

function splitDomains(value) {
  return String(value || '')
    .split(/[\s,]+/)
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeDomain(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  try {
    return new URL(input.includes('://') ? input : `https://${input}`).hostname.toLowerCase();
  } catch {
    const withoutProtocol = input.replace(/^https?:\/\//i, '');
    const hostnameAndPort = withoutProtocol.split('/')[0];
    return hostnameAndPort.toLowerCase().split(':')[0];
  }
}

function getConfiguredRegisteredDomains(env = process.env) {
  const configured = [
    ...splitDomains(env.PLAUSIBLE_SITE_ID),
    ...splitDomains(env.PLAUSIBLE_SITE_IDS),
    ...splitDomains(env.THUMBGATE_PLAUSIBLE_REGISTERED_DOMAINS),
    ...splitDomains(env.PLAUSIBLE_REGISTERED_DOMAINS),
  ].map(normalizeDomain).filter(Boolean);

  // Both product surfaces are first-class Plausible site ids for ThumbGate.
  // Emitting data-domain=thumbgate.ai while only registering the Railway host
  // previously made primary-domain traffic invisible to automation.
  return [...new Set([
    PRIMARY_PLAUSIBLE_DOMAIN,
    FALLBACK_REGISTERED_PLAUSIBLE_DOMAIN,
    ...configured,
  ])];
}

function isPlausibleDomainRegistered(domain, env = process.env) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;
  return getConfiguredRegisteredDomains(env).includes(normalized);
}

function resolvePlausibleDataDomain({ host = '', env = process.env } = {}) {
  const explicit = normalizeDomain(env.THUMBGATE_PLAUSIBLE_DOMAIN);
  if (explicit) return explicit;

  const normalizedHost = normalizeDomain(host);
  if (isPlausibleDomainRegistered(normalizedHost, env)) {
    return normalizedHost;
  }

  // Prevent local/loopback traffic from mapping to the production Plausible site domain
  const isLocal = normalizedHost === 'localhost' ||
                  normalizedHost === '127.0.0.1' ||
                  normalizedHost === '::1' ||
                  normalizedHost.endsWith('.local') ||
                  normalizedHost.startsWith('192.168.') ||
                  normalizedHost.startsWith('10.');
  if (isLocal) {
    return 'localhost';
  }

  return FALLBACK_REGISTERED_PLAUSIBLE_DOMAIN;
}

function analyzePlausibleDomainCoverage({
  emittedDomains = [],
  registeredDomains = [],
  primaryDomain = PRIMARY_PLAUSIBLE_DOMAIN,
} = {}) {
  const emitted = [...new Set(emittedDomains.map(normalizeDomain).filter(Boolean))];
  const registered = [...new Set(registeredDomains.map(normalizeDomain).filter(Boolean))];
  const registeredSet = new Set(registered);
  const missingEmittedDomains = emitted.filter((domain) => !registeredSet.has(domain));
  const primaryRegistered = registeredSet.has(normalizeDomain(primaryDomain));

  return {
    ok: missingEmittedDomains.length === 0 && primaryRegistered,
    emittedDomains: emitted,
    registeredDomains: registered,
    missingEmittedDomains,
    primaryDomain: normalizeDomain(primaryDomain),
    primaryRegistered,
    severity: missingEmittedDomains.length > 0 || !primaryRegistered ? 'critical' : 'ok',
  };
}

module.exports = {
  PRIMARY_PLAUSIBLE_DOMAIN,
  FALLBACK_REGISTERED_PLAUSIBLE_DOMAIN,
  splitDomains,
  normalizeDomain,
  getConfiguredRegisteredDomains,
  isPlausibleDomainRegistered,
  resolvePlausibleDataDomain,
  analyzePlausibleDomainCoverage,
};
