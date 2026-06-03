// tests/repeat-metric.test.js
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const gatesEngine = require('../scripts/gates-engine');
const {
  computeRepeatMetric,
  mergeRepeatMetricIntoGateStats,
} = require('../scripts/repeat-metric');

const ORIGINAL_STATS_PATH = gatesEngine.STATS_PATH;
let tmpFiles = [];

/**
 * Write a stats object to a fresh tmp file and point gates-engine.loadStats()
 * at it by overriding module.exports.STATS_PATH (loadStats reads that field).
 */
function useStats(stats) {
  const file = path.join(
    os.tmpdir(),
    `repeat-metric-stats-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(stats));
  tmpFiles.push(file);
  gatesEngine.STATS_PATH = file;
}

afterEach(() => {
  gatesEngine.STATS_PATH = ORIGINAL_STATS_PATH;
  for (const f of tmpFiles) {
    try { fs.unlinkSync(f); } catch (_) { /* ignore */ }
  }
  tmpFiles = [];
});

// (1) headline == recurringBlocks
test('computeRepeatMetric: recurringBlocks=3 -> repeatBlocksBeforeExecution===3', () => {
  useStats({
    blocked: 10,
    warned: 2,
    passed: 0,
    recurringBlocks: 3,
    byGate: { 'secret-exfiltration': { blocked: 10, warned: 0 } },
  });
  const m = computeRepeatMetric();
  assert.strictEqual(m.repeatBlocksBeforeExecution, 3);
  assert.strictEqual(m.recurringBlocks, 3);
  assert.strictEqual(m.totalBlocked, 10);
});

// (2) byGate split: a gate that fired multiple times in one session bucket
//     yields repeatBlocks >= 1.
test('computeRepeatMetric: byGate split marks repeat for a re-fired gate', () => {
  useStats({
    blocked: 4,
    warned: 0,
    recurringBlocks: 2,
    // gate fired in exactly one session bucket => firstBlocks = 1
    sessionFiredGates: {
      session_1: { 'no-force-push': true },
    },
    // total fires for the gate = 3 (blocked) => repeatBlocks = 3 - 1 = 2
    byGate: { 'no-force-push': { blocked: 3, warned: 0 } },
  });
  const m = computeRepeatMetric();
  assert.ok(m.byGate['no-force-push'], 'gate present in byGate');
  assert.strictEqual(m.byGate['no-force-push'].firstBlocks, 1);
  assert.ok(
    m.byGate['no-force-push'].repeatBlocks >= 1,
    `expected repeatBlocks>=1, got ${m.byGate['no-force-push'].repeatBlocks}`,
  );
  assert.strictEqual(m.byGate['no-force-push'].repeatBlocks, 2);
});

test('computeRepeatMetric: action fingerprints drive modern byGate split', () => {
  useStats({
    blocked: 4,
    warned: 0,
    recurringBlocks: 1,
    sessionFiredActions: {
      session_1: {
        'memory-high-risk-default-deny': {
          action_a: true,
          action_b: true,
          action_c: true,
        },
      },
    },
    byGate: { 'memory-high-risk-default-deny': { blocked: 4, warned: 0 } },
  });
  const m = computeRepeatMetric();
  assert.strictEqual(m.byGate['memory-high-risk-default-deny'].firstBlocks, 3);
  assert.strictEqual(m.byGate['memory-high-risk-default-deny'].repeatBlocks, 1);
});

test('computeRepeatMetric: action stats override legacy gate-only recurrence', () => {
  useStats({
    blocked: 2,
    warned: 0,
    recurringBlocks: 0,
    sessionFiredGates: {
      session_1: { 'retrieval_entropy_high': true },
    },
    sessionFiredActions: {
      session_1: {
        retrieval_entropy_high: {
          stable_action: true,
          other_action: true,
        },
      },
    },
    byGate: { retrieval_entropy_high: { blocked: 2, warned: 0 } },
  });
  const m = computeRepeatMetric();
  assert.strictEqual(m.byGate.retrieval_entropy_high.firstBlocks, 2);
  assert.strictEqual(m.byGate.retrieval_entropy_high.repeatBlocks, 0);
});

// (2b) a gate fired across two distinct session buckets but only once each is
//      all first-blocks, no repeats.
test('computeRepeatMetric: distinct-session first fires yield zero repeats', () => {
  useStats({
    blocked: 2,
    recurringBlocks: 0,
    sessionFiredGates: {
      session_1: { 'plan-gate': true },
      session_2: { 'plan-gate': true },
    },
    byGate: { 'plan-gate': { blocked: 2, warned: 0 } },
  });
  const m = computeRepeatMetric();
  assert.strictEqual(m.byGate['plan-gate'].firstBlocks, 2);
  assert.strictEqual(m.byGate['plan-gate'].repeatBlocks, 0);
});

// (3) zero-state: empty stats -> all zeros, no throw.
test('computeRepeatMetric: empty stats -> all zeros, no throw', () => {
  useStats({});
  const m = computeRepeatMetric();
  assert.strictEqual(m.repeatBlocksBeforeExecution, 0);
  assert.strictEqual(m.recurringBlocks, 0);
  assert.strictEqual(m.totalBlocked, 0);
  assert.deepStrictEqual(m.byGate, {});
});

// (4) mergeRepeatMetricIntoGateStats preserves all original keys and adds repeat.
test('mergeRepeatMetricIntoGateStats: preserves keys, adds repeat, no mutation', () => {
  useStats({ blocked: 5, warned: 1, recurringBlocks: 1, byGate: {} });
  const original = {
    blocked: 5,
    warned: 1,
    passed: 99,
    byGate: { foo: { blocked: 1 } },
  };
  const snapshot = JSON.parse(JSON.stringify(original));
  const merged = mergeRepeatMetricIntoGateStats(original);

  assert.strictEqual(merged.blocked, 5);
  assert.strictEqual(merged.warned, 1);
  assert.strictEqual(merged.passed, 99);
  assert.deepStrictEqual(merged.byGate, { foo: { blocked: 1 } });
  assert.ok(merged.repeat, 'repeat sub-key added');
  assert.strictEqual(merged.repeat.repeatBlocksBeforeExecution, 1);

  // Original object must not be mutated.
  assert.deepStrictEqual(original, snapshot);
});

// (4b) merge handles non-object / undefined input without throwing.
test('mergeRepeatMetricIntoGateStats: undefined input -> object with repeat', () => {
  useStats({ recurringBlocks: 0 });
  const merged = mergeRepeatMetricIntoGateStats(undefined);
  assert.ok(merged && typeof merged === 'object');
  assert.ok(merged.repeat);
  assert.strictEqual(merged.repeat.repeatBlocksBeforeExecution, 0);
});
