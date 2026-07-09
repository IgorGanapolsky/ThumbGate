'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

const DEFAULT_PRO_API = 'https://thumbgate-production.up.railway.app';
const DEFAULT_PRO_ACTIVATION_ALERT_EMAIL = 'igor.ganapolsky@gmail.com';
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
function isCreatorDev({ env = process.env, homeDir = env.HOME || env.USERPROFILE || os.homedir() } = {}) {
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

/**
 * Developer override: returns true when ~/.config/thumbgate/dev.json exists
 * with any non-empty bypass value. No env var needed — just the config file.
 * Used by the server to skip auth on localhost during local development.
 */
function hasDevOverride(homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir()) {
  // Disabled during test runs to avoid interfering with auth assertions
  if (process.env.NODE_TEST_CONTEXT || process.env.THUMBGATE_TESTING) return false;
  try {
    const configPath = path.join(homeDir, '.config', 'thumbgate', 'dev.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config && typeof config.bypass === 'string' && config.bypass.length > 0;
  } catch { return false; }
}

function getLicenseDir(homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir()) {
  return path.join(homeDir, '.thumbgate');
}

function getLicensePath(homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir()) {
  return path.join(getLicenseDir(homeDir), 'license.json');
}

function isTruthyEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function normalizeText(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fingerprintProKey(key) {
  const normalized = normalizeText(key);
  if (!normalized) return '';
  return `sha256:${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12)}`;
}

function resolveProActivationAlertRecipient(env = process.env) {
  return normalizeText(
    env.THUMBGATE_PRO_ACTIVATION_ALERT_EMAIL ||
    env.THUMBGATE_OPERATOR_ALERT_EMAIL ||
    env.THUMBGATE_SUPPORT_EMAIL ||
    DEFAULT_PRO_ACTIVATION_ALERT_EMAIL
  );
}

function canSendProActivationAlert({ env = process.env, sendEmailImpl } = {}) {
  if (isTruthyEnv(env.THUMBGATE_DISABLE_PRO_ACTIVATION_ALERTS)) return false;
  if (!resolveProActivationAlertRecipient(env)) return false;
  if (sendEmailImpl) return true;
  return Boolean(normalizeText(env.RESEND_API_KEY || env.THUMBGATE_RESEND_API_KEY));
}

function renderProActivationAlertBodies({
  keyFingerprint,
  source,
  version,
  activatedAt,
  hostname,
  platform,
  arch,
  nodeVersion,
  customerId,
  installId,
  usageCount,
} = {}) {
  const occurredAt = activatedAt || new Date().toISOString();
  const runtimePlatform = platform || process.platform;
  const runtimeArch = arch || process.arch;
  const runtimeNode = nodeVersion || process.version;
  const text = [
    'ThumbGate Pro activation detected.',
    '',
    `Activated at: ${occurredAt}`,
    `Key fingerprint: ${keyFingerprint || 'unknown'}`,
    `Source: ${source || 'unknown'}`,
    `Version: ${version || 'unknown'}`,
    `Customer ID: ${customerId || 'unknown'}`,
    `Install ID: ${installId || 'unknown'}`,
    `Usage count: ${usageCount ?? 'unknown'}`,
    `Host: ${hostname || 'unknown'}`,
    `Runtime: ${runtimePlatform}/${runtimeArch} on ${runtimeNode}`,
    '',
    'Secret hygiene: this alert intentionally does not include the raw Pro key.',
  ].join('\n');
  const html = `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#17212b;line-height:1.5;">
    <h1 style="font-size:20px;margin:0 0 12px;">ThumbGate Pro activation detected</h1>
    <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      <tr><td style="padding:4px 14px 4px 0;color:#64748b;">Activated at</td><td style="padding:4px 0;">${escapeHtml(occurredAt)}</td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#64748b;">Key fingerprint</td><td style="padding:4px 0;"><code>${escapeHtml(keyFingerprint || 'unknown')}</code></td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#64748b;">Source</td><td style="padding:4px 0;">${escapeHtml(source || 'unknown')}</td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#64748b;">Version</td><td style="padding:4px 0;">${escapeHtml(version || 'unknown')}</td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#64748b;">Customer ID</td><td style="padding:4px 0;">${escapeHtml(customerId || 'unknown')}</td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#64748b;">Install ID</td><td style="padding:4px 0;">${escapeHtml(installId || 'unknown')}</td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#64748b;">Usage count</td><td style="padding:4px 0;">${escapeHtml(usageCount ?? 'unknown')}</td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#64748b;">Host</td><td style="padding:4px 0;">${escapeHtml(hostname || 'unknown')}</td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#64748b;">Runtime</td><td style="padding:4px 0;">${escapeHtml(runtimePlatform)}/${escapeHtml(runtimeArch)} on ${escapeHtml(runtimeNode)}</td></tr>
    </table>
    <p style="margin-top:16px;color:#64748b;">Secret hygiene: this alert intentionally does not include the raw Pro key.</p>
  </body>
</html>`;
  return { text, html };
}

async function sendProActivationAlert({
  key,
  source = 'unknown',
  version,
  customerId,
  installId,
  usageCount,
  env = process.env,
  sendEmailImpl,
} = {}) {
  const keyFingerprint = fingerprintProKey(key);
  if (!keyFingerprint) return { sent: false, reason: 'missing_key' };
  if (!canSendProActivationAlert({ env, sendEmailImpl })) {
    return { sent: false, reason: 'activation_alert_disabled_or_unconfigured' };
  }

  const to = resolveProActivationAlertRecipient(env);
  const { html, text } = renderProActivationAlertBodies({
    keyFingerprint,
    source,
    version,
    customerId,
    installId,
    usageCount,
    activatedAt: new Date().toISOString(),
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
  });
  const sender = sendEmailImpl || require('./mailer').sendEmail;

  try {
    return await sender({
      to,
      subject: 'ThumbGate Pro activated',
      html,
      text,
    });
  } catch (error) {
    return {
      sent: false,
      reason: 'exception',
      error: error && error.message ? error.message : String(error),
    };
  }
}

async function notifyHostedProActivation({
  key,
  source = 'cli_pro_activate',
  version,
  apiBaseUrl = process.env.THUMBGATE_API_BASE_URL || DEFAULT_PRO_API,
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedKey = normalizeText(key);
  if (!normalizedKey) return { notified: false, reason: 'missing_key' };
  if (typeof fetchImpl !== 'function') return { notified: false, reason: 'no_fetch' };

  const keyFingerprint = fingerprintProKey(normalizedKey);
  const endpoint = new URL('/v1/billing/pro-activation', apiBaseUrl).toString();
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${normalizedKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        keyFingerprint,
        source,
        version: version || null,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        notified: false,
        reason: body && body.detail ? body.detail : `http_${response.status}`,
        status: response.status,
      };
    }
    return {
      notified: true,
      status: response.status,
      alert: body.alert || null,
      keyFingerprint: body.keyFingerprint || keyFingerprint,
    };
  } catch (error) {
    return {
      notified: false,
      reason: 'exception',
      error: error && error.message ? error.message : String(error),
    };
  }
}

function readLicense({ homeDir } = {}) {
  try {
    return JSON.parse(fs.readFileSync(getLicensePath(homeDir), 'utf8'));
  } catch {
    return null;
  }
}

function saveLicense(key, { homeDir, version } = {}) {
  const licenseDir = getLicenseDir(homeDir);
  const licensePath = getLicensePath(homeDir);
  fs.mkdirSync(licenseDir, { recursive: true });
  fs.writeFileSync(
    licensePath,
    JSON.stringify({
      key: String(key || '').trim(),
      savedAt: new Date().toISOString(),
      version: version || null,
    }, null, 2) + '\n'
  );
  return licensePath;
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

  const envKey = String(env.THUMBGATE_API_KEY || '').trim();
  if (envKey) {
    return {
      key: envKey,
      source: 'env',
    };
  }

  const license = readLicense({ homeDir });
  const licenseKey = String(license && license.key ? license.key : '').trim();
  if (licenseKey) {
    return {
      key: licenseKey,
      source: 'license',
      licensePath: getLicensePath(homeDir),
    };
  }

  return null;
}

async function validateProKey(key, { apiBaseUrl = DEFAULT_PRO_API, fetchImpl = globalThis.fetch } = {}) {
  if (!key || typeof fetchImpl !== 'function') {
    return false;
  }

  try {
    const res = await fetchImpl(`${apiBaseUrl}/v1/billing/usage`, {
      headers: {
        'Authorization': `Bearer ${String(key).trim()}`,
      },
    });
    if (!res.ok) {
      return false;
    }
    const data = await res.json().catch(() => ({}));
    return Boolean(data && data.key);
  } catch {
    return false;
  }
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

  env.THUMBGATE_PRO_MODE = '1';
  env.THUMBGATE_API_KEY = normalizedKey;

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
  DEFAULT_PRO_ACTIVATION_ALERT_EMAIL,
  canSendProActivationAlert,
  fingerprintProKey,
  getLicenseDir,
  getLicensePath,
  hasDevOverride,
  isCreatorDev,
  readLicense,
  renderProActivationAlertBodies,
  notifyHostedProActivation,
  resolveProActivationAlertRecipient,
  saveLicense,
  sendProActivationAlert,
  resolveProKey,
  validateProKey,
  startLocalProDashboard,
};
