const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

test('sync-version --check reports no drift on main', () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  assert.ok(result.version, 'version should be defined');
  assert.ok(result.targets.length > 10, `expected >10 sync targets, got ${result.targets.length}`);
  assert.deepEqual(result.drifted, [], `expected no drift, found: ${JSON.stringify(result.drifted)}`);
  assert.equal(result.allInSync, true);
});

test('sync-version covers mcpize.yaml', () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  assert.ok(result.targets.includes('mcpize.yaml'), 'mcpize.yaml should be a sync target');
});

test('sync-version covers package-lock.json', () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  const hasPackageLock = result.targets.some(t => t.includes('package-lock.json'));
  assert.ok(hasPackageLock, 'package-lock.json should be a sync target');
});

test('sync-version covers the Claude adapter launcher manifest', () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  assert.ok(
    result.targets.includes('adapters/claude/.mcp.json'),
    'adapters/claude/.mcp.json should be a sync target'
  );
});

test('sync-version covers the MCP stdio server metadata file', () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  assert.ok(
    result.targets.includes('adapters/mcp/server-stdio.js'),
    'adapters/mcp/server-stdio.js should be a sync target'
  );
});

test('sync-version no longer tracks an embedded pro package manifest', () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  assert.equal(result.targets.includes('pro/package.json'), false);
});

test('sync-version covers codex plugin manifests', () => {
  const { syncVersion } = require('../scripts/sync-version');
  const result = syncVersion({ checkOnly: true });
  assert.ok(
    result.targets.includes('plugins/codex-profile/.codex-plugin/plugin.json'),
    'plugins/codex-profile/.codex-plugin/plugin.json should be a sync target'
  );
  assert.ok(
    result.targets.includes('plugins/codex-profile/.mcp.json'),
    'plugins/codex-profile/.mcp.json should be a sync target'
  );
  assert.ok(
    result.targets.includes('plugins/claude-codex-bridge/.claude-plugin/plugin.json'),
    'plugins/claude-codex-bridge/.claude-plugin/plugin.json should be a sync target'
  );
  assert.ok(
    result.targets.includes('plugins/claude-codex-bridge/.mcp.json'),
    'plugins/claude-codex-bridge/.mcp.json should be a sync target'
  );
});

test('sync-version detects landing page hero badge drift without relying on trailing punctuation', () => {
  const { syncVersion } = require('../scripts/sync-version');
  const landingPath = path.join(ROOT, 'public', 'index.html');
  const original = fs.readFileSync(landingPath, 'utf8');

  try {
    fs.writeFileSync(landingPath, original.replace(/New in v\d+\.\d+\.\d+:?/, 'New in v0.0.1'));
    const result = syncVersion({ checkOnly: true });
    assert.ok(
      result.drifted.some((entry) => entry.file === 'public/index.html' && entry.field === 'hero-release-note'),
      `expected hero badge drift, found: ${JSON.stringify(result.drifted)}`
    );
  } finally {
    fs.writeFileSync(landingPath, original);
  }
});

test('sync-version detects public landing footer drift', () => {
  const { syncVersion } = require('../scripts/sync-version');
  const publicIndexPath = path.join(ROOT, 'public', 'index.html');
  const original = fs.readFileSync(publicIndexPath, 'utf8');

  try {
    fs.writeFileSync(
      publicIndexPath,
      original.replace(/MIT License · v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/, 'MIT License · v0.0.1')
    );
    const result = syncVersion({ checkOnly: true });
    assert.ok(
      result.drifted.some((entry) => entry.file === 'public/index.html' && entry.field === 'footer-version'),
      `expected footer drift, found: ${JSON.stringify(result.drifted)}`
    );
  } finally {
    fs.writeFileSync(publicIndexPath, original);
  }
});
