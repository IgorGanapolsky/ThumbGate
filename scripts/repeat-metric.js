'use strict';

// ---------------------------------------------------------------------------
// repeat-metric — first-class "repeat-attempts blocked before execution" metric
//
// This module exposes data ThumbGate already collects in gate-stats state. It
// does NOT write to disk; it is a pure function over gates-engine.loadStats().
//
// The headline number is stats.recurringBlocks — incremented by recordStat()
// in gates-engine.js every time the SAME gateId fires twice within one session
// bucket. That is exactly "a pre-action gate fire that stopped a tool call the
// agent had already been blocked on", i.e. a repeat attempt prevented before it
// could round-trip and execute.
// ---------------------------------------------------------------------------

const gatesEngine = require('./gates-engine');

/**
 * Derive a per-gate { firstBlocks, repeatBlocks } split from the raw stats.
 *
 * recordStat() records, per session bucket, which gates have fired
 * (stats.sessionFiredGates[sessionKey][gateId] === true). The FIRST fire of a
 * gate in a bucket marks the flag; every subsequent fire in that same bucket
 * increments stats.recurringBlocks. So for each gate:
 *   firstBlocks  = number of distinct session buckets the gate fired in
 *   repeatBlocks = (total block+warn events for the gate) - firstBlocks
 *
 * total block+warn events come from stats.byGate[id] (blocked + warned), which
 * recordStat() also maintains. repeatBlocks is clamped to >= 0 to stay robust
 * against partially-written / legacy state.
 *
 * @param {object} stats raw object returned by gates-engine.loadStats()
 * @returns {Object<string,{firstBlocks:number, repeatBlocks:number}>}
 */
function computeByGateSplit(stats) {
  const byGate = {};
  const sessionFiredGates = (stats && stats.sessionFiredGates) || {};
  const rawByGate = (stats && stats.byGate) || {};

  // Count distinct session buckets each gate fired in => firstBlocks.
  const firstBlocksByGate = {};
  for (const sessionKey of Object.keys(sessionFiredGates)) {
    const fired = sessionFiredGates[sessionKey] || {};
    for (const gateId of Object.keys(fired)) {
      if (fired[gateId]) {
        firstBlocksByGate[gateId] = (firstBlocksByGate[gateId] || 0) + 1;
      }
    }
  }

  // Union of every gate id we know about from either source.
  const gateIds = new Set([
    ...Object.keys(rawByGate),
    ...Object.keys(firstBlocksByGate),
  ]);

  for (const gateId of gateIds) {
    const gateStat = rawByGate[gateId] || {};
    const totalFires = (gateStat.blocked || 0) + (gateStat.warned || 0);
    const firstBlocks = firstBlocksByGate[gateId] || 0;
    // Repeat fires are total fires beyond the first fire per session bucket.
    const repeatBlocks = Math.max(0, totalFires - firstBlocks);
    byGate[gateId] = { firstBlocks, repeatBlocks };
  }

  return byGate;
}

/**
 * Compute the repeat-attempts-blocked-before-execution metric.
 *
 * Pure read of gates-engine.loadStats(); no disk writes.
 *
 * @returns {{
 *   repeatBlocksBeforeExecution: number,
 *   recurringBlocks: number,
 *   totalBlocked: number,
 *   byGate: Object<string,{firstBlocks:number, repeatBlocks:number}>
 * }}
 */
function computeRepeatMetric() {
  let stats;
  try {
    stats = gatesEngine.loadStats() || {};
  } catch (_) {
    stats = {};
  }

  const recurringBlocks = Number(stats.recurringBlocks || 0);
  const totalBlocked = Number(stats.blocked || 0);

  return {
    // Headline: a pre-action block that stopped a tool call the agent had
    // already been blocked on this session.
    repeatBlocksBeforeExecution: recurringBlocks,
    recurringBlocks,
    totalBlocked,
    byGate: computeByGateSplit(stats),
  };
}

/**
 * Add a `repeat` sub-key to a gate-stats object WITHOUT mutating the original.
 *
 * Takes the object returned by gate-stats.calculateStats() or
 * dashboard.computeGateStats() and returns a shallow copy with the repeat
 * metric attached. The caller's file does not need to import any internals.
 *
 * @param {object} gateStatsObject
 * @returns {object} copy of gateStatsObject with `.repeat`
 */
function mergeRepeatMetricIntoGateStats(gateStatsObject) {
  const base = gateStatsObject && typeof gateStatsObject === 'object' ? gateStatsObject : {};
  return Object.assign({}, base, { repeat: computeRepeatMetric() });
}

module.exports = {
  computeRepeatMetric,
  mergeRepeatMetricIntoGateStats,
  computeByGateSplit,
};
