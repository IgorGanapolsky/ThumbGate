const test = require('node:test');
const assert = require('node:assert');
const { ArenaDefenseEngine } = require('../scripts/arena-defense-engine.js');

test('ArenaDefenseEngine flags conversation depth beyond 20 turns without verification', () => {
  const engine = new ArenaDefenseEngine();
  const res1 = engine.evaluateSessionDepth(25, false);
  assert.strictEqual(res1.safe, false);
  assert.strictEqual(res1.risk, 'HIGH_CONVERSATION_DRIFT');

  const res2 = engine.evaluateSessionDepth(25, true);
  assert.strictEqual(res2.safe, true);
});

test('ArenaDefenseEngine optimizes cache-aware cost routing', () => {
  const engine = new ArenaDefenseEngine();
  const routing = engine.optimizeCacheCost('trivial', true);
  assert.strictEqual(routing.routeTo, 'local-small-model');
  assert.strictEqual(routing.estimatedCostUsd, 0.00);
});
