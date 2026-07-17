'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  auditProviderEvidenceFiles,
  auditProviderSnapshot,
  auditProviderSnapshotFile,
  canonicalProvider,
  digestBuyerEmail,
  normalizeBuyerEmail,
} = require('../scripts/provider-revenue-evidence');

const NOW = '2026-07-15T16:00:00.000Z';

test('buyer email binding is case-insensitive, deterministic, and rejects invalid contact paths', () => {
  assert.equal(normalizeBuyerEmail(' Buyer@Example.COM '), 'buyer@example.com');
  assert.equal(digestBuyerEmail(' Buyer@Example.COM '), digestBuyerEmail('buyer@example.com'));
  assert.match(digestBuyerEmail('buyer@example.com'), /^sha256:[a-f0-9]{64}$/);
  assert.equal(normalizeBuyerEmail('not-an-email'), null);
  assert.equal(digestBuyerEmail('not-an-email'), null);
});

function snapshot(provider = 'paypal') {
  return {
    schemaVersion: 1,
    provider,
    generatedAt: '2026-07-15T15:55:00.000Z',
    source: {
      kind: 'provider_api_export',
      reference: `${provider}-report-2026-07-15`,
    },
    currency: 'usd',
    scope: {
      completeness: 'all_transactions',
      timeZone: 'America/New_York',
      startLocalDate: '2026-06-16',
      endLocalDate: '2026-07-15',
    },
    transactions: [],
    subscriptions: [],
  };
}

function audit(value, provider = 'paypal') {
  return auditProviderSnapshot(value, {
    expectedProvider: provider,
    now: NOW,
    timeZone: 'America/New_York',
    evidenceDigest: 'sha256:test',
  });
}

function paidTransaction(overrides = {}) {
  return {
    id: 'txn-1',
    status: 'completed',
    createdAt: '2026-07-15T14:00:00.000Z',
    grossCents: 100000,
    refundedCents: 25000,
    customerId: 'external-customer-1',
    customerClassification: 'external',
    ownerTest: false,
    productAttribution: { verified: true, product: 'thumbgate' },
    ...overrides,
  };
}

test('provider aliases normalize without widening the provider allowlist', () => {
  assert.equal(canonicalProvider('merchant_of_record'), 'merchantOfRecord');
  assert.equal(canonicalProvider('github-marketplace'), 'githubMarketplace');
  assert.equal(canonicalProvider('stripe'), null);
});

test('fresh provider-origin audited zero is explicit zero rather than missing evidence', () => {
  const result = audit(snapshot());
  assert.equal(result.audited, true);
  assert.equal(result.revenue.trailing30DayGrossRevenueCents, 0);
  assert.equal(result.revenue.todayNetRevenueCents, 0);
  assert.equal(Object.keys(result.revenue.dailyGrossRevenueCents).length, 30);
});

test('paid transactions reconcile gross, refunds, customer identities, and original-date cohorts', () => {
  const value = snapshot();
  value.transactions.push(paidTransaction());
  const result = audit(value);
  assert.equal(result.audited, true);
  assert.equal(result.revenue.todayGrossRevenueCents, 100000);
  assert.equal(result.revenue.todayNetRevenueCents, 75000);
  assert.equal(result.revenue.externalPayingCustomerIdentities, 1);
  assert.equal(result.revenue.countedTransactionCount, 1);
});

test('active subscriptions alone contribute MRR and an external customer identity', () => {
  const value = snapshot();
  value.subscriptions.push({
    id: 'sub-1',
    status: 'active',
    customerId: 'customer-sub',
    mrrCents: 9900,
    customerClassification: 'external',
    ownerTest: false,
    productAttribution: { verified: true, product: 'thumbgate' },
  });
  const result = audit(value);
  assert.equal(result.revenue.externalMrrCents, 9900);
  assert.equal(result.revenue.activeExternalSubscriptions, 1);
  assert.equal(result.revenue.externalPayingCustomerIdentities, 1);
});

test('cancelled and failed transactions are validated but do not count as money', () => {
  const value = snapshot();
  value.transactions.push(paidTransaction({ status: 'cancelled' }));
  const result = audit(value);
  assert.equal(result.audited, true);
  assert.equal(result.revenue.trailing30DayGrossRevenueCents, 0);
  assert.equal(result.revenue.countedTransactionCount, 0);
});

