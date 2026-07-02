'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VALID_PREFIXES = ['tg_pro_', 'tg_'];
const LEGACY_COMPATIBLE_KEY = /^[a-z]{4,16}_[a-f0-9]{24,}$/i;

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
