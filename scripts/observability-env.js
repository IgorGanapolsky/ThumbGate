'use strict';

/**
 * Load operator-local observability credentials into process.env.
 *
 * Sources (first wins per key, never overwrite an already-set env var):
 *  1. process.env
 *  2. ~/.config/thumbgate/observability.json
 *  3. ~/.config/thumbgate/operator.json (operatorKey / baseUrl only)
 *  4. Stripe managed secret files via resolveStripeSecretKey
 *
 * The JSON file is gitignored operator state. Never print secret values.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OBSERVABILITY_CONFIG_PATH = path.join(os.homedir(), '.config', 'thumbgate', 'observability.json');
const OPERATOR_CONFIG_PATH = path.join(os.homedir(), '.config', 'thumbgate', 'operator.json');

const JSON_KEY_TO_ENV = Object.freeze({
  stripeSecretKey: 'STRIPE_SECRET_KEY',
  plausibleApiKey: 'PLAUSIBLE_API_KEY',
  plausibleSiteId: 'PLAUSIBLE_SITE_ID',
  plausibleSiteIds: 'PLAUSIBLE_SITE_IDS',
  plausibleRegisteredDomains: 'THUMBGATE_PLAUSIBLE_REGISTERED_DOMAINS',
  posthogPersonalApiKey: 'POSTHOG_PERSONAL_API_KEY',
  posthogProjectId: 'POSTHOG_PROJECT_ID',
  operatorKey: 'THUMBGATE_OPERATOR_KEY',
  apiKey: 'THUMBGATE_API_KEY',
  publicAppOrigin: 'THUMBGATE_PUBLIC_APP_ORIGIN',
  billingApiBaseUrl: 'THUMBGATE_BILLING_API_BASE_URL',
});

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function readJsonFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function applyJsonToEnv(json, env) {
  if (!json || typeof json !== 'object') return [];
  const applied = [];
  for (const [jsonKey, envKey] of Object.entries(JSON_KEY_TO_ENV)) {
    if (normalizeText(env[envKey])) continue;
    const value = normalizeText(json[jsonKey]);
    if (!value) continue;
    env[envKey] = value;
    applied.push(envKey);
  }
  return applied;
}

function loadObservabilityEnv({
  env = process.env,
  observabilityPath = OBSERVABILITY_CONFIG_PATH,
  operatorPath = OPERATOR_CONFIG_PATH,
  applyStripeManagedFiles = true,
} = {}) {
  const applied = [];

  const observability = readJsonFile(observabilityPath);
  applied.push(...applyJsonToEnv(observability, env));

  const operator = readJsonFile(operatorPath);
  if (operator) {
    if (!normalizeText(env.THUMBGATE_OPERATOR_KEY) && normalizeText(operator.operatorKey)) {
      env.THUMBGATE_OPERATOR_KEY = String(operator.operatorKey).trim();
      applied.push('THUMBGATE_OPERATOR_KEY');
    }
    if (!normalizeText(env.THUMBGATE_BILLING_API_BASE_URL) && normalizeText(operator.baseUrl)) {
      env.THUMBGATE_BILLING_API_BASE_URL = String(operator.baseUrl).trim();
      applied.push('THUMBGATE_BILLING_API_BASE_URL');
    }
  }

  if (applyStripeManagedFiles && !normalizeText(env.STRIPE_SECRET_KEY)) {
    try {
      const { resolveStripeSecretKey } = require('./stripe-credentials');
      const resolved = resolveStripeSecretKey({ env });
      if (resolved.secretKey) {
        env.STRIPE_SECRET_KEY = resolved.secretKey;
        applied.push('STRIPE_SECRET_KEY');
      }
    } catch {
      // stripe-credentials optional at load time
    }
  }

  // Product-primary Plausible domain is always part of the registered set for
  // doctor/automation unless the operator explicitly overrides site id.
  if (!normalizeText(env.PLAUSIBLE_SITE_ID) && !normalizeText(env.THUMBGATE_PLAUSIBLE_REGISTERED_DOMAINS)) {
    env.THUMBGATE_PLAUSIBLE_REGISTERED_DOMAINS = 'thumbgate.ai,thumbgate-production.up.railway.app';
    applied.push('THUMBGATE_PLAUSIBLE_REGISTERED_DOMAINS');
  }

  return {
    applied: [...new Set(applied)],
    observabilityPath,
    operatorPath,
    hasStripe: Boolean(normalizeText(env.STRIPE_SECRET_KEY)),
    hasPlausible: Boolean(normalizeText(env.PLAUSIBLE_API_KEY) && normalizeText(env.PLAUSIBLE_SITE_ID)),
    hasPosthog: Boolean(normalizeText(env.POSTHOG_PERSONAL_API_KEY) && normalizeText(env.POSTHOG_PROJECT_ID)),
    hasOperator: Boolean(normalizeText(env.THUMBGATE_OPERATOR_KEY) || normalizeText(env.THUMBGATE_API_KEY)),
  };
}

function observabilityConfigTemplate() {
  return {
    stripeSecretKey: '',
    plausibleApiKey: '',
    plausibleSiteId: 'thumbgate.ai',
    plausibleRegisteredDomains: 'thumbgate.ai,thumbgate-production.up.railway.app',
    posthogPersonalApiKey: '',
    posthogProjectId: '',
    publicAppOrigin: 'https://thumbgate.ai',
    billingApiBaseUrl: 'https://thumbgate-production.up.railway.app',
  };
}

module.exports = {
  OBSERVABILITY_CONFIG_PATH,
  OPERATOR_CONFIG_PATH,
  JSON_KEY_TO_ENV,
  loadObservabilityEnv,
  observabilityConfigTemplate,
  readJsonFile,
  normalizeText,
};