test('duplicate provider transaction IDs fail closed instead of double counting', () => {
  const value = snapshot();
  value.transactions.push(paidTransaction(), paidTransaction());
  const result = audit(value);
  assert.equal(result.audited, false);
  assert.match(result.gap, /duplicate provider ID/i);
});

test('impossible refunds fail closed', () => {
  const value = snapshot();
  value.transactions.push(paidTransaction({ grossCents: 100, refundedCents: 101 }));
  const result = audit(value);
  assert.equal(result.audited, false);
  assert.match(result.gap, /gross\/refund cents/i);
});

test('refund status must agree with refund arithmetic', () => {
  const fullMismatch = snapshot();
  fullMismatch.transactions.push(paidTransaction({ status: 'refunded', refundedCents: 1 }));
  assert.match(audit(fullMismatch).gap, /not fully refunded/i);

  const partialMismatch = snapshot();
  partialMismatch.transactions.push(paidTransaction({ status: 'partially_refunded', refundedCents: 0 }));
  assert.match(audit(partialMismatch).gap, /inconsistent partial-refund/i);
});

test('owner tests and unverified product attribution cannot enter revenue', () => {
  const owner = snapshot();
  owner.transactions.push(paidTransaction({ ownerTest: true }));
  assert.match(audit(owner).gap, /attribution or external-customer evidence/i);

  const unattributed = snapshot();
  unattributed.transactions.push(paidTransaction({ productAttribution: { verified: false, product: 'thumbgate' } }));
  assert.match(audit(unattributed).gap, /attribution or external-customer evidence/i);
});

test('stale, future, and partial-window snapshots all fail closed', () => {
  const stale = snapshot();
  stale.generatedAt = '2026-07-13T00:00:00.000Z';
  assert.match(audit(stale).gap, /stale/i);

  const future = snapshot();
  future.generatedAt = '2026-07-16T00:00:00.000Z';
  assert.match(audit(future).gap, /future/i);

  const partial = snapshot();
  partial.scope.startLocalDate = '2026-06-17';
  assert.match(audit(partial).gap, /cover the exact trailing 30-day/i);

  const malformed = snapshot();
  malformed.scope.startLocalDate = 'not-a-date';
  assert.match(audit(malformed).gap, /cover the exact trailing 30-day/i);
});

test('provider mismatch and self-described non-provider sources fail closed', () => {
  assert.match(audit(snapshot('merchantOfRecord'), 'paypal').gap, /does not match/i);
  const handwritten = snapshot();
  handwritten.source.kind = 'operator_assertion';
  assert.match(audit(handwritten).gap, /provider-origin/i);
});

test('signed GitHub webhook ledgers cannot impersonate complete financial transaction exports', () => {
  const ledger = snapshot('githubMarketplace');
  ledger.source.kind = 'signed_webhook_ledger';
  assert.match(audit(ledger, 'githubMarketplace').gap, /provider-origin/i);
});

test('file audits bind output to a SHA-256 digest and reject malformed input', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-provider-evidence-'));
  const validPath = path.join(dir, 'paypal.json');
  const invalidPath = path.join(dir, 'bad.json');
  fs.writeFileSync(validPath, JSON.stringify(snapshot()));
  fs.writeFileSync(invalidPath, '{bad');
  const valid = auditProviderSnapshotFile(validPath, {
    expectedProvider: 'paypal', now: NOW, timeZone: 'America/New_York',
  });
  assert.equal(valid.audited, true);
  assert.match(valid.evidenceDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(valid.evidencePath, validPath);
  assert.equal(auditProviderSnapshotFile(invalidPath, { expectedProvider: 'paypal' }).audited, false);
  assert.equal(auditProviderSnapshotFile(path.join(dir, 'missing'), { expectedProvider: 'paypal' }).audited, false);
});

test('multi-provider ingestion keeps every missing source visibly incomplete', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-provider-set-'));
  const paypalPath = path.join(dir, 'paypal.json');
  fs.writeFileSync(paypalPath, JSON.stringify(snapshot()));
  const result = auditProviderEvidenceFiles({
    paths: { paypal: paypalPath }, now: NOW, timeZone: 'America/New_York',
  });
  assert.equal(result.paypal.audited, true);
  assert.equal(result.merchantOfRecord.audited, false);
  assert.equal(result.githubMarketplace.audited, false);
  assert.match(result.githubMarketplace.gap, /path was not provided/i);
});
