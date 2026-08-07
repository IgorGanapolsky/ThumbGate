'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { verifyHerdrPlugin, parseSimpleToml, MANIFEST_PATH } = require('../scripts/prove-herdr-adapter');

test('prove-herdr-adapter: herdr-plugin.toml exists and passes verification', () => {
  assert.ok(fs.existsSync(MANIFEST_PATH), 'herdr-plugin.toml must exist');
  const res = verifyHerdrPlugin();
  assert.equal(res.ok, true, `plugin verification failed: ${res.error}`);
  assert.equal(res.pluginId, 'thumbgate-approvals');
  assert.equal(res.category, 'Security & Governance');
  assert.equal(res.mcpCommand, 'npx');
  assert.ok(res.mcpArgs.includes('serve'));
});

test('parseSimpleToml: correctly parses sections, key-values, and arrays', () => {
  const sample = `
[plugin]
id = "test-plugin"
version = "1.0.0"
platforms = ["linux", "macos"]

[mcp_server]
command = "node"
`;
  const parsed = parseSimpleToml(sample);
  assert.equal(parsed.plugin.id, 'test-plugin');
  assert.equal(parsed.plugin.version, '1.0.0');
  assert.deepEqual(parsed.plugin.platforms, ['linux', 'macos']);
  assert.equal(parsed.mcp_server.command, 'node');
});
