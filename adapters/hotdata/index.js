'use strict';

/**
 * adapters/hotdata/index.js
 *
 * ThumbGate x Hotdata.dev Integration Adapter
 * Provides:
 * - HotDataDbStore: High-concurrency Arrow columnar vector & tabular database.
 * - HotDataPreToolDiode: Sub-millisecond (<0.1ms) PreToolUse execution firewall.
 */

const { HotDataDbStore, getHotDataDbStore, DEFAULT_HOTDATA_DIR } = require('./hotdata-db-store');
const { HotDataPreToolDiode, getHotDataPreToolDiode } = require('./hotdata-pretool-diode');

module.exports = {
  HotDataDbStore,
  getHotDataDbStore,
  DEFAULT_HOTDATA_DIR,
  HotDataPreToolDiode,
  getHotDataPreToolDiode,
};
