#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const { formatLocalDate, resolveAnalyticsWindow } = require('./analytics-window');

const SCHEMA_VERSION = 1;
const MAX_SNAPSHOT_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const PROVIDERS = Object.freeze(['paypal', 'merchantOfRecord', 'githubMarketplace']);
const SOURCE_KINDS = Object.freeze({
  paypal: new Set(['provider_api_export', 'provider_api_live']),
  merchantOfRecord: new Set(['provider_api_export', 'provider_api_live']),
  githubMarketplace: new Set(['provider_api_export']),
});
const COUNTED_STATUSES = new Set(['paid', 'settled', 'completed', 'partially_refunded', 'refunded']);
const ALLOWED_STATUSES = new Set([...COUNTED_STATUSES, 'cancelled', 'canceled', 'failed']);

function normalizeBuyerEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email && email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function digestBuyerEmail(value) {
  const email = normalizeBuyerEmail(value);
  return email ? `sha256:${crypto.createHash('sha256').update(`thumbgate-buyer-email-v1:${email}`).digest('hex')}` : null;
}

function localDateRange(startLocalDate, endLocalDate) {
  const dates = [];
  const end = Date.parse(`${endLocalDate}T00:00:00.000Z`);
  for (let cursor = Date.parse(`${startLocalDate}T00:00:00.000Z`); cursor <= end; cursor += 86400000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

function canonicalProvider(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized === 'paypal') return 'paypal';
  if (normalized === 'merchantofrecord' || normalized === 'mor') return 'merchantOfRecord';
  if (normalized === 'githubmarketplace' || normalized === 'github') return 'githubMarketplace';
  return null;
}

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseTimestamp(value) {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function fail(provider, gap, extra = {}) {
  return {
    provider,
    audited: false,
    status: 'audit_incomplete',
    evidenceVerified: false,
    evidenceSource: null,
    evidenceDigest: extra.evidenceDigest || null,
    revenue: null,
    gap,
  };
}

function auditProviderSnapshot(snapshot, {
  expectedProvider,
  now,
  timeZone = 'UTC',
  evidenceDigest = null,
  evidencePath = null,
} = {}) {
  const provider = canonicalProvider(expectedProvider || snapshot?.provider);
  if (!provider || !PROVIDERS.includes(provider)) return fail(provider || expectedProvider || null, 'Unsupported revenue provider.');
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return fail(provider, 'Evidence must be one JSON object.');
  if (snapshot.schemaVersion !== SCHEMA_VERSION) return fail(provider, `schemaVersion must equal ${SCHEMA_VERSION}.`);
  if (canonicalProvider(snapshot.provider) !== provider) return fail(provider, 'Snapshot provider does not match the requested provider.');

  const nowDate = parseTimestamp(now || new Date().toISOString());
  const generatedAt = parseTimestamp(snapshot.generatedAt);
  if (!nowDate || !generatedAt) return fail(provider, 'now and generatedAt must be valid ISO timestamps.', { evidenceDigest });
  if (generatedAt.getTime() > nowDate.getTime() + MAX_FUTURE_SKEW_MS) return fail(provider, 'Snapshot generatedAt is implausibly in the future.', { evidenceDigest });
  if (nowDate.getTime() - generatedAt.getTime() > MAX_SNAPSHOT_AGE_MS) return fail(provider, 'Snapshot is stale; provider evidence must be refreshed within 24 hours.', { evidenceDigest });

  const sourceKind = String(snapshot.source?.kind || '').trim();
  const sourceReference = String(snapshot.source?.reference || '').trim();
  if (!SOURCE_KINDS[provider].has(sourceKind) || !sourceReference) {
    return fail(provider, 'A supported provider-origin source.kind and non-empty source.reference are required.', { evidenceDigest });
  }
  if (String(snapshot.currency || '').trim().toLowerCase() !== 'usd') return fail(provider, 'Only an explicit USD snapshot can enter the USD target control.', { evidenceDigest });

  let window;
  try {
    window = resolveAnalyticsWindow({ window: '30d', now: nowDate.toISOString(), timeZone });
  } catch (error) {
    return fail(provider, `Invalid audit window: ${error.message}`, { evidenceDigest });
  }
  const scope = snapshot.scope || {};
  const scopeDatePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!scopeDatePattern.test(String(scope.startLocalDate || '')) ||
      !scopeDatePattern.test(String(scope.endLocalDate || '')) ||
      scope.completeness !== 'all_transactions' || scope.timeZone !== window.timeZone ||
      String(scope.startLocalDate || '') > window.startLocalDate ||
      String(scope.endLocalDate || '') !== window.endLocalDate) {
    return fail(provider, 'Snapshot scope must attest all transactions and cover the exact trailing 30-day local-date window.', { evidenceDigest });
  }

  if (!Array.isArray(snapshot.transactions) || !Array.isArray(snapshot.subscriptions)) {
    return fail(provider, 'transactions and subscriptions must both be arrays, including for audited zero.', { evidenceDigest });
  }
  const subscriptionsComplete = scope.subscriptionsCompleteness !== 'not_audited';
  if (!subscriptionsComplete && snapshot.subscriptions.length > 0) {
    return fail(provider, 'A snapshot cannot include subscriptions while declaring subscription state not audited.', { evidenceDigest });
  }

  const dates = localDateRange(window.startLocalDate, window.endLocalDate);
  const dailyGrossRevenueCents = Object.fromEntries(dates.map((date) => [date, 0]));
  const dailyNetRevenueCents = Object.fromEntries(dates.map((date) => [date, 0]));
  const transactionIds = new Set();
  const payingCustomers = new Set();
  let transactionCount = 0;

  for (const [index, transaction] of snapshot.transactions.entries()) {
    const id = String(transaction?.id || '').trim();
    const status = String(transaction?.status || '').trim().toLowerCase();
    const createdAt = parseTimestamp(transaction?.createdAt);
    const grossCents = integer(transaction?.grossCents);
    const refundedCents = integer(transaction?.refundedCents);
    const customerId = String(transaction?.customerId || '').trim();
    const attributed = transaction?.productAttribution?.verified === true &&
      String(transaction?.productAttribution?.product || '').trim().toLowerCase() === 'thumbgate';
    const external = transaction?.customerClassification === 'external' && transaction?.ownerTest === false;
    if (!id || transactionIds.has(id)) return fail(provider, `Transaction ${index} has a missing or duplicate provider ID.`, { evidenceDigest });
    transactionIds.add(id);
    if (!ALLOWED_STATUSES.has(status)) return fail(provider, `Transaction ${id} has an unsupported status.`, { evidenceDigest });
    if (!createdAt || createdAt.getTime() > nowDate.getTime() + MAX_FUTURE_SKEW_MS) return fail(provider, `Transaction ${id} has an invalid or future createdAt.`, { evidenceDigest });
    if (grossCents === null || refundedCents === null || refundedCents > grossCents) return fail(provider, `Transaction ${id} has invalid gross/refund cents.`, { evidenceDigest });
    if (status === 'refunded' && refundedCents !== grossCents) return fail(provider, `Transaction ${id} is marked refunded but is not fully refunded.`, { evidenceDigest });
    if (status === 'partially_refunded' && (refundedCents === 0 || refundedCents === grossCents)) return fail(provider, `Transaction ${id} has an inconsistent partial-refund status.`, { evidenceDigest });
    if (!customerId || !attributed || !external) return fail(provider, `Transaction ${id} lacks verified ThumbGate attribution or external-customer evidence.`, { evidenceDigest });
    if (!COUNTED_STATUSES.has(status)) continue;
    const localDate = formatLocalDate(createdAt, window.timeZone);
    if (!(localDate in dailyGrossRevenueCents)) continue;
    const netCents = grossCents - refundedCents;
    dailyGrossRevenueCents[localDate] += grossCents;
    dailyNetRevenueCents[localDate] += netCents;
    transactionCount += 1;
    if (netCents > 0) payingCustomers.add(customerId);
  }

  const subscriptionIds = new Set();
  const activeSubscriptionCustomers = new Set();
  let activeSubscriptionCount = 0;
  let mrrCents = 0;
  for (const [index, subscription] of snapshot.subscriptions.entries()) {
    const id = String(subscription?.id || '').trim();
    const status = String(subscription?.status || '').trim().toLowerCase();
    const customerId = String(subscription?.customerId || '').trim();
    const monthlyCents = integer(subscription?.mrrCents);
    const attributed = subscription?.productAttribution?.verified === true &&
      String(subscription?.productAttribution?.product || '').trim().toLowerCase() === 'thumbgate';
    const external = subscription?.customerClassification === 'external' && subscription?.ownerTest === false;
    if (!id || subscriptionIds.has(id)) return fail(provider, `Subscription ${index} has a missing or duplicate provider ID.`, { evidenceDigest });
    subscriptionIds.add(id);
    if (!['active', 'trialing', 'cancelled', 'canceled', 'past_due'].includes(status)) return fail(provider, `Subscription ${id} has an unsupported status.`, { evidenceDigest });
    if (monthlyCents === null || !customerId || !attributed || !external) return fail(provider, `Subscription ${id} lacks valid MRR, attribution, or external-customer evidence.`, { evidenceDigest });
    if (status !== 'active') continue;
    activeSubscriptionCount += 1;
    mrrCents += monthlyCents;
    activeSubscriptionCustomers.add(customerId);
  }

  const todayGrossRevenueCents = dailyGrossRevenueCents[window.endLocalDate];
  const todayNetRevenueCents = dailyNetRevenueCents[window.endLocalDate];
  const trailing30DayGrossRevenueCents = Object.values(dailyGrossRevenueCents).reduce((sum, value) => sum + value, 0);
  const trailing30DayNetRevenueCents = Object.values(dailyNetRevenueCents).reduce((sum, value) => sum + value, 0);
  for (const customerId of activeSubscriptionCustomers) payingCustomers.add(customerId);

  return {
    provider,
    audited: true,
    status: 'provider_snapshot_audited',
    evidenceVerified: true,
    evidenceSource: `${sourceKind}:${sourceReference}`,
    evidenceDigest,
    evidencePath,
    gap: null,
    revenue: {
      verified: true,
      currency: 'usd',
      basis: 'provider-origin all-transactions snapshot; refunds assigned to original transaction cohort',
      timeZone: window.timeZone,
      todayLocalDate: window.endLocalDate,
      trailing30DayStartLocalDate: window.startLocalDate,
      todayGrossRevenueCents,
      todayNetRevenueCents,
      trailing30DayGrossRevenueCents,
      trailing30DayNetRevenueCents,
      dailyGrossRevenueCents,
      dailyNetRevenueCents,
      externalMrrCents: subscriptionsComplete ? mrrCents : null,
      activeExternalSubscriptions: subscriptionsComplete ? activeSubscriptionCount : null,
      externalPayingCustomerIdentities: payingCustomers.size,
      countedTransactionCount: transactionCount,
    },
  };
}

function auditProviderSnapshotFile(filePath, options = {}) {
  const provider = canonicalProvider(options.expectedProvider);
  if (!filePath) return fail(provider, `${provider} evidence path was not provided.`);
  let raw;
  try {
    raw = fs.readFileSync(filePath);
  } catch (error) {
    return fail(provider, `Could not read provider evidence: ${error.message}`);
  }
  const evidenceDigest = `sha256:${crypto.createHash('sha256').update(raw).digest('hex')}`;
  let snapshot;
  try {
    snapshot = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    return fail(provider, `Provider evidence is not valid JSON: ${error.message}`, { evidenceDigest });
  }
  return auditProviderSnapshot(snapshot, { ...options, evidenceDigest, evidencePath: filePath });
}

function auditProviderEvidenceFiles({ paths = {}, now, timeZone } = {}) {
  return Object.fromEntries(PROVIDERS.map((provider) => [
    provider,
    auditProviderSnapshotFile(paths[provider], { expectedProvider: provider, now, timeZone }),
  ]));
}

module.exports = {
  MAX_SNAPSHOT_AGE_MS,
  PROVIDERS,
  SCHEMA_VERSION,
  auditProviderEvidenceFiles,
  auditProviderSnapshot,
  auditProviderSnapshotFile,
  canonicalProvider,
  digestBuyerEmail,
  normalizeBuyerEmail,
};
