'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { resolveHostedBillingConfig } = require('./hosted-config');

const LICENSE_FILE = 'license.json';
const VALID_PREFIXES = ['rlhf_', 'tg_pro_', 'tg_'];
const DEFAULT_ENTITLEMENT = {
  valid: false,
  tier: 'free',
  planId: null,
  billingCycle: null,
  seatCount: null,
  features: {},
  source: null,
  checkedAt: null,
};

function resolveHomeDir(homeDir) {
  return homeDir || process.env.HOME || process.env.USERPROFILE || os.homedir() || '.';
}

function getLicenseDir(homeDir) {
  return path.join(resolveHomeDir(homeDir), '.thumbgate');
}

function getLicensePath(homeDir) {
  return path.join(getLicenseDir(homeDir), LICENSE_FILE);
}

function readLicense({ homeDir } = {}) {
  try {
    return JSON.parse(fs.readFileSync(getLicensePath(homeDir), 'utf8'));
  } catch {
    return null;
  }
}

function normalizeSeatCount(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeEntitlement(entitlement = {}) {
  if (!entitlement || typeof entitlement !== 'object') {
    return { ...DEFAULT_ENTITLEMENT };
  }

  return {
    valid: Boolean(entitlement.valid),
    tier: entitlement.tier || (entitlement.planId === 'team' ? 'team' : entitlement.valid ? 'pro' : 'free'),
    planId: entitlement.planId || null,
    billingCycle: entitlement.billingCycle || null,
    seatCount: normalizeSeatCount(entitlement.seatCount),
    features: entitlement.features && typeof entitlement.features === 'object' ? entitlement.features : {},
    source: entitlement.source || null,
    checkedAt: entitlement.checkedAt || null,
  };
}

function isValidKey(key) {
  const normalized = String(key || '').trim();
  return VALID_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isSupportedLicenseKey(key) {
  return isValidKey(key);
}

function activateLicense(key, { homeDir, version, entitlement } = {}) {
  const normalizedKey = String(key || '').trim();
  if (!isValidKey(normalizedKey)) {
    return { success: false, error: 'Invalid key format. Expected a ThumbGate-issued rlhf_*, tg_pro_*, or tg_* key.' };
  }

  const licenseDir = getLicenseDir(homeDir);
  const licensePath = getLicensePath(homeDir);
  const timestamp = new Date().toISOString();
  const record = {
    key: normalizedKey,
    savedAt: timestamp,
    activatedAt: timestamp,
    version: version || require('../package.json').version,
  };

  if (entitlement) {
    record.entitlement = normalizeEntitlement({
      ...entitlement,
      checkedAt: entitlement.checkedAt || timestamp,
    });
  }

  fs.mkdirSync(licenseDir, { recursive: true });
  fs.writeFileSync(licensePath, JSON.stringify(record, null, 2) + '\n');
  return { success: true, path: licensePath, license: record };
}

function generateLicenseKey(email) {
  const payload = `${email}:${Date.now()}`;
  const hash = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
  return `tg_pro_${hash}`;
}

async function fetchLicenseEntitlement(key, {
  apiBaseUrl,
  fetchImpl = globalThis.fetch,
  extraHeaders = {},
} = {}) {
  const normalizedKey = String(key || '').trim();
  if (!isValidKey(normalizedKey) || typeof fetchImpl !== 'function') {
    return { ...DEFAULT_ENTITLEMENT };
  }

  const hostedConfig = resolveHostedBillingConfig();
  const baseUrl = apiBaseUrl || process.env.RLHF_BILLING_API_BASE_URL || hostedConfig.billingApiBaseUrl;
  let entitlementUrl;

  try {
    entitlementUrl = new URL('/v1/billing/entitlement', `${String(baseUrl || '').replace(/\/+$/, '')}/`).toString();
  } catch {
    return { ...DEFAULT_ENTITLEMENT };
  }

  try {
    const res = await fetchImpl(entitlementUrl, {
      headers: {
        Authorization: `Bearer ${normalizedKey}`,
        ...extraHeaders,
      },
    });

    if (!res.ok) {
      return {
        ...DEFAULT_ENTITLEMENT,
        status: res.status,
      };
    }

    const data = await res.json().catch(() => ({}));
    return normalizeEntitlement({
      ...data,
      checkedAt: data.checkedAt || new Date().toISOString(),
    });
  } catch {
    return { ...DEFAULT_ENTITLEMENT };
  }
}

async function validateAndActivateLicense(key, options = {}) {
  const entitlement = await fetchLicenseEntitlement(key, options);
  if (!entitlement.valid) {
    return { success: false, error: 'License key is not active. Complete checkout first or verify the key.' };
  }

  return activateLicense(key, {
    homeDir: options.homeDir,
    version: options.version,
    entitlement,
  });
}

function verifyLicense({ env = process.env, homeDir } = {}) {
  const envKey = String(env.RLHF_API_KEY || env.THUMBGATE_PRO_KEY || '').trim();
  if (isValidKey(envKey)) {
    return {
      valid: true,
      source: 'env',
      key: envKey,
      entitlement: normalizeEntitlement({
        valid: true,
        tier: env.RLHF_PRO_MODE === '1' ? 'pro' : null,
        checkedAt: null,
      }),
    };
  }

  const license = readLicense({ homeDir });
  const storedKey = String(license && license.key ? license.key : '').trim();
  if (!isValidKey(storedKey)) {
    return { valid: false, source: null };
  }

  const entitlement = normalizeEntitlement({
    valid: true,
    tier: 'pro',
    ...(license && license.entitlement ? license.entitlement : {}),
  });

  return {
    valid: entitlement.valid,
    source: 'file',
    key: storedKey,
    activatedAt: license.savedAt || license.activatedAt || null,
    entitlement,
  };
}

function isProLicensed(options) {
  return verifyLicense(options).valid;
}

module.exports = {
  LICENSE_PATH: getLicensePath(),
  VALID_PREFIXES,
  activateLicense,
  fetchLicenseEntitlement,
  generateLicenseKey,
  getLicenseDir,
  getLicensePath,
  isProLicensed,
  isSupportedLicenseKey,
  isValidKey,
  readLicense,
  validateAndActivateLicense,
  verifyLicense,
};
