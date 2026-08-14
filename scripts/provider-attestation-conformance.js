#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validateToolContract } = require('./tool-contract-validator');

const SCHEMA_VERSION = 'thumbgate-provider-execution-attestation-v1';
const SCHEMA_PATH = path.join(__dirname, '..', 'config', 'schemas', 'provider-execution-attestation-v1.schema.json');
const DEFAULT_VECTORS_PATH = path.join(__dirname, '..', 'conformance', 'provider-attestation', 'vectors.json');
const SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

function jcsCanonicalize(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JCS rejects non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(jcsCanonicalize).join(',')}]`;
  if (typeof value !== 'object') throw new TypeError(`JCS cannot serialize ${typeof value}`);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${jcsCanonicalize(value[key])}`).join(',')}}`;
}

function unsignedPayload(attestation) {
  const payload = { ...attestation };
  delete payload.signature;
  return payload;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function semanticErrors(attestation) {
  const errors = [];
  const evidence = attestation.providerEvidence || {};
  const policy = attestation.reconciliationPolicy || {};
  const observedAt = Date.parse(evidence.observedAt);
  const startedAt = Date.parse(evidence.windowStartedAt);
  const closesAt = Date.parse(evidence.windowClosesAt);
  if (attestation.provider?.id !== policy.provider) errors.push('policy_provider_mismatch');
  if (policy.declaredWindowMs > policy.maxWindowMs) errors.push('holder_window_exceeds_gate_maximum');
  if (Number.isFinite(startedAt) && Number.isFinite(closesAt) && closesAt - startedAt !== policy.declaredWindowMs) {
    errors.push('declared_window_duration_mismatch');
  }
  if (attestation.outcome === 'not-yet-visible' && Number.isFinite(observedAt) && Number.isFinite(closesAt) && observedAt >= closesAt) {
    errors.push('not_yet_visible_after_window');
  }
  if (attestation.outcome === 'absent-after-window' && Number.isFinite(observedAt) && Number.isFinite(closesAt) && observedAt < closesAt) {
    errors.push('absence_claimed_before_window_closed');
  }
  if ((attestation.outcome === 'matched' || attestation.outcome === 'mismatched') && !evidence.eventId) {
    errors.push('provider_event_required_for_comparison');
  }
  if ((attestation.outcome === 'not-yet-visible' || attestation.outcome === 'absent-after-window') && evidence.eventId !== null) {
    errors.push('provider_event_must_be_null_when_unobserved');
  }
  return errors;
}

function verifyAttestation(attestation, publicKeyPem) {
  const schema = validateToolContract(SCHEMA, attestation);
  const errors = schema.valid ? [] : schema.errors.map((error) => `schema:${error}`);
  errors.push(...semanticErrors(attestation));
  if (errors.length > 0) return { valid: false, errors };
  const canonicalPayload = jcsCanonicalize(unsignedPayload(attestation));
  const payloadHash = sha256Hex(canonicalPayload);
  if (payloadHash !== attestation.signature.payloadHash) errors.push('payload_hash_mismatch');
  try {
    const verified = crypto.verify(
      null,
      Buffer.from(payloadHash, 'utf8'),
      crypto.createPublicKey(publicKeyPem),
      Buffer.from(attestation.signature.value, 'base64'),
    );
    if (!verified) errors.push('signature_invalid');
  } catch {
    errors.push('public_key_or_signature_unusable');
  }
  return { valid: errors.length === 0, errors, canonicalPayload, payloadHash };
}

function runConformance(vectorsPath = DEFAULT_VECTORS_PATH) {
  const suite = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));
  const results = suite.vectors.map((vector) => {
    const result = verifyAttestation(vector.attestation, suite.publicKeyPem);
    const passed = result.valid === vector.expectedValid
      && (!vector.expectedError || result.errors.includes(vector.expectedError))
      && (!vector.expectedCanonicalPayload || result.canonicalPayload === vector.expectedCanonicalPayload);
    return { id: vector.id, passed, expectedValid: vector.expectedValid, actualValid: result.valid, errors: result.errors };
  });
  return { passed: results.every((result) => result.passed), count: results.length, results };
}

function runCli(argv = process.argv.slice(2)) {
  const result = runConformance(argv[0] ? path.resolve(argv[0]) : DEFAULT_VECTORS_PATH);
  console.log(JSON.stringify(result, null, 2));
  return result.passed ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) process.exitCode = runCli();

module.exports = { SCHEMA, SCHEMA_VERSION, jcsCanonicalize, runConformance, semanticErrors, sha256Hex, unsignedPayload, verifyAttestation };
