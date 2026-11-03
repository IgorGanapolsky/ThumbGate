const test = require('node:test');
const assert = require('node:assert');
const { ThumbGateEnterpriseEngine } = require('../scripts/thumbgate-enterprise-engine.js');

test('ThumbGateEnterpriseEngine models "The Car Around the Free Engine" and Jevons paradox scaling', () => {
  const engine = new ThumbGateEnterpriseEngine();
  const strategy = engine.generateEnterpriseStrategy();
  assert.strictEqual(strategy.strategy, 'The Car Around the Free Engine');
  assert.strictEqual(strategy.monetization.enterprise.priceUsd, 499);

  const jevons = engine.calculateJevonsComputeScale(0.10, 100_000_000);
  assert.strictEqual(jevons.totalCostUsd, 10.00);
  assert.strictEqual(jevons.economicEfficiency, 'OPTIMIZED_FOR_JEVONS_PARADOX');
});
