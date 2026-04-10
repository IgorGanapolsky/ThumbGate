const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  BUNDLE_ROOT_NAME,
  stageCodexPluginBundle,
} = require('../scripts/build-codex-plugin');
const {
  getCodexPluginLatestDownloadUrl,
  getCodexPluginVersionedAssetName,
} = require('../scripts/distribution-surfaces');

const root = path.join(__dirname, '..');
const packageJson = require('../package.json');

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
  const install = fs.readFileSync(path.join(root, 'plugins/codex-profile/INSTALL.md'), 'utf-8');

  assert.equal(plugin.name, 'codex-profile');
  assert.equal(plugin.interface.displayName, 'ThumbGate for Codex');
  assert.equal(plugin.homepage, 'https://thumbgate-production.up.railway.app');
  assert.equal(plugin.repository, 'https://github.com/IgorGanapolsky/ThumbGate');
  assert.equal(plugin.mcpServers, './.mcp.json');
  assert.deepEqual(mcpConfig.mcpServers.thumbgate.args, ['--yes', '--package', `thumbgate@${packageJson.version}`, 'thumbgate', 'serve']);
  assert.match(readme, /standalone Codex plugin bundle/i);
  assert.match(readme, new RegExp(getCodexPluginLatestDownloadUrl(root).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(readme, /build:codex-plugin/i);
  assert.match(readme, /Pre-Action Gates/i);
  assert.match(install, /thumbgate-codex-plugin\.zip/i);
  assert.match(install, /build:codex-plugin/i);
  assert.match(install, /marketplace catalog points at `\.\/`/i);
});

test('codex plugin staging writes a standalone bundle with self-contained marketplace metadata', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-plugin-stage-'));

  try {
    const { stageDir, outputFile } = stageCodexPluginBundle(outputDir);
    const pluginPath = path.join(stageDir, '.codex-plugin', 'plugin.json');
    const mcpConfigPath = path.join(stageDir, '.mcp.json');
    const marketplacePath = path.join(stageDir, '.agents', 'plugins', 'marketplace.json');
    const configTomlPath = path.join(stageDir, 'config.toml');
    const readmePath = path.join(stageDir, 'README.md');
    const installPath = path.join(stageDir, 'INSTALL.md');
    const agentsPath = path.join(stageDir, 'AGENTS.md');
    const licensePath = path.join(stageDir, 'LICENSE');

    assert.equal(path.basename(stageDir), BUNDLE_ROOT_NAME);
    assert.equal(fs.existsSync(pluginPath), true);
    assert.equal(fs.existsSync(mcpConfigPath), true);
    assert.equal(fs.existsSync(marketplacePath), true);
    assert.equal(fs.existsSync(configTomlPath), true);
    assert.equal(fs.existsSync(readmePath), true);
    assert.equal(fs.existsSync(installPath), true);
    assert.equal(fs.existsSync(agentsPath), true);
    assert.equal(fs.existsSync(licensePath), true);
    assert.equal(fs.existsSync(outputFile), false);
    assert.equal(path.basename(outputFile), getCodexPluginVersionedAssetName(packageJson.version));

    const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
    const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
    const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
    const readme = fs.readFileSync(readmePath, 'utf8');
    const install = fs.readFileSync(installPath, 'utf8');
    const configToml = fs.readFileSync(configTomlPath, 'utf8');

    assert.equal(plugin.version, packageJson.version);
    assert.deepEqual(mcpConfig.mcpServers.thumbgate.args, ['--yes', '--package', `thumbgate@${packageJson.version}`, 'thumbgate', 'serve']);
    assert.equal(marketplace.plugins[0].source.path, './');
    assert.match(readme, /thumbgate-codex-plugin\.zip/i);
    assert.match(readme, /build:codex-plugin/i);
    assert.match(readme, /self-contained plugin root/i);
    assert.match(install, /standalone release bundle/i);
    assert.match(configToml, new RegExp(`thumbgate@${packageJson.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
