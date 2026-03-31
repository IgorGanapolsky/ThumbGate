'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('Claude Codex bridge plugin ships a repo-local Claude Code plugin surface', () => {
  const plugin = readJson('plugins/claude-codex-bridge/.claude-plugin/plugin.json');
  const mcpConfig = readJson('plugins/claude-codex-bridge/.mcp.json');
  const readme = readText('plugins/claude-codex-bridge/README.md');
  const installGuide = readText('plugins/claude-codex-bridge/INSTALL.md');
  const packageVersion = readJson('package.json').version;

  assert.equal(plugin.name, 'codex-bridge');
  assert.equal(plugin.version, packageVersion);
  assert.equal(plugin.homepage, 'https://rlhf-feedback-loop-production.up.railway.app');
  assert.equal(plugin.repository, 'https://github.com/IgorGanapolsky/ThumbGate');
  assert.deepEqual(mcpConfig.mcpServers.rlhf.args, ['-y', `mcp-memory-gateway@${packageVersion}`, 'serve']);
  assert.match(readme, /Codex review/i);
  assert.match(readme, /adversarial review/i);
  assert.match(readme, /second-pass handoff/i);
  assert.match(readme, /claude --plugin-dir/i);
  assert.match(readme, /claude plugin validate/i);
  assert.match(installGuide, /\/codex-bridge:review/);
  assert.match(installGuide, /\/codex-bridge:adversarial-review/);
  assert.match(installGuide, /\/codex-bridge:second-pass/);
});

test('Claude Codex bridge skills point at the shipped bridge script', () => {
  const skillPaths = [
    'plugins/claude-codex-bridge/skills/setup/SKILL.md',
    'plugins/claude-codex-bridge/skills/review/SKILL.md',
    'plugins/claude-codex-bridge/skills/adversarial-review/SKILL.md',
    'plugins/claude-codex-bridge/skills/second-pass/SKILL.md',
    'plugins/claude-codex-bridge/skills/status/SKILL.md',
    'plugins/claude-codex-bridge/skills/result/SKILL.md',
  ];

  for (const relativePath of skillPaths) {
    const content = readText(relativePath);
    assert.match(content, /^---\n/, `${relativePath} should start with frontmatter`);
    assert.match(content, /description:\s*.+/, `${relativePath} should describe when to use the skill`);
    assert.match(content, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/codex-bridge\.js/, `${relativePath} should call the bridge script`);
  }
});
