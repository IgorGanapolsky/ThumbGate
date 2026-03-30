const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf-8'));
}

test('codex plugin marketplace points at the shipped codex profile', () => {
  const marketplace = readJson('.agents/plugins/marketplace.json');
  const plugin = readJson('plugins/codex-profile/.codex-plugin/plugin.json');
  const entry = marketplace.plugins.find((item) => item.name === plugin.name);

  assert.equal(marketplace.name, 'thumbgate-plugin-catalog');
  assert.equal(marketplace.interface.displayName, 'ThumbGate Plugin Catalog');
  assert.ok(entry, 'marketplace entry for codex-profile should exist');
  assert.equal(entry.source.source, 'local');
  assert.equal(entry.source.path, './plugins/codex-profile');
  assert.equal(entry.policy.installation, 'AVAILABLE');
  assert.equal(entry.policy.authentication, 'ON_INSTALL');
});

test('codex plugin manifest uses ThumbGate branding and local MCP config', () => {
  const plugin = readJson('plugins/codex-profile/.codex-plugin/plugin.json');
  const mcpConfig = readJson('plugins/codex-profile/.mcp.json');
  const readme = fs.readFileSync(path.join(root, 'plugins/codex-profile/README.md'), 'utf-8');

  assert.equal(plugin.name, 'codex-profile');
  assert.equal(plugin.interface.displayName, 'ThumbGate for Codex');
  assert.equal(plugin.homepage, 'https://rlhf-feedback-loop-production.up.railway.app');
  assert.equal(plugin.repository, 'https://github.com/IgorGanapolsky/ThumbGate');
  assert.equal(plugin.mcpServers, './.mcp.json');
  assert.deepEqual(mcpConfig.mcpServers.rlhf.args, ['-y', 'mcp-memory-gateway@0.8.4', 'serve']);
  assert.match(readme, /Codex app plugin surface/i);
  assert.match(readme, /Pre-Action Gates/i);
});
