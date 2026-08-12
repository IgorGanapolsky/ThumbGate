'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  RECEIPT_SCHEMA_VERSION,
  computeCanonicalRequestDigest,
  validateProviderReceiptSchema,
  verifyBrokerSignature,
  reconcileProviderEvent,
} = require('../scripts/provider-receipt-contract');

test('partner-neutral receipt schema validation detects missing required fields', () => {
  const invalidReceipt = {
    canonicalDigest: 'abc',
    principal: 'agent-1',
    // missing target, decision, idempotencyKey, brokerId, signature
  };

  const validation = validateProviderReceiptSchema(invalidReceipt);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.length >= 4);
});

test('broker signature verification passes for valid broker-emitted receipt', () => {
  const brokerSecretKey = 'broker-super-secret-key-999';
  const recordedAt = new Date().toISOString();
  const canonicalDigest = computeCanonicalRequestDigest({
    toolName: 'github_issue_update',
    toolInput: { issueId: 42, title: 'Security Fix' },
    target: 'api.github.com/repos/org/repo/issues/42',
    idempotencyKey: 'idem-gh-42-001',
    recordedAt,
  });

  const brokerSignature = crypto
    .createHmac('sha256', brokerSecretKey)
    .update(canonicalDigest)
    .digest('hex');

  const validReceipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    receiptId: 'rcpt-uuid-888',
    idempotencyKey: 'idem-gh-42-001',
    principal: 'agent-executor',
    target: 'api.github.com/repos/org/repo/issues/42',
    decision: 'allow',
    toolName: 'github_issue_update',
    canonicalDigest,
    providerEventId: 'evt-gh-event-777',
    brokerId: 'aigate-credential-broker',
    signature: brokerSignature,
    recordedAt,
  };

  const verification = verifyBrokerSignature(validReceipt, brokerSecretKey);
  assert.equal(verification.verified, true);
  assert.equal(verification.reason, 'valid_broker_signature');
});

test('broker signature verification rejects tampered canonicalDigest or invalid broker key', () => {
  const brokerSecretKey = 'real-key-123';
  const wrongKey = 'wrong-key-456';
  const canonicalDigest = computeCanonicalRequestDigest({
    toolName: 'stripe_charge_settle',
    toolInput: { amount: 100 },
    target: 'api.stripe.com/v1/charges',
    idempotencyKey: 'idem-stripe-001',
    recordedAt: '2026-08-12T00:00:00Z',
  });

  const brokerSignature = crypto
    .createHmac('sha256', brokerSecretKey)
    .update(canonicalDigest)
    .digest('hex');

  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    receiptId: 'rcpt-1',
    idempotencyKey: 'idem-stripe-001',
    principal: 'agent-finance',
    target: 'api.stripe.com/v1/charges',
    decision: 'allow',
    toolName: 'stripe_charge_settle',
    canonicalDigest,
    providerEventId: 'stripe-evt-999',
    brokerId: 'aigate',
    signature: brokerSignature,
  };

  const verification = verifyBrokerSignature(receipt, wrongKey);
  assert.equal(verification.verified, false);
  assert.equal(verification.reason, 'signature_mismatch');
});

test('reconcileProviderEvent matches provider event surface response against broker receipt', () => {
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    receiptId: 'rcpt-rec-1',
    idempotencyKey: 'idem-rec-1',
    principal: 'agent-1',
    target: 'api.github.com/repos/org/repo/pulls/1',
    decision: 'allow',
    toolName: 'merge_pull_request',
    canonicalDigest: 'digest-123',
    providerEventId: 'gh-event-444',
    brokerId: 'aigate',
    signature: 'sig-123',
  };

  const providerResponse = {
    eventId: 'gh-event-444',
    target: 'api.github.com/repos/org/repo/pulls/1',
    status: 'completed',
  };

  const reconciliation = reconcileProviderEvent(receipt, providerResponse);
  assert.equal(reconciliation.reconciled, true);
  assert.equal(reconciliation.reason, 'event_reconciled');
});
