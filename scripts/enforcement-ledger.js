'use strict';

/**
 * Read a gate-stats object without treating repeat fires as new blocks
 * or a zero pass count as a measured number of allows.
 *
 * eventBlocks is the stored fire count (stats.blocked). repeatBlocks is
 * stats.recurringBlocks, which also counts a later warn of the same action.
 * distinctBlocks subtracts those repeats and never goes below zero.
 * passesMeasured is false when no allow was written, so a report can say
 * "not recorded" instead of "0 allows".
 */
function describeEnforcementLedger(stats = {}) {
  const source = stats && typeof stats === 'object' ? stats : {};
  const eventBlocks = Math.max(0, Number(source.blocked) || 0);
  const repeatBlocks = Math.max(0, Number(source.recurringBlocks) || 0);
  const distinctBlocks = Math.max(0, eventBlocks - repeatBlocks);
  const passesRecorded = Math.max(0, Number(source.passed) || 0);
  const dailyBlocks = source.dailyBlocks && typeof source.dailyBlocks === 'object' && !Array.isArray(source.dailyBlocks)
    ? source.dailyBlocks
    : {};
  const dailyKeys = Object.keys(dailyBlocks).sort();
  return {
    eventBlocks,
    repeatBlocks,
    distinctBlocks,
    passesRecorded,
    passesMeasured: passesRecorded > 0,
    dailyBlocksNewest: dailyKeys.length ? dailyKeys[dailyKeys.length - 1] : null,
  };
}

module.exports = {
  describeEnforcementLedger,
};
