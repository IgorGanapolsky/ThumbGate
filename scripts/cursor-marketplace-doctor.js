#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CURSOR_MARKETPLACE_URL = 'https://cursor.com/marketplace/thumbgate';
const CURSOR_DASHBOARD_URL = 'https://cursor.com/dashboard/plugins';

function parseArgs(argv = []) {
  return {
    json: argv.includes('--json'),
    skipNetwork: argv.includes('--skip-network'),
  };
}

function readJson(relativePath) {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function fileState(relativePath) {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  return {
    path: absolutePath,
    exists: fs.existsSync(absolutePath),
  };
}

function fetchText(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': 'thumbgate-cursor-marketplace-doctor/1.0',
      },
      timeout: timeoutMs,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({
          body,
          statusCode: response.statusCode || 0,
          url,
        });
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error(`Timed out fetching ${url}`));
    });
    request.on('error', reject);
  });
}

function extractTitle(html = '') {
  const match = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

function classifyListingResponse(response = {}) {
  const body = String(response.body || '');
  const title = extractTitle(body);
  const hasNotFound = /plugin not found|notFound/i.test(`${title}\n${body}`);
  const hasThumbGate = /ThumbGate|thumbgate/.test(body);
  return {
    statusCode: response.statusCode || 0,
    title,
    hasThumbGate,
    live: Boolean(response.statusCode && response.statusCode < 400 && hasThumbGate && !hasNotFound),
    reason: hasNotFound ? 'cursor_marketplace_plugin_not_found' : 'listing_payload_detected',
    url: response.url || CURSOR_MARKETPLACE_URL,
  };
}

function validateLocalBundle() {
  const packageJson = readJson('package.json');
  const packageVersion = packageJson.version;
  const marketplace = readJson('.cursor-plugin/marketplace.json');
  const entry = Array.isArray(marketplace.plugins)
    ? marketplace.plugins.find((plugin) => plugin.name === 'thumbgate')
    : null;
  const pluginSource = entry?.source || 'plugins/cursor-marketplace';
  const pluginManifestPath = path.join(pluginSource, '.cursor-plugin', 'plugin.json');
  const plugin = readJson(pluginManifestPath);
  const requiredFiles = [
    '.cursor-plugin/marketplace.json',
    pluginManifestPath,
    path.join(pluginSource, 'README.md'),
    path.join(pluginSource, 'CHANGELOG.md'),
    path.join(pluginSource, 'LICENSE'),
    path.join(pluginSource, 'mcp.json'),
    path.join(pluginSource, plugin.logo || ''),
  ].filter(Boolean).map(fileState);

  const failures = [];
  if (!entry) failures.push('missing_thumbgate_marketplace_entry');
  if (entry && entry.source !== pluginSource) failures.push('plugin_source_mismatch');
  if (plugin.name !== 'thumbgate') failures.push('plugin_name_not_thumbgate');
  if (plugin.displayName !== 'ThumbGate') failures.push('plugin_display_name_not_thumbgate');
  if (!plugin.logo) failures.push('missing_logo_field');
  if (marketplace.metadata?.version !== packageVersion) {
    failures.push(`marketplace_version_mismatch:${marketplace.metadata?.version || 'missing'}!=${packageVersion}`);
  }
  if (plugin.version !== packageVersion) {
    failures.push(`plugin_version_mismatch:${plugin.version || 'missing'}!=${packageVersion}`);
  }
  for (const file of requiredFiles) {
    if (!file.exists) failures.push(`missing_file:${file.path}`);
  }

  return {
    ok: failures.length === 0,
    failures,
    marketplace: {
      name: marketplace.name,
      pluginSource,
      version: marketplace.metadata?.version || null,
    },
    plugin: {
      name: plugin.name,
      displayName: plugin.displayName,
      version: plugin.version,
      logo: plugin.logo,
    },
    packageVersion,
    versionMatchesPackage: marketplace.metadata?.version === packageVersion && plugin.version === packageVersion,
    requiredFiles,
  };
}

async function runDoctor(options = {}, deps = {}) {
  const localBundle = validateLocalBundle();
  let listing = {
    live: false,
    reason: 'network_skipped',
    url: CURSOR_MARKETPLACE_URL,
  };

  if (!options.skipNetwork) {
    try {
      const response = deps.fetchText
        ? await deps.fetchText(CURSOR_MARKETPLACE_URL)
        : await fetchText(CURSOR_MARKETPLACE_URL);
      listing = classifyListingResponse(response);
    } catch (error) {
      listing = {
        live: false,
        reason: 'network_error',
        message: error && error.message ? error.message : String(error),
        url: CURSOR_MARKETPLACE_URL,
      };
    }
  }

  const publicStatus = listing.live ? 'live' : 'not_live';
  return {
    ok: localBundle.ok && listing.live,
    publicStatus,
    localBundle,
    listing,
    dashboard: {
      url: CURSOR_DASHBOARD_URL,
      status: 'private_login_required_for_submission_state',
      note: 'Only the logged-in Cursor dashboard can prove draft, pending, rejected, or approved state.',
    },
    manualInstall: {
      supported: true,
      command: 'npx thumbgate init --agent cursor',
    },
    nextActions: listing.live ? [
      'Update public copy to say Cursor Marketplace listing is live.',
    ] : [
      'Sign in to Cursor dashboard and open Plugins.',
      'If ThumbGate is absent, import or resubmit this repository marketplace.',
      'If ThumbGate is rejected or draft, fix the dashboard-listed issue and resubmit.',
      'Do not claim public Cursor Marketplace availability until the listing page is live.',
    ],
  };
}

function renderText(report) {
  const lines = [
    'Cursor Marketplace Doctor',
    `publicStatus: ${report.publicStatus}`,
    `listingUrl: ${report.listing.url}`,
    `listingTitle: ${report.listing.title || 'n/a'}`,
    `listingReason: ${report.listing.reason}`,
    `localBundleOk: ${report.localBundle.ok}`,
    `packageVersion: ${report.localBundle.packageVersion}`,
    `marketplaceVersion: ${report.localBundle.marketplace.version || 'n/a'}`,
    `pluginVersion: ${report.localBundle.plugin.version || 'n/a'}`,
    `versionMatchesPackage: ${report.localBundle.versionMatchesPackage}`,
    `manualInstall: ${report.manualInstall.command}`,
    `dashboard: ${report.dashboard.url}`,
    '',
    'Next actions:',
    ...report.nextActions.map((action) => `- ${action}`),
  ];
  if (report.localBundle.failures.length > 0) {
    lines.push('', 'Local bundle failures:');
    lines.push(...report.localBundle.failures.map((failure) => `- ${failure}`));
  }
  return `${lines.join('\n')}\n`;
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  runDoctor(options)
    .then((report) => {
      process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderText(report));
      process.exitCode = report.publicStatus === 'live' ? 0 : 2;
    })
    .catch((error) => {
      console.error(error && error.stack ? error.stack : error);
      process.exit(1);
    });
}

module.exports = {
  CURSOR_DASHBOARD_URL,
  CURSOR_MARKETPLACE_URL,
  classifyListingResponse,
  extractTitle,
  parseArgs,
  renderText,
  runDoctor,
  validateLocalBundle,
};
