const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('adapter files exist', () => {
  const files = [
    'adapters/chatgpt/openapi.yaml',
    'adapters/gemini/function-declarations.json',
    'adapters/claude/.mcp.json',
    'adapters/codex/config.toml',
    'adapters/amp/skills/rlhf-feedback/SKILL.md',
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
  assert.deepEqual(payload.mcpServers.rlhf, {
    command: 'npx',
    args: ['-y', 'rlhf-feedback-loop', 'serve'],
  });
});

test('codex config.toml contains mcp_servers section', () => {
  const filePath = path.join(root, 'adapters/codex/config.toml');
  const content = fs.readFileSync(filePath, 'utf-8');
  assert.match(content, /\[mcp_servers\.rlhf\]/, 'config.toml must contain canonical rlhf section');
  assert.match(content, /command = "npx"/, 'config.toml must use portable npx launcher');
  assert.match(content, /args = \["-y", "rlhf-feedback-loop", "serve"\]/, 'config.toml must launch the package serve entrypoint');
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
