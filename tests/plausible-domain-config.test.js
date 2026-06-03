'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PRIMARY_PLAUSIBLE_DOMAIN,
  FALLBACK_REGISTERED_PLAUSIBLE_DOMAIN,
  normalizeDomain,
  getConfiguredRegisteredDomains,
  resolvePlausibleDataDomain,
  analyzePlausibleDomainCoverage,
} = require('../scripts/plausible-domain-config');

test('resolvePlausibleDataDomain keeps known-registered fallback when primary is not registered', () => {
  const env = { PLAUSIBLE_SITE_ID: FALLBACK_REGISTERED_PLAUSIBLE_DOMAIN };

  assert.equal(resolvePlausibleDataDomain({ host: PRIMARY_PLAUSIBLE_DOMAIN, env }), FALLBACK_REGISTERED_PLAUSIBLE_DOMAIN);
});

test('resolvePlausibleDataDomain uses primary domain once Plausible registration is configured', () => {
  const env = { PLAUSIBLE_SITE_ID: PRIMARY_PLAUSIBLE_DOMAIN };

  assert.equal(resolvePlausibleDataDomain({ host: 'https://thumbgate.ai/', env }), PRIMARY_PLAUSIBLE_DOMAIN);
});

test('explicit THUMBGATE_PLAUSIBLE_DOMAIN overrides fallback and host matching', () => {
  const env = {
    THUMBGATE_PLAUSIBLE_DOMAIN: 'analytics.example.com',
    PLAUSIBLE_SITE_ID: FALLBACK_REGISTERED_PLAUSIBLE_DOMAIN,
  };

  assert.equal(resolvePlausibleDataDomain({ host: PRIMARY_PLAUSIBLE_DOMAIN, env }), 'analytics.example.com');
});

test('analyzePlausibleDomainCoverage flags the live dropped-event failure mode', () => {
  const report = analyzePlausibleDomainCoverage({
    emittedDomains: [PRIMARY_PLAUSIBLE_DOMAIN],
    registeredDomains: [FALLBACK_REGISTERED_PLAUSIBLE_DOMAIN],
  });

  assert.equal(report.ok, false);
  assert.equal(report.primaryRegistered, false);
  assert.deepEqual(report.missingEmittedDomains, [PRIMARY_PLAUSIBLE_DOMAIN]);
  assert.equal(report.severity, 'critical');
});

test('configured registered domains include fallback plus Plausible site ids', () => {
  const env = {
    PLAUSIBLE_SITE_ID: 'https://thumbgate.ai/dashboard',
    THUMBGATE_PLAUSIBLE_REGISTERED_DOMAINS: 'docs.thumbgate.ai, app.thumbgate.ai',
  };

  assert.deepEqual(getConfiguredRegisteredDomains(env), [
    FALLBACK_REGISTERED_PLAUSIBLE_DOMAIN,
    PRIMARY_PLAUSIBLE_DOMAIN,
    'docs.thumbgate.ai',
    'app.thumbgate.ai',
  ]);
  assert.equal(normalizeDomain('https://thumbgate.ai/path?x=1'), PRIMARY_PLAUSIBLE_DOMAIN);
});
