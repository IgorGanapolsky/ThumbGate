'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LICENSE_PATH = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.thumbgate', 'license.json');
const LICENSE_PREFIX = 'tg_pro_';

function verifyLicense() {
  const envKey = process.env.RLHF_API_KEY || process.env.THUMBGATE_PRO_KEY;
  if (envKey && envKey.startsWith(LICENSE_PREFIX)) {
    return { valid: true, source: 'env', key: envKey };
  }
  try {
    if (fs.existsSync(LICENSE_PATH)) {
      const data = JSON.parse(fs.readFileSync(LICENSE_PATH, 'utf8'));
      if (data.key && data.key.startsWith(LICENSE_PREFIX)) {
        return { valid: true, source: 'file', key: data.key, activatedAt: data.activatedAt };
      }
    }
  } catch (_) {}
  return { valid: false, source: null };
}

function isProLicensed() {
  return verifyLicense().valid;
}

function activateLicense(key) {
  if (!key || !key.startsWith(LICENSE_PREFIX)) {
    return { success: false, error: 'Invalid key format. Expected tg_pro_...' };
  }
  const dir = path.dirname(LICENSE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data = { key, activatedAt: new Date().toISOString(), version: require('../package.json').version };
  fs.writeFileSync(LICENSE_PATH, JSON.stringify(data, null, 2));
  return { success: true, path: LICENSE_PATH };
}

function generateLicenseKey(email) {
  const payload = `${email}:${Date.now()}`;
  const hash = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
  return `${LICENSE_PREFIX}${hash}`;
}

module.exports = { verifyLicense, isProLicensed, activateLicense, generateLicenseKey, LICENSE_PATH };
