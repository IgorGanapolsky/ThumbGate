#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const { execSync, execFileSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const GITHUB_REPO = 'IgorGanapolsky/ThumbGate';

function getLocalVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    return pkg.version;
  } catch (_) {
    return '0.0.0';
  }
}

function httpsGetJson(url) {
  const headers = { 'User-Agent': 'thumbgate-updater' };
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (_) {}
  if (parsedUrl && parsedUrl.hostname === 'api.github.com' && process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }
  return new Promise((resolve, reject) => {
    https.get(url, { headers, timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Request timeout')));
  });
}

function parseVersion(v) {
  return String(v || '').replace(/^v/, '').split('-')[0].split('.').map(Number);
}

function isNewer(current, latest) {
  const cParts = parseVersion(current);
  const lParts = parseVersion(latest);
  for (let i = 0; i < 3; i++) {
    const c = cParts[i] || 0;
    const l = lParts[i] || 0;
    if (l > c) return true;
    if (c > l) return false;
  }
  return false;
}

function isSourceCheckout() {
  return fs.existsSync(path.join(PROJECT_ROOT, '.git'));
}

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const CACHE_DIR = path.join(HOME, '.thumbgate');
const CACHE_FILE = path.join(CACHE_DIR, 'update-cache.json');

async function getLatestReleaseInfo(force = false) {
  if (!force && fs.existsSync(CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
        return cached.data;
      }
    } catch (_) {
      // Ignore cache read errors
    }
  }

  // First attempt: NPM Registry (very reliable, fast, no rate limits)
  let npmVersion = null;
  try {
    const npmMeta = await httpsGetJson('https://registry.npmjs.org/thumbgate/latest');
    npmVersion = npmMeta.version;
  } catch (_) {
    // Ignore and let GitHub releases handle it or fall back
  }

  // Second attempt: GitHub releases for changelog / backup version check
  let githubVersion = null;
  let changelog = null;
  let htmlUrl = null;
  try {
    const ghRelease = await httpsGetJson(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    githubVersion = ghRelease.tag_name ? ghRelease.tag_name.replace(/^v/, '') : null;
    changelog = ghRelease.body || null;
    htmlUrl = ghRelease.html_url || null;
  } catch (_) {
    // Ignore GitHub API errors (e.g. offline, rate-limited)
  }

  const latestVersion = npmVersion || githubVersion;
  const data = {
    latestVersion,
    changelog,
    htmlUrl,
  };

  if (latestVersion) {
    try {
      if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
      }
      fs.writeFileSync(CACHE_FILE, JSON.stringify({
        timestamp: Date.now(),
        data,
      }, null, 2), 'utf8');
    } catch (_) {
      // Ignore cache write errors
    }
  }

  return data;
}

async function checkUpdate(options = {}) {
  const current = getLocalVersion();
  const verbose = options.verbose !== false;
  const force = options.force || false;

  if (verbose) {
    console.log(`Checking for ThumbGate updates... (Current version: v${current})`);
  }

  try {
    const { latestVersion, changelog, htmlUrl } = await getLatestReleaseInfo(force);

    if (!latestVersion) {
      if (verbose) {
        console.log('⚠️  Unable to check for updates. Please check your internet connection.');
      }
      return { updateAvailable: false, current, error: 'Offline or API error' };
    }

    const updateAvailable = isNewer(current, latestVersion);

    if (updateAvailable) {
      if (verbose) {
        console.log('\n┌────────────────────────────────────────────────────────┐');
        console.log(`│  🔔  A new version of ThumbGate is available: v${latestVersion.padEnd(8)} │`);
        console.log(`│      Current version: v${current.padEnd(31)} │`);
        console.log('├────────────────────────────────────────────────────────┤');
        if (changelog) {
          console.log('│  What\'s New:                                           │');
          const lines = changelog
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith('-') || line.startsWith('*'))
            .slice(0, 5);
          for (const line of lines) {
            const truncated = line.length > 50 ? line.slice(0, 47) + '...' : line;
            console.log(`│   ${truncated.padEnd(52)} │`);
          }
          if (lines.length > 0) {
            console.log('├────────────────────────────────────────────────────────┤');
          }
        }
        if (isSourceCheckout()) {
          console.log('│  👉  You are running from a source checkout.           │');
          console.log('│      To update, run: git pull                          │');
        } else {
          console.log('│  👉  To install this update, run:                      │');
          console.log('│      npm install -g thumbgate@latest                   │');
          console.log('│  👉  Or update in-place with:                          │');
          console.log('│      npx thumbgate self-update                         │');
        }
        console.log('└────────────────────────────────────────────────────────┘\n');
      }
      return { updateAvailable: true, current, latest: latestVersion, changelog, htmlUrl };
    } else {
      if (verbose) {
        console.log(`✨ ThumbGate is up to date (v${current}).`);
      }
      return { updateAvailable: false, current, latest: latestVersion };
    }
  } catch (err) {
    if (verbose) {
      console.log(`⚠️  Error checking for updates: ${err.message}`);
    }
    return { updateAvailable: false, current, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Hook runtime version skew

/*
 * Hook runtime version skew.
 *
 * Hooks run from ~/.thumbgate/runtime (a cached install; see published-cli.js and install-shim.js).
 * Once that cache exists it is never upgraded by default, on purpose: hooks must not mutate a
 * pinned or dogfood runtime behind the operator's back. The MCP server, by contrast, is wired as
 * `thumbgate@latest`, so it is usually current. On 2026-11-24, 225 of 261 active installs ran
 * hook builds too old to report a version, so no hook-side fix reached them.
 *
 * This module only detects and reports the gap. It never installs anything; the person updates
 * with `npx thumbgate@latest self-update`, which now refreshes the hook runtime too.
 * See docs/decisions/2026-11-24-revenue-funnel-activation.md (loop 2).
 */


const SKEW_REPORT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STATE_FILE = 'runtime-skew-reported.json';
const UPDATE_COMMAND = 'npx thumbgate@latest self-update';

function runtimeDir(env = process.env) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  return path.join(home, '.thumbgate', 'runtime');
}

function readRuntimeVersion(dir = runtimeDir()) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', 'thumbgate', 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isOlder(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i];
  }
  return false;
}

