'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VALID_PREFIXES = ['tg_pro_', 'tg_'];
const LEGACY_COMPATIBLE_KEY = /^[a-z]{4,16}_[a-f0-9]{24,}$/i;
// Tiers whose signed entitlement token unlocks Pro-gated behaviour (rate-limit
// caps lift, Pro features unlock). Free-tier signed tokens must NOT count.
const SIGNED_PRO_TIERS = new Set(['pro', 'team', 'enterprise']);

function getLicensePath(homeDir = process.env.HOME || process.env.USERPROFILE || '.') {
  return path.join(homeDir, '.thumbgate', 'license.json');
}

const LICENSE_PATH = getLicensePath();

function isValidKey(key) {
  return Boolean(
    key
    && (
      VALID_PREFIXES.some((p) => key.startsWith(p))
      || LEGACY_COMPATIBLE_KEY.test(key)
    )
  );
}

// Collect candidate signed-entitlement tokens (compact JWS, `eyJ…`) from the
// THUMBGATE_LICENSE env var and the local license file. Legacy `tg_`-prefixed
// keys are skipped here — they are handled by the prefix/isValidKey path.
function collectSignedTokenCandidates(licensePath) {
  const candidates = [];
  const envToken = process.env.THUMBGATE_LICENSE;
  if (envToken && envToken.trim()) candidates.push(envToken.trim());
  try {
    if (fs.existsSync(licensePath)) {
      const data = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
      for (const field of [data.license, data.token, data.key]) {
        if (field && String(field).trim()) candidates.push(String(field).trim());
      }
    }
  } catch (_) {}
  return candidates;
}

// Honour a cryptographically-signed, EXPIRING entitlement token (see
// scripts/entitlement.js). This is what makes a real 30-day Pro trial possible:
// the token grants Pro until `exp`, then verification fails and the caller
// reverts to free — unlike the non-expiring tg_pro_ prefix keys.
function verifySignedEntitlement(licensePath, options = {}) {
  let entitlement;
  try {
    entitlement = require('./entitlement');
  } catch (_) {
    return null; // entitlement module unavailable — no signed support
  }
  const verifyOpts = options.trustedKeys ? { trustedKeys: options.trustedKeys } : undefined;
  for (const token of collectSignedTokenCandidates(licensePath)) {
    if (/^tg_/.test(token)) continue; // legacy prefix key, not a signed token
    let result;
    try {
      result = entitlement.verifyLicense(token, verifyOpts);
    } catch (_) {
      continue;
    }
    // verifyLicense returns { valid:false, reason:'expired' } past exp, so an
    // expired trial correctly falls through to the free tier.
    if (result && result.valid && SIGNED_PRO_TIERS.has(result.tier)) {
      return { valid: true, source: 'entitlement', tier: result.tier, exp: result.exp || null };
    }
  }
  return null;
}

function verifyLicense(options = {}) {
  // Only ThumbGate's own env vars are license candidates — scanning foreign
  // *_API_KEY / *_PRO_KEY vars would treat another vendor's secret as a
  // license key. The result object never carries the raw key value.
  const envEntry = [
    ['THUMBGATE_API_KEY', process.env.THUMBGATE_API_KEY],
    ['THUMBGATE_PRO_KEY', process.env.THUMBGATE_PRO_KEY],
    ...Object.entries(process.env)
      .filter(([name]) => name.startsWith('THUMBGATE_') && /(?:_API_KEY|_PRO_KEY)$/.test(name)),
  ].find(([, value]) => isValidKey(value));
  if (envEntry) {
    return { valid: true, source: 'env', envVar: envEntry[0] };
  }

  const licensePath = getLicensePath(options.homeDir);
  try {
    if (fs.existsSync(licensePath)) {
      const data = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
      if (isValidKey(data.key)) {
        return {
          valid: true,
          source: 'file',
          activatedAt: data.activatedAt,
          path: licensePath,
        };
      }
    }
  } catch (_) {}

  // Signed, expiring entitlement token (env THUMBGATE_LICENSE or license file).
  const signed = verifySignedEntitlement(licensePath, options);
  if (signed) return signed;

  return { valid: false, source: null };
}

function isProLicensed(options) {
  return verifyLicense(options).valid;
}

function activateLicense(key, options = {}) {
  if (!isValidKey(key)) {
    return { success: false, error: 'Invalid key format. Expected tg_... or tg_pro_...' };
  }

  const licensePath = getLicensePath(options.homeDir);
  const dir = path.dirname(licensePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data = { key, activatedAt: new Date().toISOString(), version: require('../package.json').version };
  fs.writeFileSync(licensePath, JSON.stringify(data, null, 2));
  return { success: true, path: licensePath };
}

function generateLicenseKey(email) {
  const payload = `${email}:${Date.now()}`;
  const hash = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
  return `tg_pro_${hash}`;
}

module.exports = {
  verifyLicense,
  isProLicensed,
  activateLicense,
  isValidKey,
  VALID_PREFIXES,
  LICENSE_PATH,
  getLicensePath,
};
