#!/usr/bin/env node
/**
 * money-watcher.js
 * Continuously polls the commercial summary for net-new paid orders or booked revenue.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getOperationalBillingSummary } = require('./operational-summary');
const { ensureParentDir } = require('./fs-utils');

const DEFAULT_STATE_PATH = path.resolve(__dirname, '..', '.thumbgate', 'commercial-watch-state.json');
const DEFAULT_ALERT_LOG_PATH = path.resolve(__dirname, '..', '.thumbgate', 'commercial-alerts.jsonl');

function getCommercialRevenueSnapshot(summary = {}) {
  const revenue = summary && typeof summary === 'object' ? summary.revenue || {} : {};
  return {
    paidOrders: revenue.paidOrders || 0,
    bookedRevenueCents: revenue.bookedRevenueCents || 0,
    latestPaidAt: revenue.latestPaidAt || null,
    latestPaidOrder: revenue.latestPaidOrder || null,
  };
}

function readSnapshotState(statePath = DEFAULT_STATE_PATH) {
  try {
    if (!fs.existsSync(statePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeSnapshotState(snapshot, statePath = DEFAULT_STATE_PATH) {
  ensureParentDir(statePath);
  fs.writeFileSync(statePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return statePath;
}

function buildCommercialAlert(previousSnapshot = {}, currentSnapshot = {}, meta = {}) {
  const newPaidOrders = (currentSnapshot.paidOrders || 0) - (previousSnapshot.paidOrders || 0);
  const newBookedRevenueCents = (currentSnapshot.bookedRevenueCents || 0) - (previousSnapshot.bookedRevenueCents || 0);

  if (newPaidOrders <= 0 && newBookedRevenueCents <= 0) {
    return null;
  }

  return {
    detectedAt: new Date().toISOString(),
    source: meta.source || null,
    fallbackReason: meta.fallbackReason || null,
    newPaidOrders,
    newBookedRevenueCents,
    latestPaidAt: currentSnapshot.latestPaidAt || null,
    latestPaidOrder: currentSnapshot.latestPaidOrder || null,
    paidOrders: currentSnapshot.paidOrders || 0,
    bookedRevenueCents: currentSnapshot.bookedRevenueCents || 0,
  };
}

function recordCommercialAlert(alert, alertLogPath = DEFAULT_ALERT_LOG_PATH) {
  ensureParentDir(alertLogPath);
  fs.appendFileSync(alertLogPath, `${JSON.stringify(alert)}\n`, 'utf8');
  return alertLogPath;
}

async function checkForCommercialChange(options = {}) {
  const statePath = options.statePath || DEFAULT_STATE_PATH;
  const alertLogPath = options.alertLogPath || DEFAULT_ALERT_LOG_PATH;
  const previousSnapshot = options.previousSnapshot || readSnapshotState(statePath) || getCommercialRevenueSnapshot();
  const summaryResolver = options.getSummary || getOperationalBillingSummary;
  const { source, summary, fallbackReason } = await summaryResolver();
  const currentSnapshot = getCommercialRevenueSnapshot(summary);
  const alert = buildCommercialAlert(previousSnapshot, currentSnapshot, {
    source,
    fallbackReason,
  });

  writeSnapshotState(currentSnapshot, statePath);
  if (alert) {
    recordCommercialAlert(alert, alertLogPath);
  }

  return {
    changed: Boolean(alert),
    alert,
    previousSnapshot,
    currentSnapshot,
    source,
    fallbackReason: fallbackReason || null,
    statePath,
    alertLogPath,
  };
}

async function watchMoney(intervalMs = 10000, options = {}) {
  console.log('👀 Money Watcher activated. Polling billing summary for commercial changes...');
  const initialState = await getOperationalBillingSummary();
  let initialSnapshot = options.initialSnapshot
    || readSnapshotState(options.statePath || DEFAULT_STATE_PATH)
    || getCommercialRevenueSnapshot(initialState.summary);
  writeSnapshotState(initialSnapshot, options.statePath || DEFAULT_STATE_PATH);
  let polling = false;

  return setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const { source, summary, fallbackReason } = await getOperationalBillingSummary();
      const currentSnapshot = getCommercialRevenueSnapshot(summary);
      const alert = buildCommercialAlert(initialSnapshot, currentSnapshot, {
        source,
        fallbackReason,
      });
      writeSnapshotState(currentSnapshot, options.statePath || DEFAULT_STATE_PATH);

      if (alert) {
        recordCommercialAlert(alert, options.alertLogPath || DEFAULT_ALERT_LOG_PATH);
        console.log('\n🚨🚨🚨 COMMERCIAL ALERT: NET-NEW PAID ACTIVITY DETECTED! 🚨🚨🚨');
        console.log('Operational billing summary:');
        console.log(JSON.stringify({
          ...alert,
          activeKeys: summary.keys.active,
          totalUsage: summary.keys.totalUsage,
        }, null, 2));

        process.stdout.write('\x07');
        initialSnapshot = currentSnapshot;
      }
    } finally {
      polling = false;
    }
  }, intervalMs);
}

function parseArgs(argv = []) {
  const options = {
    once: false,
    intervalMs: 10000,
    statePath: DEFAULT_STATE_PATH,
    alertLogPath: DEFAULT_ALERT_LOG_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '').trim();

    if (arg === '--once') {
      options.once = true;
      continue;
    }

    if (arg === '--interval-ms' && argv[index + 1]) {
      options.intervalMs = Number.parseInt(argv[index + 1], 10) || options.intervalMs;
      index += 1;
      continue;
    }

    if (arg.startsWith('--interval-ms=')) {
      options.intervalMs = Number.parseInt(arg.split('=').slice(1).join('='), 10) || options.intervalMs;
      continue;
    }

    if (arg === '--state-path' && argv[index + 1]) {
      options.statePath = path.resolve(String(argv[index + 1]));
      index += 1;
      continue;
    }

    if (arg.startsWith('--state-path=')) {
      options.statePath = path.resolve(arg.split('=').slice(1).join('='));
      continue;
    }

    if (arg === '--alert-log-path' && argv[index + 1]) {
      options.alertLogPath = path.resolve(String(argv[index + 1]));
      index += 1;
      continue;
    }

    if (arg.startsWith('--alert-log-path=')) {
      options.alertLogPath = path.resolve(arg.split('=').slice(1).join('='));
    }
  }

  return options;
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  const runner = options.once
    ? checkForCommercialChange(options).then((result) => {
      console.log(JSON.stringify(result, null, 2));
      return result;
    })
    : watchMoney(options.intervalMs, options);

  runner.catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_ALERT_LOG_PATH,
  DEFAULT_STATE_PATH,
  buildCommercialAlert,
  checkForCommercialChange,
  getCommercialRevenueSnapshot,
  parseArgs,
  readSnapshotState,
  recordCommercialAlert,
  watchMoney,
  writeSnapshotState,
};
