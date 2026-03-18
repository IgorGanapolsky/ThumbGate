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
    'adapters/opencode/opencode.json',
    'adapters/amp/skills/rlhf-feedback/SKILL.md',
    'opencode.json',
    '.opencode/instructions/rlhf-workflow.md',
    '.opencode/agents/rlhf-review.md',
    '.cursor-plugin/marketplace.json',
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    '.claude-plugin/README.md',
    '.claude-plugin/bundle/server/index.js',
    '.claude-plugin/bundle/icon.png',
    'plugins/opencode-profile/INSTALL.md',
    'plugins/cursor-marketplace/.cursor-plugin/plugin.json',
    'plugins/cursor-marketplace/.mcp.json',
    'plugins/cursor-marketplace/README.md',
    'docs/guides/opencode-integration.md',
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

test('opencode adapter is valid JSON with a version-pinned local MCP server', () => {
  const filePath = path.join(root, 'adapters/opencode/opencode.json');
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const rlhf = payload.mcp && payload.mcp.rlhf;

  assert.equal(payload.$schema, 'https://opencode.ai/config.json');
  assert.ok(rlhf, 'opencode adapter must define mcp.rlhf');
  assert.equal(rlhf.type, 'local');
  assert.equal(rlhf.enabled, true);
  assert.deepEqual(rlhf.command, ['npx', '-y', `mcp-memory-gateway@${packageVersion}`, 'serve']);
});

test('repo opencode.json enforces worktree-safe defaults', () => {
  const filePath = path.join(root, 'opencode.json');
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const permissions = payload.permission || {};
  const bashPermissions = permissions.bash || {};
  const editPermissions = permissions.edit || {};

  assert.deepEqual(payload.instructions, ['.opencode/instructions/rlhf-workflow.md']);
  assert.deepEqual(payload.mcp.rlhf.command, ['node', 'bin/cli.js', 'serve']);
  assert.equal(bashPermissions['git push*'], 'deny');
  assert.equal(bashPermissions['git reset*'], 'deny');
  assert.equal(bashPermissions['git checkout --*'], 'deny');
  assert.equal(editPermissions['.rlhf/**'], 'deny');
  assert.equal(editPermissions['.claude/worktrees/**'], 'deny');
});

test('opencode review agent remains read-only and verification-focused', () => {
  const filePath = path.join(root, '.opencode', 'agents', 'rlhf-review.md');
  const content = fs.readFileSync(filePath, 'utf-8');

  assert.match(content, /edit:\s+deny/, 'rlhf-review must deny edits');
  assert.match(content, /npm run test:\*/, 'rlhf-review must allow test commands');
  assert.match(content, /npm run prove:\*/, 'rlhf-review must allow proof commands');
  assert.match(content, /npm run self-heal:check/, 'rlhf-review must allow self-heal verification');
  assert.match(content, /Do not edit files\./, 'rlhf-review must stay read-only');
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

test('claude plugin metadata stays aligned with the released package and install story', () => {
  const pluginManifestPath = path.join(root, '.claude-plugin', 'plugin.json');
  const marketplacePath = path.join(root, '.claude-plugin', 'marketplace.json');
  const readmePath = path.join(root, '.claude-plugin', 'README.md');

  const pluginManifest = JSON.parse(fs.readFileSync(pluginManifestPath, 'utf-8'));
  const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf-8'));
  const readme = fs.readFileSync(readmePath, 'utf-8');
  const marketplaceEntry = marketplace.plugins[0];

  assert.equal(pluginManifest.version, packageVersion);
  assert.equal(marketplace.version, packageVersion);
  assert.equal(marketplaceEntry.name, pluginManifest.name);
  assert.match(pluginManifest.description, /Claude Desktop|workflow hardening|Veto Layer/i);
  assert.match(marketplaceEntry.description, /Claude Desktop|workflow hardening|Veto Layer/i);
  assert.ok(pluginManifest.keywords.includes('claude-desktop'));
  assert.ok(pluginManifest.keywords.includes('workflow-hardening'));
  assert.ok(marketplaceEntry.metadata.keywords.includes('claude-desktop'));
  assert.ok(marketplaceEntry.metadata.keywords.includes('veto-layer'));
  assert.match(readme, /Privacy Policy/i);
  assert.match(readme, /Data Collection/i);
  assert.match(readme, /Support/i);
  assert.match(readme, /Examples/i);
  assert.match(readme, /claude mcp add rlhf -- npx -y mcp-memory-gateway serve/i);
  assert.match(readme, /build:claude-mcpb/i);
});
