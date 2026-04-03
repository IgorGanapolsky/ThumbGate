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
    '/v1/telemetry/ping',
    '/v1/intents/catalog',
    '/v1/intents/plan',
    '/v1/handoffs/start',
    '/v1/handoffs/complete',
    '/v1/internal-agent/bootstrap',
    '/v1/feedback/summary',
    '/v1/lessons/search',
    '/v1/search',
    '/v1/feedback/rules',
    '/v1/dpo/export',
    '/v1/analytics/databricks/export',
    '/v1/dashboard',
    '/v1/dashboard/render-spec',
    '/v1/settings/status',
    '/v1/context/construct',
    '/v1/context/evaluate',
    '/v1/context/provenance',
    '/v1/intake/workflow-sprint',
    '/v1/intake/workflow-sprint/advance',
    '/v1/lessons/search',
  ];

  for (const route of requiredPaths) {
    assert.match(canonical, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(adapter, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.ok(normalize(adapter).length > 50);
});

test('canonical openapi includes monetization and funnel analytics routes', () => {
  const canonical = fs.readFileSync(path.join(root, 'openapi/openapi.yaml'), 'utf-8');
  const monetizationRoutes = [
    '/v1/billing/checkout',
    '/v1/billing/entitlement',
    '/v1/billing/usage',
    '/v1/billing/provision',
    '/v1/billing/summary',
    '/v1/billing/webhook',
    '/v1/billing/github-webhook',
    '/v1/analytics/funnel',
    '/v1/dashboard',
    '/v1/dashboard/render-spec',
    '/v1/settings/status',
    '/v1/intake/workflow-sprint',
    '/v1/intake/workflow-sprint/advance',
  ];

  for (const route of monetizationRoutes) {
    assert.match(canonical, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('canonical openapi.yaml exists and has more than 50 lines', () => {
  const filePath = path.join(root, 'openapi/openapi.yaml');
  assert.ok(fs.existsSync(filePath), 'canonical openapi.yaml must exist');
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  assert.ok(lines.length > 50, `expected >50 lines, got ${lines.length}`);
});

test('all core routes present in canonical openapi', () => {
  const content = fs.readFileSync(path.join(root, 'openapi/openapi.yaml'), 'utf-8');
  const coreRoutes = [
    '/v1/feedback/capture',
    '/v1/dpo/export',
    '/v1/analytics/databricks/export',
    '/v1/context/construct',
    '/v1/intents/plan',
    '/v1/handoffs/start',
    '/v1/handoffs/complete',
    '/v1/internal-agent/bootstrap',
    '/v1/lessons/search',
    '/v1/search',
  ];
  for (const route of coreRoutes) {
    assert.match(content, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `canonical openapi must contain ${route}`);
  }
});

test('chatgpt adapter preserves core endpoint parity with canonical openapi', () => {
  const canonical = fs.readFileSync(path.join(root, 'openapi/openapi.yaml'), 'utf-8');
  const adapter = fs.readFileSync(path.join(root, 'adapters/chatgpt/openapi.yaml'), 'utf-8');
  const coreRoutes = [
    '/v1/feedback/capture',
    '/v1/feedback/stats',
    '/v1/telemetry/ping',
    '/v1/intents/catalog',
    '/v1/intents/plan',
    '/v1/handoffs/start',
    '/v1/handoffs/complete',
    '/v1/internal-agent/bootstrap',
    '/v1/lessons/search',
    '/v1/search',
    '/v1/dpo/export',
    '/v1/analytics/databricks/export',
    '/v1/dashboard',
    '/v1/dashboard/render-spec',
    '/v1/settings/status',
    '/v1/intake/workflow-sprint',
    '/v1/intake/workflow-sprint/advance',
  ];
  for (const route of coreRoutes) {
    const escaped = new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    assert.match(canonical, escaped, `canonical should contain ${route}`);
    assert.match(adapter, escaped, `adapter should contain ${route}`);
  }
});

test('openapi file contains version header', () => {
  const content = fs.readFileSync(path.join(root, 'openapi/openapi.yaml'), 'utf-8');
  assert.match(content, /^openapi:\s/, 'openapi.yaml must start with openapi: version header');
});
