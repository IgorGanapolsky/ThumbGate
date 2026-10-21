'use strict';
const fs = require('fs');
const path = require('path');
const {
  verifyLicense: verifySignedEntitlement,
  isEnforced: isEntitlementEnforced,
} = require('./entitlement');

const VALID_PREFIXES = ['tg_pro_', 'tg_'];
const LEGACY_COMPATIBLE_KEY = /^[a-z]{4,16}_[a-f0-9]{24,}$/i;

function getLicensePath(homeDir = process.env.HOME || process.env.USERPROFILE || '.') {
  return path.join(homeDir, '.thumbgate', 'license.json');
}

function getSignedConfigLicensePath(homeDir = process.env.HOME || process.env.USERPROFILE || '.') {
  return path.join(homeDir, '.config', 'thumbgate', 'license.json');
}

const LICENSE_PATH = getLicensePath();

function isLegacyKeyFormat(key) {
  return Boolean(
    typeof key === 'string'
    && key
    && (
      VALID_PREFIXES.some((p) => key.startsWith(p))
      || LEGACY_COMPATIBLE_KEY.test(key)
    )
  );
}

function verifySignedCandidate(token, options = {}) {
  if (typeof token !== 'string' || !token.includes('.')) {
    return { valid: false };
  }
  const verified = verifySignedEntitlement(token, {
    trustedKeys: options.trustedKeys,
    now: options.now,
  });
  if (!verified.valid || verified.tier === 'free') {
    return { valid: false, reason: verified.reason || 'free_tier' };
  }
  return verified;
}

function isValidKey(key, options = {}) {
  if (typeof key !== 'string' || !key) return false;
  if (verifySignedCandidate(key, options).valid) return true;
  const env = options.env || process.env;
  if (isEntitlementEnforced(env)) return false;
  return isLegacyKeyFormat(key);
}

function verifyLicense(options = {}) {
  const env = options.env || process.env;
  const enforced = isEntitlementEnforced(env);

  // 1. Check explicit signed Ed25519 license env (THUMBGATE_LICENSE) first.
  if (typeof env.THUMBGATE_LICENSE === 'string' && env.THUMBGATE_LICENSE.trim()) {
    const signed = verifySignedCandidate(env.THUMBGATE_LICENSE.trim(), options);
    if (signed.valid) {
      return {
        valid: true,
        signed: true,
        tier: signed.tier,
        features: signed.features,
        source: 'env',
        envVar: 'THUMBGATE_LICENSE',
      };
    }
  }

  // 2. Only ThumbGate's own env vars are license candidates — scanning foreign
  // *_API_KEY / *_PRO_KEY vars would treat another vendor's secret as a
  // license key. The result object never carries the raw key value.
  const envCandidates = [
    ['THUMBGATE_API_KEY', env.THUMBGATE_API_KEY],
    ['THUMBGATE_PRO_KEY', env.THUMBGATE_PRO_KEY],
    ...Object.entries(env)
      .filter(([name]) => name.startsWith('THUMBGATE_') && /(?:_API_KEY|_PRO_KEY)$/.test(name)),
  ];
  for (const [envVar, value] of envCandidates) {
    if (typeof value !== 'string' || !value) continue;
    const signed = verifySignedCandidate(value, options);
    if (signed.valid) {
      return {
        valid: true,
        signed: true,
        tier: signed.tier,
        features: signed.features,
        source: 'env',
        envVar,
      };
    }
    if (!enforced && isLegacyKeyFormat(value)) {
      return { valid: true, source: 'env', envVar };
    }
  }

  // 3. Check ~/.config/thumbgate/license.json for signed Ed25519 tokens.
  const signedConfigPath = getSignedConfigLicensePath(options.homeDir);
  try {
    if (fs.existsSync(signedConfigPath)) {
      const data = JSON.parse(fs.readFileSync(signedConfigPath, 'utf8'));
      const token = data.license || data.token || data.key;
      const signed = verifySignedCandidate(token, options);
      if (signed.valid) {
        return {
          valid: true,
          signed: true,
          tier: signed.tier,
          features: signed.features,
          source: 'file',
          activatedAt: data.activatedAt,
          path: signedConfigPath,
        };
      }
    }
  } catch (_) {}

  // 4. Check ~/.thumbgate/license.json (signed token or, when not enforced, legacy key).
  const licensePath = getLicensePath(options.homeDir);
  try {
    if (fs.existsSync(licensePath)) {
      const data = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
      const candidate = data.key || data.license || data.token;
      const signed = verifySignedCandidate(candidate, options);
      if (signed.valid) {
        return {
          valid: true,
          signed: true,
          tier: signed.tier,
          features: signed.features,
          source: 'file',
          activatedAt: data.activatedAt,
          path: licensePath,
        };
      }
      if (!enforced && isLegacyKeyFormat(data.key)) {
        return {
          valid: true,
          source: 'file',
          activatedAt: data.activatedAt,
          path: licensePath,
        };
      }
    }
  } catch (_) {}

  return {
    valid: false,
    source: null,
    ...(enforced ? { reason: 'signed_entitlement_required' } : {}),
  };
}

function isProLicensed(options) {
  return verifyLicense(options).valid;
}

function activateLicense(key, options = {}) {
  if (!isValidKey(key, options)) {
    const enforced = isEntitlementEnforced(options.env || process.env);
    return {
      success: false,
      error: enforced
        ? 'Invalid license token. Signed Ed25519 entitlement token required when THUMBGATE_ENFORCE_ENTITLEMENTS=1.'
        : 'Invalid key format. Expected signed Ed25519 token, tg_..., or tg_pro_...',
    };
  }

  const licensePath = getLicensePath(options.homeDir);
  const dir = path.dirname(licensePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data = { key, activatedAt: new Date().toISOString(), version: require('../package.json').version };
  fs.writeFileSync(licensePath, JSON.stringify(data, null, 2));
  return { success: true, path: licensePath };
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
