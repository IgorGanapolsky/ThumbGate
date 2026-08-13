#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');

/**
 * Partner-Neutral Broker Execution Receipt Contract Schema:
 * - schemaVersion: '1.0'
 * - receiptId: string (UUID / unique receipt identifier)
 * - idempotencyKey: string (deterministic action key)
 * - principal: string (agent or user identity)
 * - target: string (target resource, URL, or API endpoint)
 * - decision: 'allow' | 'block' | 'warn'
 * - toolName: string
 * - canonicalDigest: string (SHA-256 over canonical request payload)
 * - providerEventId: string (external event ID from provider/broker)
 * - brokerId: string (identifier of the out-of-boundary credential holder, e.g. 'aigate')
 * - signature: string (HMAC-SHA256 or RSA/ECDSA signature emitted by broker)
 * - reconciliation: { status: 'pending'|'reconciled'|'failed', timestamp: string }
 */

const RECEIPT_SCHEMA_VERSION = '1.0';

function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

function computeCanonicalRequestDigest({ toolName, toolInput, target, idempotencyKey, recordedAt }) {
  const parts = [
    String(toolName || ''),
    typeof toolInput === 'object' ? canonicalStringify(toolInput || {}) : String(toolInput || ''),
    String(target || ''),
    String(idempotencyKey || ''),
    String(recordedAt || ''),
  ];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

function validateProviderReceiptSchema(receipt) {
  if (!receipt || typeof receipt !== 'object') {
    return { ok: false, errors: ['Receipt must be an object.'] };
  }

  const errors = [];
  for (const field of ['schemaVersion', 'receiptId', 'toolName', 'providerEventId']) {
    if (!receipt[field] || typeof receipt[field] !== 'string') {
      errors.push(`Missing or invalid ${field}.`);
    }
  }
  if (!receipt.canonicalDigest || typeof receipt.canonicalDigest !== 'string') {
    errors.push('Missing or invalid canonicalDigest.');
  }
  if (!receipt.principal || typeof receipt.principal !== 'string') {
    errors.push('Missing or invalid principal.');
  }
  if (!receipt.target || typeof receipt.target !== 'string') {
    errors.push('Missing or invalid target.');
  }
  if (!['allow', 'block', 'warn'].includes(receipt.decision)) {
    errors.push('Missing or invalid decision (must be allow, block, or warn).');
  }
  if (!receipt.idempotencyKey || typeof receipt.idempotencyKey !== 'string') {
    errors.push('Missing or invalid idempotencyKey.');
  }
  if (!receipt.brokerId || typeof receipt.brokerId !== 'string') {
    errors.push('Missing or invalid brokerId.');
  }
  if (!receipt.signature || typeof receipt.signature !== 'string') {
    errors.push('Missing or invalid broker signature.');
  }

  return { ok: errors.length === 0, errors };
}

function verifyBrokerSignature(receipt, brokerSecretKey) {
  const schemaValidation = validateProviderReceiptSchema(receipt);
  if (!schemaValidation.ok) {
    return { verified: false, reason: 'schema_validation_failed', errors: schemaValidation.errors };
  }

  if (!brokerSecretKey) {
    return { verified: false, reason: 'missing_broker_key' };
  }

  const signedClaims = { ...receipt };
  delete signedClaims.signature;
  delete signedClaims.reconciliation;
  const expectedSignature = crypto
    .createHmac('sha256', brokerSecretKey)
    .update(canonicalStringify(signedClaims))
    .digest('hex');

  try {
    const verified = crypto.timingSafeEqual(
      Buffer.from(receipt.signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
    return { verified, reason: verified ? 'valid_broker_signature' : 'signature_mismatch' };
  } catch {
    return { verified: false, reason: 'crypto_error' };
  }
}

function reconcileProviderEvent(receipt, providerEventResponse = {}) {
  const schemaCheck = validateProviderReceiptSchema(receipt);
  if (!schemaCheck.ok) {
    return { reconciled: false, reason: 'invalid_receipt_schema' };
  }

  if (!providerEventResponse.eventId || typeof providerEventResponse.eventId !== 'string') {
    return { reconciled: false, reason: 'missing_provider_event_id' };
  }

  const matchesEventId = providerEventResponse.eventId === receipt.providerEventId;
  const matchesTarget = !providerEventResponse.target || providerEventResponse.target === receipt.target;

  const reconciled = Boolean(matchesEventId && matchesTarget);

  return {
    reconciled,
    reconciliationTimestamp: new Date().toISOString(),
    providerEventId: receipt.providerEventId,
    reason: reconciled ? 'event_reconciled' : 'event_mismatch',
  };
}

module.exports = {
  RECEIPT_SCHEMA_VERSION,
  canonicalStringify,
  computeCanonicalRequestDigest,
  validateProviderReceiptSchema,
  verifyBrokerSignature,
  reconcileProviderEvent,
};
