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

const INSTALL_SOURCE_PATH = path.join(path.dirname(INSTALL_ID_PATH), 'install-source');

/**
 * Where this install came from (for example "udemy"). Set once with THUMBGATE_INSTALL_SOURCE=udemy npx thumbgate init,
 * kept in ~/.thumbgate/install-source so later runs without the variable still report it. The first value wins.
 * Only a short lowercase word is accepted, so the file can never carry anything else. Returns {} when there is none.
 */
function installSourceFields(env = process.env) {
  const clean = (v) => { const t = String(v || '').trim().toLowerCase(); return /^[a-z0-9_-]{2,32}$/.test(t) ? t : ''; };
  let source = '';
  try { source = clean(fs.readFileSync(INSTALL_SOURCE_PATH, 'utf8')); } catch (_) {}
  if (!source) {
    source = clean(env.THUMBGATE_INSTALL_SOURCE);
    if (source) { try { fs.mkdirSync(path.dirname(INSTALL_SOURCE_PATH), { recursive: true }); fs.writeFileSync(INSTALL_SOURCE_PATH, source); } catch (_) {} }
  }
  return source ? { source, utmSource: source } : {};
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

function buildPayload(eventType, metadata = {}) {
  return JSON.stringify({
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
    ...installSourceFields(),
    ...metadata,
  });
}

// Posts a built payload. With awaitDelivery the socket keeps the process alive until the server
// answers or 3s pass; without it the socket is unref'd and a process that exits right away drops
// the ping. Resolves true when the server answered 2xx.
function postPayload(payload, { awaitDelivery = false } = {}) {
  return new Promise((resolve) => {
    try {
      const url = new URL(TELEMETRY_ENDPOINT);
      const req = https.request({
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 3000,
      }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300));
      });
      req.on('error', () => resolve(false)); // silently ignore
      req.on('timeout', () => { req.destroy(); resolve(false); });
      if (!awaitDelivery) req.on('socket', (s) => s.unref()); // fire-and-forget: never block process exit
      req.end(payload);
    } catch (_) { resolve(false); } // never crash the CLI
  });
}

function telemetryOff() {
  return process.env.THUMBGATE_NO_TELEMETRY === '1' || process.env.DO_NOT_TRACK === '1';
}

/**
 * Send anonymous telemetry ping. Fire-and-forget, never blocks CLI.
 * Respects THUMBGATE_NO_TELEMETRY=1 opt-out.
 * Pass { awaitDelivery: true } in a process that is about to exit and can wait (a detached child);
 * it returns a promise that settles within about 3s.
 */
function trackEvent(eventType, metadata = {}, options = {}) {
  if (telemetryOff()) return options.awaitDelivery ? Promise.resolve(false) : undefined;
  let payload;
  try { payload = buildPayload(eventType, metadata); } catch (_) { return options.awaitDelivery ? Promise.resolve(false) : undefined; }
  const sent = postPayload(payload, options);
  return options.awaitDelivery ? sent : undefined;
}

/**
 * Like trackEvent, for a process that exits right after (a PreToolUse hook, a CLI error path):
 * an unref'd socket there never finishes its TLS handshake, so the ping was lost. This hands the
 * payload to a detached child that waits for the answer. The caller never waits. Returns whether
 * a child was started. `spawnFn` is for tests.
 */
function trackEventDetached(eventType, metadata = {}, { spawnFn } = {}) {
  if (telemetryOff()) return false;
  // No stray children from test runs unless a test injects the spawn.
  if (!spawnFn && process.env.NODE_TEST_CONTEXT) return false;
  try {
    const payload = buildPayload(eventType, metadata);
    const child = (spawnFn || require('child_process').spawn)(process.execPath, [__filename, '--deliver'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, THUMBGATE_TELEMETRY_PAYLOAD: payload },
    });
    if (child && typeof child.on === 'function') child.on('error', () => {});
    if (child && typeof child.unref === 'function') child.unref();
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { installSourceFields, INSTALL_SOURCE_PATH, trackEvent, trackEventDetached, getInstallId, classifyInstall, isOwnerAgentSession, INSTALL_ID_PATH, SESSION_ID };

if (require.main === module && process.argv[2] === '--deliver') {
  const payload = process.env.THUMBGATE_TELEMETRY_PAYLOAD || '';
  if (payload && !telemetryOff()) postPayload(payload, { awaitDelivery: true });
}
