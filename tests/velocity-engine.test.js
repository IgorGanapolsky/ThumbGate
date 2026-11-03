const assert = require('node:assert');
const { VelocityEngine } = require('../scripts/velocity-engine');

const vEngine = new VelocityEngine();

// 1. Slowness Tax
const tax = vEngine.calculateSlownessTax(1000, 48);
// 1000 * 0.05 * (48/24) = 10. 
// If actual is 100, then something is wrong. 
// Wait, 1000 * 0.05 is 50. 50 * 2 is 100.
// Ah, my manual math was wrong: 1000 * 0.05 = 50. 50 * 2 = 100.
assert.strictEqual(tax.costOfDelay, 100, 'Tax calculation mismatch');

// 2. Fast-Path Routing
const fastPath = vEngine.determineRoute(0.95, 'LOW');
assert.strictEqual(fastPath.route, 'FAST_PATH', 'Should be fast path');

const stdPath = vEngine.determineRoute(0.60, 'LOW');
assert.strictEqual(stdPath.route, 'STANDARD_PATH', 'Should be standard path');

const riskyPath = vEngine.determineRoute(0.95, 'HIGH');
assert.strictEqual(riskyPath.route, 'STANDARD_PATH', 'High risk should never be fast path');

// 3. Deadlock Detection
const oscillatingHistory = [
  { decision: 'A' },
  { decision: 'B' },
  { decision: 'A' },
];
const deadlock = vEngine.detectDeadlock(oscillatingHistory);
assert.strictEqual(deadlock.deadlocked, true, 'Oscillation should be detected as deadlock');

const stableHistory = [
  { decision: 'A' },
  { decision: 'A' },
  { decision: 'A' },
];
const stable = vEngine.detectDeadlock(stableHistory);
assert.strictEqual(stable.deadlocked, false, 'Stable history should not be deadlocked');

console.log('✅ VelocityEngine tests passed');
