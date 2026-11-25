'use strict';
const https = require('https');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const _DEFAULT_TELEMETRY_HOST = 'https://thumbgate-production.up.railway.app';
// Respect THUMBGATE_API_URL so test environments can point to a local stub
const TELEMETRY_ENDPOINT = `${process.env.THUMBGATE_API_URL || _DEFAULT_TELEMETRY_HOST}/v1/telemetry/ping`;
const INSTALL_ID_PATH = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.thumbgate', 'install-id');

// Session ID: random per process invocation. Groups all events from one CLI run.
const SESSION_ID = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');

/**
 * Get or create a stable anonymous install ID.
 * This is NOT tied to any personal info — it's a random UUID stored locally.
 */
function getInstallId() {
  try {
    if (fs.existsSync(INSTALL_ID_PATH)) {
      return fs.readFileSync(INSTALL_ID_PATH, 'utf8').trim();
    }
  } catch (_) {}

  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  try {
    const dir = path.dirname(INSTALL_ID_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(INSTALL_ID_PATH, id);
  } catch (_) {}
  return id;
}

/**
 * Classify this install: is it Igor, CI, or a real user?
 */
function classifyInstall() {
  const env = process.env;

  // CI detection
  if (env.CI || env.GITHUB_ACTIONS || env.TRAVIS || env.CIRCLECI || env.JENKINS_URL || env.GITLAB_CI || env.CODEBUILD_BUILD_ID) {
    return 'ci';
  }

  // Igor detection (by known machine identifiers)
  const hostname = os.hostname().toLowerCase();
  const user = (env.USER || env.USERNAME || '').toLowerCase();
  if (user.includes('igor') || user.includes('igorganapolsky') || hostname.includes('igors')) {
    return 'owner';
  }

  // The owner's coding agents run in fresh cloud containers (user root, random hostname), each with a new install id.
  // Without this they were counted as real users.
  if (isOwnerAgentSession()) return 'owner';

  return 'real_user';
}

// SHA-256 of the owner's Claude account address. Claude Code sets CLAUDE_CODE_USER_EMAIL in every session it runs, so
// this matches the owner's own agent sessions on any machine and in any folder, and never a user who only cloned the
// public repo. The address is hashed locally and compared; nothing new is sent. More hashes can be added with
// THUMBGATE_OWNER_ACCOUNT_HASHES (comma separated).
const OWNER_ACCOUNT_HASHES = ['fb84659fe07a0a2b2e86dc8e4c04137f5b6dec460946a020c713ff7d4753ba7c'];

function isOwnerAgentSession(env = process.env) {
  const account = String(env.CLAUDE_CODE_USER_EMAIL || '').trim().toLowerCase();
  if (!account) return false;
  const hash = crypto.createHash('sha256').update(account).digest('hex');
  const extra = String(env.THUMBGATE_OWNER_ACCOUNT_HASHES || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  return OWNER_ACCOUNT_HASHES.includes(hash) || extra.includes(hash);
}

/**
 * Send anonymous telemetry ping. Fire-and-forget, never blocks CLI.
 * Respects THUMBGATE_NO_TELEMETRY=1 opt-out.
 */
function trackEvent(eventType, metadata = {}) {
  if (process.env.THUMBGATE_NO_TELEMETRY === '1' || process.env.DO_NOT_TRACK === '1') return;

  const payload = JSON.stringify({
    eventType,
    installId: getInstallId(),
    sessionId: SESSION_ID,
    visitorType: classifyInstall(),
    clientType: 'cli',
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    pkgVersion: (() => { try { return require('../package.json').version; } catch(_) { return 'unknown'; } })(),
    timestamp: new Date().toISOString(),
    ...metadata,
  });

  try {
    const url = new URL(TELEMETRY_ENDPOINT);
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 3000,
    });
    req.on('error', () => {}); // silently ignore
    req.on('timeout', () => req.destroy());
    req.on('socket', (s) => s.unref()); // fire-and-forget: never block process exit
    req.end(payload);
  } catch (_) {} // never crash the CLI
}

module.exports = { trackEvent, getInstallId, classifyInstall, isOwnerAgentSession, INSTALL_ID_PATH, SESSION_ID };
