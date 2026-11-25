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

  // The owner's coding agents run in fresh cloud containers (user root, random hostname), each with a new install id,
  // inside the owner's own repositories. Without this they were counted as real users.
  if (insideOwnerRepo()) return 'owner';

  return 'real_user';
}

const OWNER_REMOTE = /github\.com[/:](igorganapolsky|igor-ganapolsky)\//i;

// True when the working directory (or a parent, up to 8 levels) is a git checkout whose remote belongs to the owner.
// Reads only the local .git/config; nothing from it is sent anywhere.
function insideOwnerRepo(start = process.env.CLAUDE_PROJECT_DIR || process.cwd()) {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i += 1) {
    try {
      const gitPath = path.join(dir, '.git');
      const stat = fs.statSync(gitPath);
      let configPath = path.join(gitPath, 'config');
      if (stat.isFile()) {
        // A worktree: .git is a file pointing at the real git dir.
        const pointer = /gitdir:\s*(.+)/.exec(fs.readFileSync(gitPath, 'utf8'));
        if (!pointer) return false;
        const gitDir = path.resolve(dir, pointer[1].trim());
        const common = path.join(gitDir, 'commondir');
        configPath = fs.existsSync(common) ? path.join(path.resolve(gitDir, fs.readFileSync(common, 'utf8').trim()), 'config') : path.join(gitDir, 'config');
      }
      return OWNER_REMOTE.test(fs.readFileSync(configPath, 'utf8'));
    } catch (_) { /* no .git here */ }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
  return false;
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

module.exports = { trackEvent, getInstallId, classifyInstall, insideOwnerRepo, INSTALL_ID_PATH, SESSION_ID };
