#!/usr/bin/env node
/**
 * money-watcher.js
 * Polls hosted commercial counters and exact product-attributed Stripe truth.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getOperationalBillingSummary } = require('./operational-summary');
const { runAudit: auditExternalCustomers } = require('./external-customer-audit');
const { ensureParentDir } = require('./fs-utils');

const DEFAULT_STATE_PATH = path.resolve(__dirname, '..', '.thumbgate', 'commercial-watch-state.json');
const DEFAULT_ALERT_LOG_PATH = path.resolve(__dirname, '..', '.thumbgate', 'commercial-alerts.jsonl');
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

function safeLogValue(value, maxLength = 4000) {
  return String(value ?? '')
    .replace(/\\[rnt]/g, ' ')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, maxLength);
}

function safeLogJson(value, maxLength = 4000) {
  return safeLogValue(JSON.stringify(value, null, 2), maxLength);
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function buildLogSafeSnapshot(summary = {}) {
  const revenue = summary && typeof summary === 'object'
    ? summary.currentSnapshot || summary.revenue || {}
    : {};
  const stripe = revenue.stripeProductAttribution || {};
  return {
    source: safeLogValue(summary.source, 120),
    fallbackReason: safeLogValue(summary.fallbackReason, 240),
    generatedAt: safeLogValue(summary.generatedAt, 80),
    revenue: {
      paidOrders: safeNumber(revenue.paidOrders),
      bookedRevenueCents: safeNumber(revenue.bookedRevenueCents),
      latestPaidAt: safeLogValue(revenue.latestPaidAt, 80),
      hasLatestPaidOrder: Boolean(revenue.latestPaidOrder),
    },
    stripeProductAttribution: {
      verified: stripe.verified === true,
      catalogVersion: safeLogValue(stripe.catalogVersion, 120) || null,
      payingCustomerCount: safeNumber(stripe.payingCustomerCount),
      netRevenueCents: safeNumber(stripe.netRevenueCents),
      activeSubscriptionCount: safeNumber(stripe.activeSubscriptionCount),
      mrrCents: safeNumber(stripe.mrrCents),
      todayNetRevenueCents: safeNumber(stripe.todayNetRevenueCents),
    },
  };
}

function buildLogSafeAlert(alert = {}, summary = {}) {
  return {
    detectedAt: safeLogValue(alert.detectedAt, 80),
    source: safeLogValue(alert.source, 120),
    fallbackReason: safeLogValue(alert.fallbackReason, 240),
    newPaidOrders: safeNumber(alert.newPaidOrders),
    newBookedRevenueCents: safeNumber(alert.newBookedRevenueCents),
    verifiedPaymentDetected: alert.verifiedPaymentDetected === true,
    hostedActivityDetected: alert.hostedActivityDetected === true,
    newProductAttributedCustomerCount: safeNumber(alert.newProductAttributedCustomerCount),
    newProductAttributedNetRevenueCents: safeNumber(alert.newProductAttributedNetRevenueCents),
    newProductAttributedActiveSubscriptionCount: safeNumber(alert.newProductAttributedActiveSubscriptionCount),
    newProductAttributedMrrCents: safeNumber(alert.newProductAttributedMrrCents),
    stripeCatalogVersion: safeLogValue(alert.stripeCatalogVersion, 120) || null,
    latestPaidAt: safeLogValue(alert.latestPaidAt, 80),
    hasLatestPaidOrder: Boolean(alert.latestPaidOrder),
    paidOrders: safeNumber(alert.paidOrders),
    bookedRevenueCents: safeNumber(alert.bookedRevenueCents),
    activeKeys: safeNumber(summary.keys?.active),
    totalUsage: safeNumber(summary.keys?.totalUsage),
  };
}

function getProductAttributedStripeSnapshot(audit = {}) {
  const attribution = audit && typeof audit === 'object' ? audit.productAttribution || {} : {};
  const thumbgate = attribution.thumbgate || {};
  const verified = attribution.verified === true;
  return {
    verified,
    catalogVersion: safeLogValue(attribution.catalogVersion, 120) || null,
    payingCustomerCount: verified ? safeNumber(thumbgate.uniquePayingCustomerCount) : 0,
    netRevenueCents: verified ? safeNumber(thumbgate.netRevenueCents) : 0,
    activeSubscriptionCount: verified ? safeNumber(thumbgate.activeSubscriptionCount) : 0,
    mrrCents: verified ? safeNumber(thumbgate.mrrCents) : 0,
    todayNetRevenueCents: verified ? safeNumber(thumbgate.revenueWindows?.todayNetRevenueCents) : 0,
  };
}

function getCommercialRevenueSnapshot(summary = {}, stripeAudit = {}) {
  const revenue = summary && typeof summary === 'object' ? summary.revenue || {} : {};
  return {
    paidOrders: revenue.paidOrders || 0,
    bookedRevenueCents: revenue.bookedRevenueCents || 0,
    latestPaidAt: revenue.latestPaidAt || null,
    latestPaidOrder: revenue.latestPaidOrder || null,
    stripeProductAttribution: getProductAttributedStripeSnapshot(stripeAudit),
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
  const previousStripe = previousSnapshot.stripeProductAttribution || {};
  const currentStripe = currentSnapshot.stripeProductAttribution || {};
  const newProductAttributedCustomerCount =
    safeNumber(currentStripe.payingCustomerCount) - safeNumber(previousStripe.payingCustomerCount);
  const newProductAttributedNetRevenueCents =
    safeNumber(currentStripe.netRevenueCents) - safeNumber(previousStripe.netRevenueCents);
  const newProductAttributedActiveSubscriptionCount =
    safeNumber(currentStripe.activeSubscriptionCount) - safeNumber(previousStripe.activeSubscriptionCount);
  const newProductAttributedMrrCents =
    safeNumber(currentStripe.mrrCents) - safeNumber(previousStripe.mrrCents);
  const hostedActivityDetected = newPaidOrders > 0 || newBookedRevenueCents > 0;
  const verifiedPaymentDetected = previousStripe.verified === true && currentStripe.verified === true &&
    (newProductAttributedCustomerCount > 0 || newProductAttributedNetRevenueCents > 0 ||
      newProductAttributedActiveSubscriptionCount > 0 || newProductAttributedMrrCents > 0);

  if (!hostedActivityDetected && !verifiedPaymentDetected) {
    return null;
  }

  return {
    detectedAt: new Date().toISOString(),
    source: meta.source || null,
    fallbackReason: meta.fallbackReason || null,
    newPaidOrders,
    newBookedRevenueCents,
    verifiedPaymentDetected,
    hostedActivityDetected,
    newProductAttributedCustomerCount,
    newProductAttributedNetRevenueCents,
    newProductAttributedActiveSubscriptionCount,
    newProductAttributedMrrCents,
    stripeCatalogVersion: currentStripe.catalogVersion || null,
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

async function resolveCommercialState(options = {}) {
  const summaryResolver = options.getSummary || getOperationalBillingSummary;
  const externalAuditResolver = options.getExternalAudit ||
    (options.getSummary ? async () => ({}) : auditExternalCustomers);
  const [billing, stripeAudit] = await Promise.all([
    summaryResolver(),
    externalAuditResolver().catch(() => ({})),
  ]);
  const { source, summary, fallbackReason } = billing;
  return {
    source,
    summary,
    fallbackReason: fallbackReason || null,
    stripeAudit,
    snapshot: getCommercialRevenueSnapshot(summary, stripeAudit),
  };
}

async function checkForCommercialChange(options = {}) {
  const statePath = options.statePath || DEFAULT_STATE_PATH;
  const alertLogPath = options.alertLogPath || DEFAULT_ALERT_LOG_PATH;
  const previousSnapshot = options.previousSnapshot || readSnapshotState(statePath) || getCommercialRevenueSnapshot();
  const { source, summary, fallbackReason, snapshot: effectiveSnapshot } = await resolveCommercialState(options);
  const alert = buildCommercialAlert(previousSnapshot, effectiveSnapshot, {
    source,
    fallbackReason,
  });

  writeSnapshotState(effectiveSnapshot, statePath);
  if (alert) {
    recordCommercialAlert(alert, alertLogPath);
  }

  return {
    changed: Boolean(alert),
    alert,
    previousSnapshot,
    currentSnapshot: effectiveSnapshot,
    source,
    fallbackReason: fallbackReason || null,
    generatedAt: safeLogValue(summary?.generatedAt, 80) || new Date().toISOString(),
    statePath,
    alertLogPath,
  };
}

async function watchMoney(intervalMs = DEFAULT_INTERVAL_MS, options = {}) {
  console.log('👀 Money Watcher activated. Polling billing summary for commercial changes...');
  const initialState = await resolveCommercialState(options);
  let initialSnapshot = options.initialSnapshot
    || readSnapshotState(options.statePath || DEFAULT_STATE_PATH)
    || initialState.snapshot;
  writeSnapshotState(initialSnapshot, options.statePath || DEFAULT_STATE_PATH);
  let polling = false;

  return setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const { source, summary, fallbackReason, snapshot: currentSnapshot } = await resolveCommercialState(options);
      const alert = buildCommercialAlert(initialSnapshot, currentSnapshot, {
        source,
        fallbackReason,
      });
      writeSnapshotState(currentSnapshot, options.statePath || DEFAULT_STATE_PATH);

      if (alert) {
        recordCommercialAlert(alert, options.alertLogPath || DEFAULT_ALERT_LOG_PATH);
        console.log(alert.verifiedPaymentDetected
          ? '\n🚨 VERIFIED THUMBGATE PAYMENT ACTIVITY DETECTED'
          : '\n⚠️ HOSTED COMMERCIAL ACTIVITY REQUIRES PROVIDER RECONCILIATION');
        console.log('Operational billing summary:');
        console.log(safeLogJson(buildLogSafeAlert(alert, summary)));

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
    intervalMs: DEFAULT_INTERVAL_MS,
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
      console.log(safeLogJson(buildLogSafeSnapshot(result)));
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
  DEFAULT_INTERVAL_MS,
  DEFAULT_STATE_PATH,
  buildCommercialAlert,
  checkForCommercialChange,
  getCommercialRevenueSnapshot,
  getProductAttributedStripeSnapshot,
  parseArgs,
  readSnapshotState,
  recordCommercialAlert,
  buildLogSafeAlert,
  buildLogSafeSnapshot,
  safeLogJson,
  safeLogValue,
  resolveCommercialState,
  watchMoney,
  writeSnapshotState,
};
