/**
 * Test Suite for Maude Lemaire Platform Guardrails & Scaling Engine
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateTestMutationResistance,
  validateQuerySharding,
  evaluateLoadShedding,
  evaluateMigrationPhase,
  validateTraceSamplingArchitecture,
  validateLoadTestArchitecture,
  validateParallelOptimization,
  MIGRATION_PHASES
} = require('../src/maude-platform-guardrails-engine');

test('Maude Lemaire Guardrails - Mutation Testing kills sycophantic AI tests', () => {
  const code = `
    function checkUserAccess(user) {
      if (user.role === 'admin') {
        return true;
      }
      return false;
    }
  `;

  // A sycophantic test that passes regardless of what code returns
  const sycophanticTestRunner = () => ({ passed: true });
  const sycophanticEval = evaluateTestMutationResistance({
    sourceCode: code,
    testRunnerFn: sycophanticTestRunner
  });
  assert.equal(sycophanticEval.allowed, false);
  assert.equal(sycophanticEval.verdict, 'BLOCK');
  assert.ok(sycophanticEval.survivingMutants.length > 0);

  // A rigorous test that catches mutations
  const rigorousTestRunner = (mutatedCode) => {
    // If return true was inverted to false, this test fails
    if (mutatedCode.includes('return false') && !mutatedCode.includes('return true')) {
      return { passed: false };
    }
    if (mutatedCode.includes('return null')) {
      return { passed: false };
    }
    return { passed: true };
  };

  const rigorousEval = evaluateTestMutationResistance({
    sourceCode: code,
    testRunnerFn: rigorousTestRunner,
    minKillRate: 0.5
  });
  assert.equal(rigorousEval.allowed, true);
  assert.equal(rigorousEval.verdict, 'PASS');
});

test('Maude Lemaire Guardrails - Scatter Query and Granular Sharding Guard', () => {
  // Query on sharded table missing WHERE clause -> scatter query
  const res1 = validateQuerySharding({
    sql: 'SELECT * FROM messages',
    targetTable: 'messages'
  });
  assert.equal(res1.allowed, false);
  assert.equal(res1.isScatterQuery, true);
  assert.equal(res1.violation, 'SCATTER_QUERY_MISSING_WHERE');

  // Query on sharded table using coarse enterprise_id key -> hotspotting danger
  const res2 = validateQuerySharding({
    sql: 'SELECT * FROM messages WHERE enterprise_id = ?',
    targetTable: 'messages',
    queryParams: { enterprise_id: 'ent_999' }
  });
  assert.equal(res2.allowed, false);
  assert.equal(res2.violation, 'SHARDED_BY_COARSE_ENTERPRISE_KEY');

  // Query on sharded table with granular channel_id sharding key -> allowed
  const res3 = validateQuerySharding({
    sql: 'SELECT * FROM messages WHERE channel_id = ?',
    targetTable: 'messages',
    queryParams: { channel_id: 'chn_123' }
  });
  assert.equal(res3.allowed, true);
  assert.equal(res3.isScatterQuery, false);

  // Query on unsharded table -> allowed
  const res4 = validateQuerySharding({
    sql: 'SELECT * FROM users WHERE id = ?',
    targetTable: 'users'
  });
  assert.equal(res4.allowed, true);
});

test('Maude Lemaire Guardrails - Product-Aware Load Shedding & Fan-out Caps', () => {
  // Under EMERGENCY load, emoji reaction is dropped
  const emojiDrop = evaluateLoadShedding({
    loadLevel: 'EMERGENCY',
    eventType: 'emoji_reaction'
  });
  assert.equal(emojiDrop.action, 'SHED_EVENT');
  assert.equal(emojiDrop.allowed, false);

  // Under EMERGENCY load, critical text message and gate eval are preserved
  const textKeep = evaluateLoadShedding({
    loadLevel: 'EMERGENCY',
    eventType: 'text_message'
  });
  assert.equal(textKeep.action, 'DELIVER_EVENT');
  assert.equal(textKeep.allowed, true);

  const gateKeep = evaluateLoadShedding({
    loadLevel: 'EMERGENCY',
    eventType: 'gate_eval'
  });
  assert.equal(gateKeep.action, 'DELIVER_EVENT');
  assert.equal(gateKeep.allowed, true);

  // Under HIGH load, sheddable typing indicator is dropped
  const typingDrop = evaluateLoadShedding({
    loadLevel: 'HIGH',
    eventType: 'typing_indicator'
  });
  assert.equal(typingDrop.action, 'SHED_EVENT');
  assert.equal(typingDrop.allowed, false);

  // Product caps: 50 distinct emojis capped at 23
  const capTest = evaluateLoadShedding({
    loadLevel: 'NORMAL',
    eventType: 'emoji_reaction',
    requestedCount: 50
  });
  assert.equal(capTest.capped, true);
  assert.equal(capTest.adjustedCount, 23);
  assert.equal(capTest.displayString, '23');

  // Unbounded list display: count > 99 renders as 99+
  const displayTest = evaluateLoadShedding({
    loadLevel: 'NORMAL',
    eventType: 'audit_log',
    requestedCount: 1500
  });
  assert.equal(displayTest.displayString, '99+');
});

test('Maude Lemaire Guardrails - Zero-Downtime Migration State Machine', () => {
  // Skipping phases is blocked
  const skipAttempt = evaluateMigrationPhase({
    currentPhase: MIGRATION_PHASES.ISOLATED_WRAPPER,
    nextPhase: MIGRATION_PHASES.SHADOW_READ
  });
  assert.equal(skipAttempt.allowed, false);

  // Advancing to SHADOW_READ without double-write active is blocked
  const prematureShadow = evaluateMigrationPhase({
    currentPhase: MIGRATION_PHASES.BACKFILL,
    nextPhase: MIGRATION_PHASES.SHADOW_READ,
    doubleWriteActive: false,
    backfillComplete: true
  });
  assert.equal(prematureShadow.allowed, false);

  // Advancing to SHADOW_READ without backfill complete is blocked
  const incompleteBackfill = evaluateMigrationPhase({
    currentPhase: MIGRATION_PHASES.BACKFILL,
    nextPhase: MIGRATION_PHASES.SHADOW_READ,
    doubleWriteActive: true,
    backfillComplete: false
  });
  assert.equal(incompleteBackfill.allowed, false);

  // Advancing to READ_CUTOVER with shadow read discrepancies (<100% parity) is blocked
  const discrepancyCutover = evaluateMigrationPhase({
    currentPhase: MIGRATION_PHASES.SHADOW_READ,
    nextPhase: MIGRATION_PHASES.READ_CUTOVER,
    shadowReadParity: 0.985
  });
  assert.equal(discrepancyCutover.allowed, false);

  // Valid cutover with 100% parity succeeds
  const cleanCutover = evaluateMigrationPhase({
    currentPhase: MIGRATION_PHASES.SHADOW_READ,
    nextPhase: MIGRATION_PHASES.READ_CUTOVER,
    shadowReadParity: 1.0
  });
  assert.equal(cleanCutover.allowed, true);
  assert.equal(cleanCutover.activePhase, MIGRATION_PHASES.READ_CUTOVER);
});

test('Maude Lemaire Guardrails - Centralized Trace Sampling and Protocol Load Testing', () => {
  // Scattered trace sampling across multiple services/files is rejected
  const scattered = validateTraceSamplingArchitecture({
    instrumentationSites: ['src/services/user.js', 'src/services/billing.js', 'src/exporters/datadog.js']
  });
  assert.equal(scattered.allowed, false);
  assert.equal(scattered.violation, 'SCATTERED_TRACE_SAMPLING');

  // Centralized sampling in single policy diode passes
  const centralized = validateTraceSamplingArchitecture({
    instrumentationSites: ['src/central-sampler.js']
  });
  assert.equal(centralized.allowed, true);

  // Excessive headless browser load test (50,000 pods) is blocked
  const expensiveLoadTest = validateLoadTestArchitecture({
    engineType: 'chrome-headless',
    headlessBrowserInstances: 50000
  });
  assert.equal(expensiveLoadTest.allowed, false);
  assert.equal(expensiveLoadTest.violation, 'EXCESSIVE_HEADLESS_BROWSER_LOAD_TEST');

  // Lightweight protocol-level load test runner passes
  const protocolRunner = validateLoadTestArchitecture({
    engineType: 'go',
    virtualUsers: 50000,
    headlessBrowserInstances: 0
  });
  assert.equal(protocolRunner.allowed, true);
  assert.equal(protocolRunner.isProtocolRunner, true);
});

test('Maude Lemaire Guardrails - Usage-Weighted Parallel Optimization', () => {
  // Parallelizing tasks that only 1% of users trigger is rejected as wasteful
  const badParallel = validateParallelOptimization({
    longestTaskLatencyMs: 300,
    parallelizedTasks: [
      { name: 'rare_audit_export', trafficWeight: 0.01 },
      { name: 'legacy_webhook_notify', trafficWeight: 0.02 }
    ]
  });
  assert.equal(badParallel.allowed, false);
  assert.equal(badParallel.recommendation, 'KEEP_SEQUENTIAL');

  // Parallelizing high-traffic critical paths is approved
  const goodParallel = validateParallelOptimization({
    longestTaskLatencyMs: 300,
    parallelizedTasks: [
      { name: 'session_auth', trafficWeight: 0.95 },
      { name: 'entitlement_check', trafficWeight: 0.90 }
    ]
  });
  assert.equal(goodParallel.allowed, true);
  assert.equal(goodParallel.recommendation, 'PARALLELIZE');
});
