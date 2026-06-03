'use strict';

// ---------------------------------------------------------------------------
// repeat-metric — first-class "repeat-attempts blocked before execution" metric
//
// This module exposes data ThumbGate already collects in gate-stats state. It
// does NOT write to disk; it is a pure function over gates-engine.loadStats().
//
// The headline number is stats.recurringBlocks — incremented by recordStat()
// in gates-engine.js every time the same gate blocks/warns the same sanitized
// action fingerprint within one session bucket. That is "a pre-action gate fire
// that stopped a tool call the agent had already been blocked on", rather than
// merely "the same noisy gate fired again."
// ---------------------------------------------------------------------------

const gatesEngine = require('./gates-engine');

/**
 * Derive a per-gate { firstBlocks, repeatBlocks } split from the raw stats.
 *
 * Modern stats record, per session bucket, which sanitized action fingerprints
 * each gate fired on:
 *   stats.sessionFiredActions[sessionKey][gateId][fingerprint] === true
 *
 * firstBlocks is the count of distinct first action fingerprints. Legacy stats
 * without fingerprints fall back to the old per-session-gate split.
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
  const sessionFiredActions = (stats && stats.sessionFiredActions) || {};
  const sessionFiredGates = (stats && stats.sessionFiredGates) || {};
  const rawByGate = (stats && stats.byGate) || {};

  // Count distinct action fingerprints each gate fired on => firstBlocks.
  const firstBlocksByGate = {};
  const gatesWithActionStats = new Set();
  for (const sessionKey of Object.keys(sessionFiredActions)) {
    const fired = sessionFiredActions[sessionKey] || {};
    for (const gateId of Object.keys(fired)) {
      const fingerprints = fired[gateId] || {};
      const count = Object.values(fingerprints).filter(Boolean).length;
      if (count > 0) {
        gatesWithActionStats.add(gateId);
        firstBlocksByGate[gateId] = (firstBlocksByGate[gateId] || 0) + count;
      }
    }
  }

  // Legacy fallback: old stats only tracked gate fired per session bucket.
  for (const sessionKey of Object.keys(sessionFiredGates)) {
    const fired = sessionFiredGates[sessionKey] || {};
    for (const gateId of Object.keys(fired)) {
      if (fired[gateId] && !gatesWithActionStats.has(gateId)) {
        firstBlocksByGate[gateId] = (firstBlocksByGate[gateId] || 0) + 1;
      }
    }
  }

  // Union of every gate id we know about from either source.
  const gateIds = new Set([
    ...Object.keys(rawByGate),
    ...Object.keys(firstBlocksByGate),
    ...Object.keys(sessionFiredActions).flatMap((sessionKey) => Object.keys(sessionFiredActions[sessionKey] || {})),
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
