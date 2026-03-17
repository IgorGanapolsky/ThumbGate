const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).version;

test('adapter files exist', () => {
  const files = [
    'adapters/chatgpt/openapi.yaml',
    'adapters/gemini/function-declarations.json',
    'adapters/claude/.mcp.json',
    'adapters/codex/config.toml',
    'adapters/amp/skills/rlhf-feedback/SKILL.md',
    '.cursor-plugin/marketplace.json',
    'plugins/cursor-marketplace/.cursor-plugin/plugin.json',
    'plugins/cursor-marketplace/.mcp.json',
    'plugins/cursor-marketplace/README.md',
  ];

  for (const file of files) {
    const filePath = path.join(root, file);
    assert.equal(fs.existsSync(filePath), true, `${file} should exist`);
  }
});

test('gemini tool declarations are valid JSON with tools array', () => {
  const filePath = path.join(root, 'adapters/gemini/function-declarations.json');
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert.equal(Array.isArray(payload.tools), true);
  assert.ok(payload.tools.length >= 3);
  assert.ok(payload.tools.some((tool) => tool.name === 'plan_intent'));
});

test('claude .mcp.json is valid JSON with mcpServers key', () => {
  const filePath = path.join(root, 'adapters/claude/.mcp.json');
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert.ok(payload.mcpServers, '.mcp.json must have mcpServers key');
  assert.equal(typeof payload.mcpServers, 'object');
  
  const rlhf = payload.mcpServers.rlhf;
  if (rlhf.command === 'npx') {
    assert.deepEqual(rlhf.args, ['-y', `mcp-memory-gateway@${packageVersion}`, 'serve']);
  } else {
    assert.equal(rlhf.command, 'node');
    assert.ok(rlhf.args.includes('serve'));
  }
});

test('codex config.toml contains mcp_servers section', () => {
  const filePath = path.join(root, 'adapters/codex/config.toml');
  const content = fs.readFileSync(filePath, 'utf-8');
  assert.match(content, /\[mcp_servers\.rlhf\]/, 'config.toml must contain canonical rlhf section');
  
  if (content.includes('command = "npx"')) {
    assert.match(
      content,
      new RegExp(`args = \\["-y", "mcp-memory-gateway@${packageVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}", "serve"\\]`),
      'config.toml must launch the version-pinned package serve entrypoint'
    );
  } else {
    assert.match(content, /command = "node"/);
    assert.match(content, /"serve"/);
  }
});

test('amp SKILL.md contains capture-feedback reference', () => {
  const filePath = path.join(root, 'adapters/amp/skills/rlhf-feedback/SKILL.md');
  const content = fs.readFileSync(filePath, 'utf-8');
  assert.match(content, /capture-feedback/, 'SKILL.md must reference capture-feedback');
});

test('chatgpt openapi.yaml contains /v1/feedback/capture path', () => {
  const filePath = path.join(root, 'adapters/chatgpt/openapi.yaml');
  const content = fs.readFileSync(filePath, 'utf-8');
  assert.match(content, /\/v1\/feedback\/capture/, 'openapi.yaml must contain /v1/feedback/capture');
});

test('cursor marketplace plugin is pinned to the released package version', () => {
  const marketplacePath = path.join(root, '.cursor-plugin', 'marketplace.json');
  const pluginManifestPath = path.join(root, 'plugins', 'cursor-marketplace', '.cursor-plugin', 'plugin.json');
  const pluginConfigPath = path.join(root, 'plugins', 'cursor-marketplace', '.mcp.json');

  const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf-8'));
  const pluginManifest = JSON.parse(fs.readFileSync(pluginManifestPath, 'utf-8'));
  const pluginConfig = JSON.parse(fs.readFileSync(pluginConfigPath, 'utf-8'));

  assert.equal(marketplace.metadata.version, packageVersion);
  assert.equal(marketplace.plugins[0].name, pluginManifest.name);
  assert.equal(pluginManifest.version, packageVersion);
  assert.deepEqual(pluginConfig.mcpServers.rlhf.args, ['-y', `mcp-memory-gateway@${packageVersion}`, 'serve']);
});
