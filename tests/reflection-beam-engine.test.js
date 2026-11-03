const test = require('node:test');
const assert = require('node:assert');
const { ReflectionBeamEngine } = require('../scripts/reflection-beam-engine.js');

test('ReflectionBeamEngine tags rollouts with policy versions and simulates expert parallelism', () => {
  const engine = new ReflectionBeamEngine();
  const rollout = engine.generateRolloutWithStalenessTag('Fix bug in auth module', 'v1.40.0');
  
  assert.strictEqual(rollout.policyVersion, 'v1.40.0');
  assert.strictEqual(rollout.stalenessCompensated, true);

  const ep = engine.simulateExpertParallelism(1024);
  assert.strictEqual(ep.status, 'BALANCED_EXPERT_UTILIZATION');
  assert.strictEqual(ep.crossRackTrafficReduction, '75%');
});
