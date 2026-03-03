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
});
