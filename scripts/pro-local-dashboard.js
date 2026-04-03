'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  activateLicense,
  fetchLicenseEntitlement,
  getLicenseDir,
  getLicensePath,
  isSupportedLicenseKey,
  readLicense,
} = require('./license');

const DEFAULT_PRO_API = 'https://rlhf-feedback-loop-production.up.railway.app';
const CREATOR_BYPASS_VALUE = process.env.THUMBGATE_DEV_SECRET || '';
const CREATOR_BYPASS_ENV = 'THUMBGATE_DEV_BYPASS';
const CREATOR_SYNTHETIC_KEY = process.env.THUMBGATE_DEV_KEY || '';

/**
 * Creator/dogfooding bypass — returns true when the tool creator is running locally.
 * Two layers (PostHog/Laravel pattern):
 *   1. Config file: ~/.config/thumbgate/dev.json with {"bypass":"[set via THUMBGATE_DEV_SECRET env var]"}
 *   2. Env var: THUMBGATE_DEV_BYPASS=[set via THUMBGATE_DEV_SECRET env var]
 * Requires a specific non-obvious value (not boolean) to prevent accidental activation.
 */
function isCreatorDev({ env = process.env, homeDir = os.homedir() } = {}) {
  // Layer 1: env var with specific value
  if (CREATOR_BYPASS_VALUE && String(env[CREATOR_BYPASS_ENV] || '') === CREATOR_BYPASS_VALUE) {
    return true;
  }
  // Layer 2: persistent config file (set once, never think about it again)
  try {
    const configPath = path.join(homeDir, '.config', 'thumbgate', 'dev.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (CREATOR_BYPASS_VALUE && config && config.bypass === CREATOR_BYPASS_VALUE) {
      return true;
    }
  } catch { /* not a dev machine */ }
  return false;
}

function saveLicense(key, { homeDir, version } = {}) {
  const result = activateLicense(key, { homeDir, version });
  if (!result.success) {
    throw new Error(result.error || 'Unable to save license key.');
  }
  return result.path;
}

function resolveProKey({ env = process.env, homeDir } = {}) {
  // Creator bypass — unlocks Pro without any license key
  if (isCreatorDev({ env, homeDir })) {
    return {
      key: CREATOR_SYNTHETIC_KEY,
      source: 'creator-dev',
      plan: 'enterprise',
    };
  }

  const envKey = String(env.RLHF_API_KEY || '').trim();
  if (isSupportedLicenseKey(envKey)) {
    return {
      key: envKey,
      source: 'env',
    };
  }

  const license = readLicense({ homeDir });
  const licenseKey = String(license && license.key ? license.key : '').trim();
  if (isSupportedLicenseKey(licenseKey)) {
    return {
      key: licenseKey,
      source: 'license',
      licensePath: getLicensePath(homeDir),
    };
  }

  return null;
}

async function validateProKey(key, { apiBaseUrl = DEFAULT_PRO_API, fetchImpl = globalThis.fetch } = {}) {
  const entitlement = await fetchLicenseEntitlement(key, { apiBaseUrl, fetchImpl });
  return Boolean(entitlement.valid);
}

async function startLocalProDashboard({
  key,
  env = process.env,
  port,
  startServerImpl,
  homeDir,
} = {}) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey && !isCreatorDev({ env, homeDir })) {
    throw new Error('Pro license key required.');
  }

  env.RLHF_PRO_MODE = '1';
  env.RLHF_API_KEY = normalizedKey;

  const desiredPort = Number(port ?? env.PORT ?? 3456);
  env.PORT = String(desiredPort);

  const startServer = startServerImpl || require(path.join(__dirname, '..', 'src', 'api', 'server')).startServer;
  const handle = await startServer({ port: desiredPort });
  return {
    server: handle.server,
    port: handle.port,
    url: `http://localhost:${handle.port}/dashboard`,
  };
}

module.exports = {
  CREATOR_BYPASS_ENV,
  CREATOR_BYPASS_VALUE,
  CREATOR_SYNTHETIC_KEY,
  DEFAULT_PRO_API,
  getLicenseDir,
  getLicensePath,
  isCreatorDev,
  readLicense,
  saveLicense,
  resolveProKey,
  validateProKey,
  startLocalProDashboard,
};
