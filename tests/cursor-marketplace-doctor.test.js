'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CURSOR_MARKETPLACE_URL,
  classifyListingResponse,
  extractTitle,
  parseArgs,
  renderText,
  runDoctor,
  validateLocalBundle,
} = require('../scripts/cursor-marketplace-doctor');
const packageJson = require('../package.json');

test('extractTitle reads compact HTML titles', () => {
  assert.equal(
    extractTitle('<html><head><title> Marketplace Plugin Not Found | Cursor Plugins </title></head></html>'),
    'Marketplace Plugin Not Found | Cursor Plugins'
  );
});

test('parseArgs supports JSON and skip-network flags', () => {
  assert.deepEqual(parseArgs(['--json', '--skip-network']), {
    json: true,
    skipNetwork: true,
  });
});

test('extractTitle returns an empty string when HTML has no title', () => {
  assert.equal(extractTitle('<main>ThumbGate</main>'), '');
});

test('classifyListingResponse treats Cursor app-shell not-found pages as not live', () => {
  const classified = classifyListingResponse({
    statusCode: 200,
    url: CURSOR_MARKETPLACE_URL,
    body: '<title>Marketplace Plugin Not Found | Cursor Plugins</title><body>ThumbGate</body>',
  });

  assert.equal(classified.live, false);
  assert.equal(classified.reason, 'cursor_marketplace_plugin_not_found');
});

test('classifyListingResponse accepts real listing payloads', () => {
  const classified = classifyListingResponse({
    statusCode: 200,
    url: CURSOR_MARKETPLACE_URL,
    body: '<title>ThumbGate | Cursor Plugins</title><h1>ThumbGate</h1>',
  });

  assert.equal(classified.live, true);
  assert.equal(classified.reason, 'listing_payload_detected');
});

test('validateLocalBundle verifies repo marketplace files', () => {
  const result = validateLocalBundle();

  assert.equal(result.ok, true);
  assert.equal(result.marketplace.pluginSource, 'plugins/cursor-marketplace');
  assert.equal(result.marketplace.version, packageJson.version);
  assert.equal(result.plugin.name, 'thumbgate');
  assert.equal(result.plugin.displayName, 'ThumbGate');
  assert.equal(result.plugin.version, packageJson.version);
  assert.equal(result.packageVersion, packageJson.version);
  assert.equal(result.versionMatchesPackage, true);
  assert.ok(result.requiredFiles.every((file) => file.exists));
});

test('runDoctor reports manual install when public listing is missing', async () => {
  const report = await runDoctor({}, {
    fetchText: async () => ({
      statusCode: 200,
      url: CURSOR_MARKETPLACE_URL,
      body: '<title>Marketplace Plugin Not Found | Cursor Plugins</title><body>ThumbGate</body>',
    }),
  });

  assert.equal(report.ok, false);
  assert.equal(report.publicStatus, 'not_live');
  assert.equal(report.localBundle.ok, true);
  assert.equal(report.manualInstall.command, 'npx thumbgate init --agent cursor');
  assert.match(report.dashboard.status, /private_login_required/);
  assert.ok(report.nextActions.some((action) => /Do not claim public Cursor Marketplace availability/.test(action)));
});

test('runDoctor can skip network and still validate the local bundle', async () => {
  const report = await runDoctor({ skipNetwork: true });

  assert.equal(report.ok, false);
  assert.equal(report.publicStatus, 'not_live');
  assert.equal(report.listing.reason, 'network_skipped');
  assert.equal(report.localBundle.ok, true);
});

test('runDoctor reports live when the public listing payload is present', async () => {
  const report = await runDoctor({}, {
    fetchText: async () => ({
      statusCode: 200,
      url: CURSOR_MARKETPLACE_URL,
      body: '<title>ThumbGate | Cursor Plugins</title><h1>ThumbGate</h1>',
    }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.publicStatus, 'live');
  assert.deepEqual(report.nextActions, ['Update public copy to say Cursor Marketplace listing is live.']);
});

test('runDoctor surfaces network errors without claiming publication', async () => {
  const report = await runDoctor({}, {
    fetchText: async () => {
      throw new Error('connection refused');
    },
  });

  assert.equal(report.ok, false);
  assert.equal(report.publicStatus, 'not_live');
  assert.equal(report.listing.reason, 'network_error');
  assert.equal(report.listing.message, 'connection refused');
});

test('renderText includes local bundle failures when present', () => {
  const text = renderText({
    publicStatus: 'not_live',
    listing: { url: CURSOR_MARKETPLACE_URL, reason: 'network_error' },
    localBundle: {
      ok: false,
      packageVersion: packageJson.version,
      marketplace: { version: '0.0.0' },
      plugin: { version: packageJson.version },
      versionMatchesPackage: false,
      failures: ['marketplace_version_mismatch'],
    },
    manualInstall: { command: 'npx thumbgate init --agent cursor' },
    dashboard: { url: 'https://cursor.com/dashboard/plugins' },
    nextActions: ['Fix local metadata.'],
  });

  assert.match(text, /Local bundle failures:/);
  assert.match(text, /marketplace_version_mismatch/);
});
