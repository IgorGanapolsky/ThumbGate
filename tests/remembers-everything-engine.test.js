const test = require('node:test');
const assert = require('node:assert');
const { RemembersEverythingEngine } = require('../scripts/remembers-everything-engine.js');

test('RemembersEverythingEngine manages weekly shipping cadence and blind spot evaluation', () => {
  const engine = new RemembersEverythingEngine();
  const cadence = engine.logWeeklyCadence('Shipped Reflection CLI & Cascade Routing', 149, 'Scale enterprise sales outreach');
  assert.strictEqual(cadence.cadenceValid, true);
  assert.strictEqual(cadence.userCount, 149);

  const blindSpot = engine.evaluateBlindSpot('Write authentication module', ['delegation']);
  assert.strictEqual(blindSpot.flagged, true);
  assert.ok(blindSpot.recommendation.includes('Delegate'));
});
