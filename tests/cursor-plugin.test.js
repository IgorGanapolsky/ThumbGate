const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf-8'));
}

test('cursor marketplace manifest points at a valid plugin directory', () => {
  const packageJson = readJson('package.json');
  const marketplace = readJson('.cursor-plugin/marketplace.json');
  const pluginManifest = readJson('plugins/cursor-marketplace/.cursor-plugin/plugin.json');
  const pluginEntry = marketplace.plugins.find((plugin) => plugin.name === 'mcp-memory-gateway');
  const canonicalDescription = 'Pre-action gates that block AI agents from repeating known mistakes. Captures feedback, auto-generates prevention rules, and enforces them via PreToolUse hooks.';

  assert.equal(marketplace.name, 'mcp-memory-gateway-marketplace');
  assert.equal(marketplace.owner.name, 'Igor Ganapolsky');
  assert.equal(marketplace.metadata.version, packageJson.version);
  assert.match(marketplace.metadata.description, /Pre-Action Gates|repeating.*mistakes/i);
  assert.ok(pluginEntry, 'marketplace entry for mcp-memory-gateway should exist');
  assert.equal(pluginEntry.name, pluginManifest.name, 'marketplace entry should match plugin manifest name');
  assert.equal(pluginEntry.source, 'plugins/cursor-marketplace');
  assert.equal(pluginEntry.description, canonicalDescription);
  assert.equal(path.isAbsolute(pluginEntry.source), false, 'plugin source must be repo-relative');
  assert.equal(pluginEntry.source.includes('..'), false, 'plugin source must not use path traversal');
  assert.equal(fs.existsSync(path.join(root, pluginEntry.source, '.cursor-plugin', 'plugin.json')), true);
});

test('cursor plugin manifest uses marketplace-safe metadata and committed assets', () => {
  const pluginManifest = readJson('plugins/cursor-marketplace/.cursor-plugin/plugin.json');
  const readmePath = path.join(root, 'plugins/cursor-marketplace/README.md');
  const logoPath = path.join(root, 'plugins/cursor-marketplace', pluginManifest.logo);
  const canonicalDescription = 'Pre-action gates that block AI agents from repeating known mistakes. Captures feedback, auto-generates prevention rules, and enforces them via PreToolUse hooks.';

  assert.match(pluginManifest.name, /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
  assert.equal(pluginManifest.name, 'mcp-memory-gateway');
  assert.equal(pluginManifest.displayName, 'MCP Memory Gateway');
  assert.equal(pluginManifest.description, canonicalDescription);
  assert.equal(path.isAbsolute(pluginManifest.logo), false, 'logo must be repo-relative');
  assert.equal(pluginManifest.logo.includes('..'), false, 'logo path must not use path traversal');
  assert.equal(fs.existsSync(readmePath), true, 'plugin README should exist');
  assert.equal(fs.existsSync(logoPath), true, 'plugin logo should exist');
});

test('cursor plugin MCP config uses the latest npm tag instead of local absolute paths', () => {
  const pluginConfig = readJson('plugins/cursor-marketplace/.mcp.json');
  const server = pluginConfig.mcpServers.rlhf;

  assert.equal(server.command, 'npx');
  assert.deepEqual(server.args, ['-y', 'mcp-memory-gateway@latest', 'serve']);
  assert.equal(JSON.stringify(server).includes('/Users/'), false, 'plugin config must not hardcode local paths');
});

test('cursor plugin docs explain runtime updates versus listing updates', () => {
  const readme = fs.readFileSync(path.join(root, 'plugins/cursor-marketplace/README.md'), 'utf-8');
  const opsDocPath = path.join(root, 'docs/CURSOR_PLUGIN_OPERATIONS.md');
  const opsDoc = fs.readFileSync(opsDocPath, 'utf-8');
  const canonicalDescription = 'Pre-action gates that block AI agents from repeating known mistakes. Captures feedback, auto-generates prevention rules, and enforces them via PreToolUse hooks.';

  assert.match(readme, /Cursor Directory/i);
  assert.match(readme, /does not refresh|does not auto-refresh/i);
  assert.match(readme, /MCP Memory Gateway/);
  assert.match(readme, /mcp-memory-gateway/);
  assert.match(readme, new RegExp(canonicalDescription.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(readme, /mcp-memory-gateway@latest/);
  assert.equal(fs.existsSync(opsDocPath), true, 'Cursor plugin operations doc should exist');
  assert.match(opsDoc, /Cursor Marketplace/i);
  assert.match(opsDoc, /Cursor Directory/i);
  assert.match(opsDoc, /Display name: `MCP Memory Gateway`/);
  assert.match(opsDoc, /Plugin slug: `mcp-memory-gateway`/);
  assert.match(opsDoc, /npm publish/i);
  assert.match(opsDoc, /VERIFICATION_EVIDENCE\.md/);
  assert.match(opsDoc, new RegExp(canonicalDescription.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
