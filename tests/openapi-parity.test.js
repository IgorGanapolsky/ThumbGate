const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function normalize(content) {
  return content
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

test('chatgpt openapi includes all core API routes', () => {
  const canonical = fs.readFileSync(path.join(root, 'openapi/openapi.yaml'), 'utf-8');
  const adapter = fs.readFileSync(path.join(root, 'adapters/chatgpt/openapi.yaml'), 'utf-8');

  const requiredPaths = [
    '/v1/feedback/capture',
    '/v1/intents/catalog',
    '/v1/intents/plan',
    '/v1/feedback/summary',
    '/v1/feedback/rules',
    '/v1/dpo/export',
    '/v1/context/construct',
    '/v1/context/evaluate',
    '/v1/context/provenance',
  ];

  for (const route of requiredPaths) {
    assert.match(canonical, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(adapter, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.ok(normalize(adapter).length > 50);
});