/** @returns {{ skewed: boolean, runtimeVersion: string|null, currentVersion: string }} */
function detectSkew({ currentVersion, dir } = {}) {
  const runtimeVersion = readRuntimeVersion(dir);
  return { skewed: Boolean(runtimeVersion && isOlder(runtimeVersion, currentVersion)), runtimeVersion, currentVersion };
}

function buildSkewNotice(runtimeVersion, currentVersion) {
  return `ThumbGate's hooks on this machine run v${runtimeVersion}, but v${currentVersion} is installed for the MCP server, `
    + `so fixes since v${runtimeVersion} are not active in the hooks. If the person asks about ThumbGate or its gates, `
    + `tell them once that \`${UPDATE_COMMAND}\` updates the hooks.`;
}

/**
 * Send one `runtime_version_skew` ping per 24h per machine. Never throws, never blocks.
 * `track` defaults to cli-telemetry.trackEvent and is skipped under the node test runner.
 */
function reportSkewOnce({ skew, env = process.env, now = Date.now(), stateDir, track } = {}) {
  try {
    if (!skew || !skew.skewed) return false;
    if (env.THUMBGATE_NO_TELEMETRY === '1' || env.DO_NOT_TRACK === '1') return false;
    const send = track || ((eventType, metadata) => {
      if (env.NODE_TEST_CONTEXT || process.env.NODE_TEST_CONTEXT) return;
      require('./cli-telemetry').trackEvent(eventType, metadata);
    });
    const dir = stateDir || path.join(path.dirname(runtimeDir(env)));
    const file = path.join(dir, STATE_FILE);
    let last = 0;
    try { last = Number(JSON.parse(fs.readFileSync(file, 'utf8')).at) || 0; } catch { /* first time */ }
    if (now - last < SKEW_REPORT_INTERVAL_MS) return false;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ at: now, runtimeVersion: skew.runtimeVersion, currentVersion: skew.currentVersion }));
    send('runtime_version_skew', { runtimeVersion: skew.runtimeVersion, currentVersion: skew.currentVersion });
    return true;
  } catch {
    return false;
  }
}


/**
 * Update the cached hook runtime (~/.thumbgate/runtime) when one exists. Hook commands run that
 * copy first (published-cli.js fast path), so without this a self-update left the hooks on the
 * old version. Runs only when the person asked for an update. Returns the outcome; never throws.
 */
function refreshHookRuntime(options = {}) {
  const dir = options.dir || runtimeDir();
  const before = readRuntimeVersion(dir);
  if (!before) return { refreshed: false, reason: 'no-runtime' };
  const run = options.run || ((cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' }));
  try {
    console.log(`Updating hook runtime in ${dir} (was v${before})`);
    run('npm', ['install', '--prefix', dir, '--no-save', '--omit=dev', '--no-audit', '--no-fund', 'thumbgate@latest']);
    return { refreshed: true, before, after: readRuntimeVersion(dir) };
  } catch (err) {
    console.error(`⚠️  Hook runtime update failed: ${err.message}. Run: npm install --prefix "${dir}" thumbgate@latest`);
    return { refreshed: false, reason: 'install-failed', before };
  }
}

function selfUpdate() {
  const current = getLocalVersion();
  console.log(`Attempting self-update for ThumbGate...`);

  if (isSourceCheckout()) {
    console.log('❌ Cannot run self-update from a source checkout family.');
    console.log('Please run `git pull` manually to update the repository.');
    return false;
  }

  try {
    console.log('Running: npm install -g thumbgate@latest');
    execSync('npm install -g thumbgate@latest', { stdio: 'inherit' });
    // Hooks run from the cached runtime, not the global install, so update it too.
    const runtime = refreshHookRuntime();
    if (runtime.reason === 'install-failed') {
      console.error('❌ Self-update incomplete: hooks still run the old runtime.');
      return false;
    }
    console.log('✨ Self-update complete! Run `thumbgate version` to verify.');
    return true;
  } catch (err) {
    console.error(`❌ Self-update failed: ${err.message}`);
    console.log('Please run: sudo npm install -g thumbgate@latest');
    return false;
  }
}

module.exports = {
  checkUpdate,
  selfUpdate,
  refreshHookRuntime,
  runtimeDir,
  readRuntimeVersion,
  isOlder,
  detectSkew,
  buildSkewNotice,
  reportSkewOnce,
  RUNTIME_SKEW_STATE_FILE: STATE_FILE,
  UPDATE_COMMAND,
  getLocalVersion,
  isNewer,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--self-update') || args.includes('self-update')) {
    selfUpdate();
  } else {
    const force = args.includes('--force');
    checkUpdate({ verbose: true, force });
  }
}
