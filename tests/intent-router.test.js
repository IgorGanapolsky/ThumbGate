const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadPolicyBundle,
  listIntents,
  planIntent,
} = require('../scripts/intent-router');

test('loads default policy bundle', () => {
  const bundle = loadPolicyBundle('default-v1');
  assert.equal(bundle.bundleId, 'default-v1');
  assert.ok(Array.isArray(bundle.intents));
  assert.ok(bundle.intents.length >= 3);
});

test('listIntents returns approval metadata for profile', () => {
  const catalog = listIntents({ bundleId: 'default-v1', mcpProfile: 'locked' });
  assert.equal(catalog.bundleId, 'default-v1');
  assert.equal(catalog.mcpProfile, 'locked');
  const mediumIntent = catalog.intents.find((i) => i.id === 'improve_response_quality');
  assert.equal(mediumIntent.requiresApproval, true);
});

test('high-risk intent requires approval by default profile', () => {
  const plan = planIntent({
    bundleId: 'default-v1',
    mcpProfile: 'default',
    intentId: 'publish_dpo_training_data',
    approved: false,
  });
  assert.equal(plan.status, 'checkpoint_required');
  assert.equal(plan.requiresApproval, true);
  assert.ok(plan.checkpoint);
});

test('approved high-risk intent becomes ready', () => {
  const plan = planIntent({
    bundleId: 'default-v1',
    mcpProfile: 'default',
    intentId: 'publish_dpo_training_data',
    approved: true,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.requiresApproval, true);
  assert.equal(plan.checkpoint, null);
});

test('unknown intent throws', () => {
  assert.throws(() => planIntent({
    bundleId: 'default-v1',
    mcpProfile: 'default',
    intentId: 'does_not_exist',
  }), /Unknown intent/);
});

test('invalid mcp profile is rejected', () => {
  assert.throws(() => listIntents({
    bundleId: 'default-v1',
    mcpProfile: 'not-a-profile',
  }), /Unknown MCP profile/);
});
