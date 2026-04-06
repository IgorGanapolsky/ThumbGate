const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  PRODUCTHUNT_URL,
  getClaudePluginLatestDownloadUrl,
} = require('../scripts/distribution-surfaces');

const root = path.join(__dirname, '..');
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).version;

test('adapter files exist', () => {
  const files = [
    'adapters/chatgpt/openapi.yaml',
    'adapters/gemini/function-declarations.json',
    'adapters/claude/.mcp.json',
    'adapters/codex/config.toml',
    'adapters/opencode/opencode.json',
    'adapters/amp/skills/thumbgate-feedback/SKILL.md',
    'opencode.json',
    '.opencode/instructions/thumbgate-workflow.md',
    '.opencode/agents/thumbgate-review.md',
    '.cursor-plugin/marketplace.json',
    '.agents/plugins/marketplace.json',
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    '.claude-plugin/README.md',
    '.claude-plugin/bundle/server/index.js',
    '.claude-plugin/bundle/icon.png',
    'plugins/claude-codex-bridge/.claude-plugin/plugin.json',
    'plugins/claude-codex-bridge/.mcp.json',
    'plugins/claude-codex-bridge/README.md',
    'plugins/claude-codex-bridge/INSTALL.md',
    'plugins/opencode-profile/INSTALL.md',
    'plugins/codex-profile/.codex-plugin/plugin.json',
    'plugins/codex-profile/.mcp.json',
    'plugins/codex-profile/README.md',
    'plugins/cursor-marketplace/.cursor-plugin/plugin.json',
    'plugins/cursor-marketplace/mcp.json',
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
  
  const thumbgate = payload.mcpServers.thumbgate;
  if (thumbgate.command === 'npx') {
    assert.deepEqual(thumbgate.args, ['-y', `thumbgate@${packageVersion}`, 'serve']);
  } else {
    assert.equal(thumbgate.command, 'node');
    assert.ok(thumbgate.args.includes('serve'));
  }
});

test('codex config.toml contains mcp_servers section', () => {
  const filePath = path.join(root, 'adapters/codex/config.toml');
  const content = fs.readFileSync(filePath, 'utf-8');
  assert.match(content, /\[mcp_servers\.thumbgate\]/, 'config.toml must contain canonical thumbgate section');
  
  if (content.includes('command = "npx"')) {
    assert.match(
      content,
      new RegExp(`args = \\["-y", "thumbgate@${packageVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}", "serve"\\]`),
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
  const thumbgate = payload.mcp && payload.mcp.thumbgate;

  assert.equal(payload.$schema, 'https://opencode.ai/config.json');
  assert.ok(thumbgate, 'opencode adapter must define mcp.thumbgate');
  assert.equal(thumbgate.type, 'local');
  assert.equal(thumbgate.enabled, true);
  assert.deepEqual(thumbgate.command, ['npx', '-y', `thumbgate@${packageVersion}`, 'serve']);
});

test('repo opencode.json enforces worktree-safe defaults', () => {
  const filePath = path.join(root, 'opencode.json');
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const permissions = payload.permission || {};
  const bashPermissions = permissions.bash || {};
  const editPermissions = permissions.edit || {};

  assert.deepEqual(payload.instructions, ['.opencode/instructions/thumbgate-workflow.md']);
  assert.deepEqual(payload.mcp.thumbgate.command, ['node', 'bin/cli.js', 'serve']);
  assert.equal(bashPermissions['git push*'], 'deny');
  assert.equal(bashPermissions['git reset*'], 'deny');
  assert.equal(bashPermissions['git checkout --*'], 'deny');
  assert.equal(editPermissions['.thumbgate/**'], 'deny');
  assert.equal(editPermissions['.claude/worktrees/**'], 'deny');
});

test('opencode review agent remains read-only and verification-focused', () => {
  const filePath = path.join(root, '.opencode', 'agents', 'thumbgate-review.md');
  const content = fs.readFileSync(filePath, 'utf-8');

  assert.match(content, /edit:\s+deny/, 'thumbgate-review must deny edits');
  assert.match(content, /npm run test:\*/, 'thumbgate-review must allow test commands');
  assert.match(content, /npm run prove:\*/, 'thumbgate-review must allow proof commands');
  assert.match(content, /npm run self-heal:check/, 'thumbgate-review must allow self-heal verification');
  assert.match(content, /Do not edit files\./, 'thumbgate-review must stay read-only');
});

test('amp SKILL.md contains capture-feedback reference', () => {
  const filePath = path.join(root, 'adapters/amp/skills/thumbgate-feedback/SKILL.md');
  const content = fs.readFileSync(filePath, 'utf-8');
  assert.match(content, /capture-feedback/, 'SKILL.md must reference capture-feedback');
});

test('chatgpt openapi.yaml contains /v1/feedback/capture path', () => {
  const filePath = path.join(root, 'adapters/chatgpt/openapi.yaml');
  const content = fs.readFileSync(filePath, 'utf-8');
  assert.match(content, /\/v1\/feedback\/capture/, 'openapi.yaml must contain /v1/feedback/capture');
});

test('cursor marketplace plugin keeps metadata versioned while runtime tracks the latest npm tag', () => {
  const marketplacePath = path.join(root, '.cursor-plugin', 'marketplace.json');
  const pluginManifestPath = path.join(root, 'plugins', 'cursor-marketplace', '.cursor-plugin', 'plugin.json');
  const pluginConfigPath = path.join(root, 'plugins', 'cursor-marketplace', 'mcp.json');

  const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf-8'));
  const pluginManifest = JSON.parse(fs.readFileSync(pluginManifestPath, 'utf-8'));
  const pluginConfig = JSON.parse(fs.readFileSync(pluginConfigPath, 'utf-8'));

  assert.equal(marketplace.metadata.version, packageVersion);
  assert.equal(marketplace.plugins[0].name, pluginManifest.name);
  assert.equal(pluginManifest.version, packageVersion);
  assert.deepEqual(pluginConfig.mcpServers.thumbgate.args, ['-y', 'thumbgate@latest', 'serve']);
  assert.equal(pluginManifest.homepage, 'https://thumbgate-production.up.railway.app');
  assert.equal(pluginManifest.repository, 'https://github.com/IgorGanapolsky/ThumbGate');
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
  assert.match(pluginManifest.description, /Pre-Action Gates|pre-action gates|prevention rules/i);
  assert.match(marketplaceEntry.description, /Pre-Action Gates|pre-action gates|prevention rules/i);
  assert.ok(pluginManifest.keywords.includes('pre-action-gates'));
  assert.ok(pluginManifest.keywords.includes('ai-agent-safety'));
  assert.ok(marketplaceEntry.metadata.keywords.includes('pre-action-gates'));
  assert.equal(pluginManifest.homepage, 'https://thumbgate-production.up.railway.app');
  assert.equal(pluginManifest.repository, 'https://github.com/IgorGanapolsky/ThumbGate');
  assert.equal(marketplaceEntry.metadata.homepage, 'https://thumbgate-production.up.railway.app');
  assert.match(readme, /Privacy Policy/i);
  assert.match(readme, /Data Collection/i);
  assert.match(readme, /Support/i);
  assert.match(readme, /Examples/i);
  assert.match(readme, /claude mcp add thumbgate -- npx -y thumbgate serve/i);
  assert.match(readme, /build:claude-mcpb/i);
  assert.match(readme, new RegExp(getClaudePluginLatestDownloadUrl(root).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(readme.includes(PRODUCTHUNT_URL));
  assert.doesNotMatch(readme, /github\.com\/IgorGanapolsky\/thumbgate/);
});

test('claude .mcp.json ThumbGate command is either npx or node', () => {
  const filePath = path.join(root, 'adapters/claude/.mcp.json');
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const thumbgate = payload.mcpServers.thumbgate;
  assert.ok(
    thumbgate.command === 'npx' || thumbgate.command === 'node',
    'command should be npx or node, got ' + thumbgate.command
  );
  if (thumbgate.command === 'node') {
    assert.ok(thumbgate.args.includes('serve'), 'node command should include serve');
  }
});

test('codex config.toml uses either npx or node command', () => {
  const filePath = path.join(root, 'adapters/codex/config.toml');
  const content = fs.readFileSync(filePath, 'utf-8');
  const usesNpx = content.includes('command = "npx"');
  const usesNode = content.includes('command = "node"');
  assert.ok(usesNpx || usesNode, 'should use npx or node');
  if (usesNode) {
    assert.match(content, /"serve"/, 'node command should include serve');
  }
});

test('codex app plugin surface is present and aligned to ThumbGate metadata', () => {
  const pluginManifest = JSON.parse(fs.readFileSync(path.join(root, 'plugins/codex-profile/.codex-plugin/plugin.json'), 'utf-8'));
  const pluginConfig = JSON.parse(fs.readFileSync(path.join(root, 'plugins/codex-profile/.mcp.json'), 'utf-8'));
  const marketplace = JSON.parse(fs.readFileSync(path.join(root, '.agents/plugins/marketplace.json'), 'utf-8'));
  const pluginEntry = marketplace.plugins.find((plugin) => plugin.name === pluginManifest.name);

  assert.equal(pluginManifest.version, packageVersion);
  assert.equal(pluginManifest.homepage, 'https://thumbgate-production.up.railway.app');
  assert.equal(pluginManifest.repository, 'https://github.com/IgorGanapolsky/ThumbGate');
  assert.equal(pluginManifest.interface.displayName, 'ThumbGate for Codex');
  assert.equal(pluginManifest.mcpServers, './.mcp.json');
  assert.ok(pluginEntry, 'codex plugin marketplace entry should exist');
  assert.equal(pluginEntry.source.path, './plugins/codex-profile');
  assert.deepEqual(pluginConfig.mcpServers.thumbgate.args, ['-y', `thumbgate@${packageVersion}`, 'serve']);
});

test('Claude Codex bridge plugin surface is present and aligned to ThumbGate metadata', () => {
  const pluginManifest = JSON.parse(fs.readFileSync(path.join(root, 'plugins/claude-codex-bridge/.claude-plugin/plugin.json'), 'utf-8'));
  const pluginConfig = JSON.parse(fs.readFileSync(path.join(root, 'plugins/claude-codex-bridge/.mcp.json'), 'utf-8'));
  const readme = fs.readFileSync(path.join(root, 'plugins/claude-codex-bridge/README.md'), 'utf-8');

  assert.equal(pluginManifest.version, packageVersion);
  assert.equal(pluginManifest.homepage, 'https://thumbgate-production.up.railway.app');
  assert.equal(pluginManifest.repository, 'https://github.com/IgorGanapolsky/ThumbGate');
  assert.equal(pluginManifest.name, 'codex-bridge');
  assert.deepEqual(pluginConfig.mcpServers.thumbgate.args, ['-y', `thumbgate@${packageVersion}`, 'serve']);
  assert.match(readme, /Claude Code plugin/i);
  assert.match(readme, /adversarial review/i);
  assert.match(readme, /second-pass handoff/i);
});
