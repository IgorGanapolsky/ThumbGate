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

// Strict RFC 3339 / ISO-8601 date-time with required timezone (Z or ±HH:MM).
const RFC3339_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const BASE64_STRICT = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const ED25519_SIG_BYTES = 64;

function hasUnpairedSurrogate(text) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function jcsCanonicalize(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    if (hasUnpairedSurrogate(value)) {
      throw new TypeError('JCS rejects unpaired UTF-16 surrogates');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JCS rejects non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(jcsCanonicalize).join(',')}]`;
  if (typeof value !== 'object') throw new TypeError(`JCS cannot serialize ${typeof value}`);
  return `{${Object.keys(value)
    .sort()
    .map((key) => {
      if (hasUnpairedSurrogate(key)) {
        throw new TypeError('JCS rejects unpaired UTF-16 surrogates in property names');
      }
      return `${JSON.stringify(key)}:${jcsCanonicalize(value[key])}`;
    })
    .join(',')}}`;
}

function unsignedPayload(attestation) {
  const payload = { ...attestation };
  delete payload.signature;
  return payload;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseRfc3339Ms(value) {
  if (typeof value !== 'string' || !RFC3339_DATE_TIME.test(value)) return Number.NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function isStrictBase64(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) return false;
  if (!BASE64_STRICT.test(value)) return false;
  return true;
}

function semanticErrors(attestation) {
  const errors = [];
  const evidence = attestation.providerEvidence || {};
  const policy = attestation.reconciliationPolicy || {};
  const observedAt = parseRfc3339Ms(evidence.observedAt);
  const startedAt = parseRfc3339Ms(evidence.windowStartedAt);
  const closesAt = parseRfc3339Ms(evidence.windowClosesAt);
  const issuedAt = parseRfc3339Ms(attestation.issuedAt);

  if (!Number.isFinite(observedAt)) errors.push('observedAt_not_rfc3339');
  if (!Number.isFinite(startedAt)) errors.push('windowStartedAt_not_rfc3339');
  if (!Number.isFinite(closesAt)) errors.push('windowClosesAt_not_rfc3339');
  if (!Number.isFinite(issuedAt)) errors.push('issuedAt_not_rfc3339');

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

  let canonicalPayload;
  let payloadHash;
  try {
    canonicalPayload = jcsCanonicalize(unsignedPayload(attestation));
    payloadHash = sha256Hex(canonicalPayload);
  } catch (error) {
    return {
      valid: false,
      errors: [`jcs_canonicalization_failed:${error.message}`],
    };
  }

  if (payloadHash !== attestation.signature.payloadHash) errors.push('payload_hash_mismatch');

  const signatureValue = attestation.signature?.value;
  if (!isStrictBase64(signatureValue)) {
    errors.push('signature_not_strict_base64');
  } else {
    try {
      const signatureBytes = Buffer.from(signatureValue, 'base64');
      if (signatureBytes.length !== ED25519_SIG_BYTES) {
        errors.push('signature_length_invalid');
      } else {
        const verified = crypto.verify(
          null,
          Buffer.from(payloadHash, 'utf8'),
          crypto.createPublicKey(publicKeyPem),
          signatureBytes,
        );
        if (!verified) errors.push('signature_invalid');
      }
    } catch {
      errors.push('public_key_or_signature_unusable');
    }
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

module.exports = {
  SCHEMA,
  SCHEMA_VERSION,
  jcsCanonicalize,
  runConformance,
  semanticErrors,
  sha256Hex,
  unsignedPayload,
  verifyAttestation,
  parseRfc3339Ms,
  isStrictBase64,
  hasUnpairedSurrogate,
};
