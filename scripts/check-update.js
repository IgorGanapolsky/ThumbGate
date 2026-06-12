#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

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
