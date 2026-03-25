const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pluginDir = path.join(root, 'plugins/cursor-marketplace');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf-8'));
}

/**
 * Parse YAML frontmatter delimited by --- from a file.
 * Returns an object with key-value pairs from the frontmatter.
 */
function parseFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    fm[key] = value;
  }
  return fm;
}

const canonicalDescription = '👍👎 feedback that teaches your AI agent. Thumbs down a mistake — it never happens again.';

test('cursor marketplace manifest points at a valid plugin directory', () => {
  const packageJson = readJson('package.json');
  const marketplace = readJson('.cursor-plugin/marketplace.json');
  const pluginManifest = readJson('plugins/cursor-marketplace/.cursor-plugin/plugin.json');
  const pluginEntry = marketplace.plugins.find((plugin) => plugin.name === 'mcp-memory-gateway');

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

  assert.match(pluginManifest.name, /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
  assert.equal(pluginManifest.name, 'mcp-memory-gateway');
  assert.equal(pluginManifest.displayName, 'ThumbGate');
  assert.equal(pluginManifest.description, canonicalDescription);
  assert.equal(path.isAbsolute(pluginManifest.logo), false, 'logo must be repo-relative');
  assert.equal(pluginManifest.logo.includes('..'), false, 'logo path must not use path traversal');
  assert.equal(fs.existsSync(readmePath), true, 'plugin README should exist');
  assert.equal(fs.existsSync(logoPath), true, 'plugin logo should exist');
});

test('cursor plugin MCP config uses mcp.json (not .mcp.json) with correct rlhf server', () => {
  const mcpPath = path.join(pluginDir, 'mcp.json');
  const dotMcpPath = path.join(pluginDir, '.mcp.json');

  assert.equal(fs.existsSync(mcpPath), true, 'mcp.json must exist (no dot prefix)');
  assert.equal(fs.existsSync(dotMcpPath), false, '.mcp.json must not exist (use mcp.json instead)');

  const pluginConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
  const server = pluginConfig.mcpServers.rlhf;

  assert.equal(server.command, 'npx');
  assert.deepEqual(server.args, ['-y', 'mcp-memory-gateway@latest', 'serve']);
  assert.equal(JSON.stringify(server).includes('/Users/'), false, 'plugin config must not hardcode local paths');
});

test('cursor plugin docs explain runtime updates versus listing updates', () => {
  const readme = fs.readFileSync(path.join(root, 'plugins/cursor-marketplace/README.md'), 'utf-8');
  const opsDocPath = path.join(root, 'docs/CURSOR_PLUGIN_OPERATIONS.md');
  const opsDoc = fs.readFileSync(opsDocPath, 'utf-8');

  assert.match(readme, /Cursor Directory/i);
  assert.match(readme, /does not refresh|does not auto-refresh/i);
  assert.match(readme, /ThumbGate/);
  assert.match(readme, /mcp-memory-gateway/);
  assert.match(readme, new RegExp(canonicalDescription.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(readme, /mcp-memory-gateway@latest/);
  assert.equal(fs.existsSync(opsDocPath), true, 'Cursor plugin operations doc should exist');
  assert.match(opsDoc, /Cursor Marketplace/i);
  assert.match(opsDoc, /Cursor Directory/i);
  assert.match(opsDoc, /Display name: `ThumbGate`/);
  assert.match(opsDoc, /Plugin slug: `mcp-memory-gateway`/);
  assert.match(opsDoc, /npm publish/i);
  assert.match(opsDoc, /VERIFICATION_EVIDENCE\.md/);
  assert.match(opsDoc, new RegExp(canonicalDescription.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('all skills have valid YAML frontmatter with name and description', () => {
  const skillsDir = path.join(pluginDir, 'skills');
  const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  assert.ok(skillDirs.length > 0, 'at least one skill must exist');

  for (const dir of skillDirs) {
    const skillPath = path.join(skillsDir, dir, 'SKILL.md');
    assert.equal(fs.existsSync(skillPath), true, `${dir}/SKILL.md must exist`);

    const fm = parseFrontmatter(skillPath);
    assert.ok(fm, `${dir}/SKILL.md must have YAML frontmatter`);
    assert.ok(typeof fm.name === 'string' && fm.name.length > 0, `${dir}/SKILL.md frontmatter must have non-empty name`);
    assert.ok(typeof fm.description === 'string' && fm.description.length > 0, `${dir}/SKILL.md frontmatter must have non-empty description`);
  }
});

test('all rules (.mdc) have valid YAML frontmatter with description and alwaysApply', () => {
  const rulesDir = path.join(pluginDir, 'rules');
  const ruleFiles = fs.readdirSync(rulesDir).filter((f) => f.endsWith('.mdc'));

  assert.ok(ruleFiles.length > 0, 'at least one .mdc rule must exist');

  for (const file of ruleFiles) {
    const rulePath = path.join(rulesDir, file);
    const fm = parseFrontmatter(rulePath);
    assert.ok(fm, `${file} must have YAML frontmatter`);
    assert.ok(typeof fm.description === 'string' && fm.description.length > 0, `${file} frontmatter must have non-empty description`);
    assert.equal(typeof fm.alwaysApply, 'boolean', `${file} frontmatter alwaysApply must be a boolean`);
  }
});

test('agent .md has valid YAML frontmatter with name and description', () => {
  const agentsDir = path.join(pluginDir, 'agents');
  const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));

  assert.ok(agentFiles.length > 0, 'at least one agent must exist');

  for (const file of agentFiles) {
    const agentPath = path.join(agentsDir, file);
    const fm = parseFrontmatter(agentPath);
    assert.ok(fm, `${file} must have YAML frontmatter`);
    assert.ok(typeof fm.name === 'string' && fm.name.length > 0, `${file} frontmatter must have non-empty name`);
    assert.ok(typeof fm.description === 'string' && fm.description.length > 0, `${file} frontmatter must have non-empty description`);
  }
});

test('command .md files have valid YAML frontmatter with name and description', () => {
  const commandsDir = path.join(pluginDir, 'commands');
  const commandFiles = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.md'));

  assert.ok(commandFiles.length > 0, 'at least one command must exist');

  for (const file of commandFiles) {
    const cmdPath = path.join(commandsDir, file);
    const fm = parseFrontmatter(cmdPath);
    assert.ok(fm, `${file} must have YAML frontmatter`);
    assert.ok(typeof fm.name === 'string' && fm.name.length > 0, `${file} frontmatter must have non-empty name`);
    assert.ok(typeof fm.description === 'string' && fm.description.length > 0, `${file} frontmatter must have non-empty description`);
  }
});

test('hooks.json is valid JSON with correct hooks object structure', () => {
  const hooksPath = path.join(pluginDir, 'hooks/hooks.json');
  assert.equal(fs.existsSync(hooksPath), true, 'hooks/hooks.json must exist');

  const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf-8'));
  assert.ok(hooks.hooks, 'hooks.json must have a hooks object');
  assert.ok(hooks.hooks.beforeShellExecution, 'hooks must have beforeShellExecution');
  assert.ok(Array.isArray(hooks.hooks.beforeShellExecution), 'beforeShellExecution must be an array');

  for (const hook of hooks.hooks.beforeShellExecution) {
    assert.ok(typeof hook.command === 'string', 'each hook must have a command string');
    assert.ok(typeof hook.matcher === 'string', 'each hook must have a matcher string');
  }
});

test('scripts referenced in hooks.json exist and are executable', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(pluginDir, 'hooks/hooks.json'), 'utf-8'));

  for (const hook of hooks.hooks.beforeShellExecution) {
    const scriptPath = path.join(pluginDir, hook.command);
    assert.equal(fs.existsSync(scriptPath), true, `script ${hook.command} must exist`);

    const stats = fs.statSync(scriptPath);
    const isExecutable = (stats.mode & 0o111) !== 0;
    assert.equal(isExecutable, true, `script ${hook.command} must be executable`);
  }
});

test('plugin logo file exists at the referenced path', () => {
  const pluginManifest = readJson('plugins/cursor-marketplace/.cursor-plugin/plugin.json');
  const logoPath = path.join(pluginDir, pluginManifest.logo);
  assert.equal(fs.existsSync(logoPath), true, `logo must exist at ${pluginManifest.logo}`);
});

test('plugin name is kebab-case', () => {
  const pluginManifest = readJson('plugins/cursor-marketplace/.cursor-plugin/plugin.json');
  assert.match(pluginManifest.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'plugin name must be kebab-case');
});

test('no claude-specific tags in plugin.json keywords or marketplace.json tags', () => {
  const pluginManifest = readJson('plugins/cursor-marketplace/.cursor-plugin/plugin.json');
  const marketplace = readJson('.cursor-plugin/marketplace.json');
  const pluginEntry = marketplace.plugins.find((p) => p.name === 'mcp-memory-gateway');

  const claudeTerms = ['claude-desktop', 'claude-code', 'claude', 'desktop-extension', 'anthropic'];

  for (const keyword of pluginManifest.keywords) {
    for (const term of claudeTerms) {
      assert.notEqual(keyword.toLowerCase(), term, `plugin.json keyword "${keyword}" is claude-specific`);
    }
  }

  for (const tag of pluginEntry.tags) {
    for (const term of claudeTerms) {
      assert.notEqual(tag.toLowerCase(), term, `marketplace.json tag "${tag}" is claude-specific`);
    }
  }
});
