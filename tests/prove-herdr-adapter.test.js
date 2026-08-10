'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { verifyHerdrPlugin, MANIFEST_PATH } = require('../scripts/prove-herdr-adapter');

test('prove-herdr-adapter: herdr-plugin.toml exists and passes verification', () => {
  assert.ok(fs.existsSync(MANIFEST_PATH), 'herdr-plugin.toml must exist');
  const res = verifyHerdrPlugin();
  assert.equal(res.ok, true, `plugin verification failed: ${res.error}`);
  assert.equal(res.pluginId, 'thumbgate-approvals');
  assert.equal(res.category, 'Security & Governance');
  assert.equal(res.mcpCommand, 'npx');
  assert.ok(res.mcpArgs.includes('serve'));
});
