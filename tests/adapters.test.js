const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  PRODUCTHUNT_URL,
  getClaudePluginLatestDownloadUrl,
} = require('../scripts/distribution-surfaces');

const root = path.join(__dirname, '..');
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).version;
const explicitServeArgs = ['--yes', '--package', `thumbgate@${packageVersion}`, 'thumbgate', 'serve'];
const explicitLatestServeArgs = ['--yes', '--package', 'thumbgate@latest', 'thumbgate', 'serve'];

test('adapter files exist', () => {
  const files = [
    'adapters/chatgpt/openapi.yaml',
    'adapters/gemini/function-declarations.json',
    'adapters/claude/.mcp.json',
    'adapters/codex/config.toml',
    'adapters/opencode/opencode.json',
    'adapters/amp/skills/thumbgate-feedback/SKILL.md',
    'adapters/forge/forge.yaml',
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
    assert.deepEqual(thumbgate.args, explicitServeArgs);
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
      new RegExp(`args = \\["--yes", "--package", "thumbgate@${packageVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}", "thumbgate", "serve"\\]`),
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
  assert.deepEqual(thumbgate.command, ['npx', ...explicitServeArgs]);
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

test('forge adapter forge.yaml contains thumbgate skills and MCP config', () => {
  const filePath = path.join(root, 'adapters/forge/forge.yaml');
  const content = fs.readFileSync(filePath, 'utf-8');
  assert.match(content, /thumbgate-gate-check/, 'forge.yaml must define thumbgate-gate-check skill');
  assert.match(content, /thumbgate-feedback/, 'forge.yaml must define thumbgate-feedback skill');
  assert.match(content, /pre_tool_use/, 'forge.yaml must reference pre_tool_use trigger');
  assert.match(content, /gate-check/, 'forge.yaml must reference gate-check command');
  assert.match(content, /thumbgate/, 'forge.yaml must define thumbgate MCP server');
  assert.match(content, /serve/, 'forge.yaml must include serve command');
});

test('shipped plugin surfaces stay ThumbGate-branded and project-safe', () => {
  const ampSkill = fs.readFileSync(path.join(root, 'plugins/amp-skill/SKILL.md'), 'utf-8');
  const ampInstall = fs.readFileSync(path.join(root, 'plugins/amp-skill/INSTALL.md'), 'utf-8');
  const claudeInstall = fs.readFileSync(path.join(root, 'plugins/claude-skill/INSTALL.md'), 'utf-8');
  const hookAutoCapture = fs.readFileSync(path.join(root, 'scripts/hook-auto-capture.sh'), 'utf-8');
  const bootstrap = fs.readFileSync(path.join(root, 'scripts/ensure-repo-bootstrap.js'), 'utf-8');
  const obsidianExport = fs.readFileSync(path.join(root, 'scripts/obsidian-export.js'), 'utf-8');
  const trainer = fs.readFileSync(path.join(root, 'scripts/train_from_feedback.py'), 'utf-8');

  assert.match(ampSkill, /^name: thumbgate-feedback$/m, 'Amp skill should expose the ThumbGate skill name');
  assert.doesNotMatch(ampSkill, /^name: rlhf-feedback$/m, 'Amp skill should not expose the legacy RLHF skill name');
  assert.doesNotMatch(ampInstall, /rlhf-feedback\.md/, 'Amp install doc should not copy legacy skill filenames');
  assert.doesNotMatch(claudeInstall, /rlhf-feedback\.md/, 'Claude install doc should not copy legacy skill filenames');
  assert.doesNotMatch(ampInstall, /\.thumbgate\/capture-feedback\.js/, 'Amp install doc should use the published CLI capture entrypoint');
  assert.doesNotMatch(claudeInstall, /\.thumbgate\/capture-feedback\.js/, 'Claude install doc should use the published CLI capture entrypoint');
  assert.doesNotMatch(hookAutoCapture, /\.rlhf/, 'Hook fallback should stay on .thumbgate');
  assert.match(bootstrap, /mcpServers\[MCP_SERVER_KEY\]/, 'Bootstrap should wire the canonical thumbgate MCP key');
  assert.doesNotMatch(bootstrap, /mcpServers\.rlhf/, 'Bootstrap should not emit legacy MCP server keys');
  assert.doesNotMatch(bootstrap, /createdRlhfDir|ensureRlhfDir/, 'Bootstrap should create .thumbgate, not .rlhf');
  assert.doesNotMatch(obsidianExport, /\.rlhf/, 'Obsidian export should not read the legacy .rlhf folder');
  assert.doesNotMatch(trainer, /local_rlhf/, 'Feedback trainer should not resolve .rlhf project roots');
});

test('ensure-repo-bootstrap writes canonical ThumbGate runtime surfaces', () => {
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-bootstrap-'));
  const claudeDir = path.join(tmpRepo, '.claude');
  const gitInfoDir = path.join(tmpRepo, '.git', 'info');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(gitInfoDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({
    mcpServers: {
      rlhf: { command: 'node', args: ['/tmp/old-rlhf.js'] },
      rlhf_feedback_loop: { command: 'npx', args: ['-y', 'mcp-memory-gateway', 'serve'] },
    },
  }, null, 2));

  try {
    const raw = execFileSync('node', [path.join(root, 'scripts', 'ensure-repo-bootstrap.js'), tmpRepo], {
      encoding: 'utf8',
    });
    const result = JSON.parse(raw);
    const mcpConfig = JSON.parse(fs.readFileSync(path.join(tmpRepo, '.mcp.json'), 'utf8'));
    const claudeSettings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    const infoExclude = fs.readFileSync(path.join(gitInfoDir, 'exclude'), 'utf8');

    assert.equal(result.createdThumbgateDir, true);
    assert.equal(fs.existsSync(path.join(tmpRepo, '.thumbgate')), true);
    assert.equal(mcpConfig.mcpServers.thumbgate.command, 'npx');
    assert.deepEqual(mcpConfig.mcpServers.thumbgate.args, ['-y', 'thumbgate@latest', 'serve']);
    assert.equal(Object.prototype.hasOwnProperty.call(mcpConfig.mcpServers, 'rlhf'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(claudeSettings.mcpServers, 'thumbgate'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(claudeSettings.mcpServers, 'rlhf'), false);
    assert.equal(infoExclude.includes('.thumbgate/'), true);
    assert.equal(infoExclude.includes('.rlhf/'), false);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
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
  assert.deepEqual(pluginConfig.mcpServers.thumbgate.args, explicitLatestServeArgs);
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
  assert.match(readme, /claude mcp add thumbgate -- npx --yes --package thumbgate thumbgate serve/i);
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
  assert.deepEqual(pluginConfig.mcpServers.thumbgate.args, explicitServeArgs);
});

test('Claude Codex bridge plugin surface is present and aligned to ThumbGate metadata', () => {
  const pluginManifest = JSON.parse(fs.readFileSync(path.join(root, 'plugins/claude-codex-bridge/.claude-plugin/plugin.json'), 'utf-8'));
  const pluginConfig = JSON.parse(fs.readFileSync(path.join(root, 'plugins/claude-codex-bridge/.mcp.json'), 'utf-8'));
  const readme = fs.readFileSync(path.join(root, 'plugins/claude-codex-bridge/README.md'), 'utf-8');

  assert.equal(pluginManifest.version, packageVersion);
  assert.equal(pluginManifest.homepage, 'https://thumbgate-production.up.railway.app');
  assert.equal(pluginManifest.repository, 'https://github.com/IgorGanapolsky/ThumbGate');
  assert.equal(pluginManifest.name, 'codex-bridge');
  assert.deepEqual(pluginConfig.mcpServers.thumbgate.args, explicitServeArgs);
  assert.match(readme, /Claude Code plugin/i);
  assert.match(readme, /adversarial review/i);
  assert.match(readme, /second-pass handoff/i);
});
