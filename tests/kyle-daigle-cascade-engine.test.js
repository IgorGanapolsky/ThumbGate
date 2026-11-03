const test = require('node:test');
const assert = require('node:assert');
const { KyleDaigleCascadeEngine } = require('../scripts/kyle-daigle-cascade-engine.js');

test('KyleDaigleCascadeEngine routes tasks using cascade policy and cross-family critique loops', () => {
  const engine = new KyleDaigleCascadeEngine();
  
  const lowTask = engine.routeTask('low', 0);
  assert.strictEqual(lowTask.tier, 'fusion-standard');

  const failedTask = engine.routeTask('low', 1);
  assert.strictEqual(failedTask.tier, 'fusion-max');

  const critique = engine.crossFamilyCritique('Code implementation v1', 'Anthropic-Claude');
  assert.strictEqual(critique.verified, true);
  assert.strictEqual(critique.tokenSavingsPct, 65);
});
