#!/usr/bin/env node
'use strict';

/**
 * Broker-signed execution receipts.
 *
 * Design (ThumbGate side of the aigate split):
 * - A credential-holding broker outside the agent trust boundary signs the
 *   receipt with an Ed25519 key the agent cannot reach.
 * - ThumbGate verifies the signature, rejects agent-minted "proof", and can
 *   require a valid receipt before high-risk provider side effects.
 * - ThumbGate does NOT store third-party provider credentials.
 *
 * Modes (THUMBGATE_BROKER_RECEIPT_MODE):
 * - off      — gate is a no-op
 * - verify   — if a receipt is attached, it must verify (default)
 * - enforce  — high-risk provider actions require a valid receipt
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getFeedbackPaths } = require('./feedback-paths');
const { validateToolContract } = require('./tool-contract-validator');

const SCHEMA_VERSION = 'broker-execution-receipt-v1';
const SCHEMA_PATH = path.join(__dirname, '..', 'config', 'schemas', 'broker-execution-receipt.schema.json');
// Agora-style honesty: a receipt records what the path produced, not the world.
const RECEIPT_PROOF_BOUNDARY = Object.freeze({
  proves: [
    'A credential-holding broker signed this decision',
    'The bound principal, target, decision, and idempotency key',
    'Hash-chain linkage when previousReceiptHash is present',
  ],
  doesNotProve: [
    'Independent world-state outcome outside the broker',
    'That a public listing or health page is invocable',
    'That a denied or unexecuted action ran',
    'That a signed deny decision is an execution receipt',
  ],
});
const LEDGER_FILE = 'broker-execution-receipts.jsonl';
const PUBLIC_KEYS_FILE = 'broker-public-keys.json';

const BROKER_RECEIPT_SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

// Provider-credentialed / external side-effect surfaces that must not run on
// agent-local prose alone when mode=enforce.
const HIGH_RISK_PROVIDER_PATTERNS = [
  /\b(?:stripe|paypal|plaid|twilio|sendgrid|mailgun|postmark)\b/i,
  /\b(?:openai|anthropic|openrouter|baseten)\b.{0,40}\b(?:key|token|billing|charge)\b/i,
  /\bprovider[_ -]?credential/i,
  /\bcredential[_ -]?vault/i,
  /\b(?:send|dispatch)\s+(?:email|sms|wire|payout)\b/i,
  /\b(?:create|capture|confirm)\s+(?:payment|charge|invoice|transfer)\b/i,
  /\bbroker[_ -]?signed/i,
  /\bprovider[_ -]?side[_ -]?effect\b/i,
  /\bproviderEventId\b/i,
];

const HIGH_RISK_TOOL_NAMES = new Set([
  'browser_click',
  'browser_type',
  'computer',
  'computer_use',
  'mcp__stripe',
  'send_email',
  'send_outreach',
]);

function getLedgerPath(options = {}) {
  if (options.ledgerPath) return path.resolve(options.ledgerPath);
  return path.join(getFeedbackPaths(options).FEEDBACK_DIR, LEDGER_FILE);
}

function getPublicKeysPath(options = {}) {
  if (options.publicKeysPath) return path.resolve(options.publicKeysPath);
  return path.join(getFeedbackPaths(options).FEEDBACK_DIR, PUBLIC_KEYS_FILE);
}

function ensureDirFor(filePath) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    // write surfaces real errors
  }
}

function cleanString(value, max = 500) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  return text.length > max ? text.slice(0, max) : text;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
  const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${parts.join(',')}}`;
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex');
}

function publicKeyIdFromPem(publicKeyPem) {
  return sha256Hex(String(publicKeyPem || '').replace(/\s+/g, '')).slice(0, 16);
}

function generateBrokerKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return {
    publicKeyPem,
    privateKeyPem,
    publicKeyId: publicKeyIdFromPem(publicKeyPem),
  };
}

/**
 * Fields that are cryptographically bound (signed). Signature + receiptHash
 * are computed after this object is frozen.
 */
function buildSignableBody(input = {}) {
  const principal = input.principal && typeof input.principal === 'object'
    ? input.principal
    : {};
  const target = input.target && typeof input.target === 'object'
    ? input.target
    : {};
  const broker = input.broker && typeof input.broker === 'object'
    ? input.broker
    : {};

  const body = {
    schemaVersion: SCHEMA_VERSION,
    receiptId: cleanString(input.receiptId) || crypto.randomUUID(),
    principal: {
      id: cleanString(principal.id, 200),
      kind: cleanString(principal.kind, 40) || 'agent',
    },
    target: {
      provider: cleanString(target.provider, 120),
      resource: cleanString(target.resource, 500) || undefined,
      action: cleanString(target.action, 120),
    },
    decision: cleanString(input.decision, 40) || 'execute',
    idempotencyKey: cleanString(input.idempotencyKey, 300),
    providerEventId: input.providerEventId === null || input.providerEventId === undefined
      ? null
      : cleanString(input.providerEventId, 300),
    issuedAt: cleanString(input.issuedAt) || new Date().toISOString(),
    broker: {
      id: cleanString(broker.id, 200),
      kind: 'broker',
    },
    previousReceiptHash: input.previousReceiptHash
      ? cleanString(input.previousReceiptHash, 64)
      : null,
  };

  if (!body.target.resource) {
    delete body.target.resource;
  }

  // Metadata is signed when present so agents cannot attach extra claims post-hoc.
  if (input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)) {
    body.metadata = input.metadata;
  }

  return body;
}

function computePayloadHash(signableBody) {
  return sha256Hex(stableStringify(signableBody));
}

/**
 * Issue a broker-signed receipt. Only call from a host that holds the broker
 * private key (never from agent-controlled tool args alone).
 */
function issueBrokerReceipt(input = {}, options = {}) {
  const privateKeyPem = cleanString(options.privateKeyPem || process.env.THUMBGATE_BROKER_SIGNING_KEY);
  if (!privateKeyPem) {
    const error = new Error('Broker signing key is not configured on the host');
    error.code = 'THUMBGATE_BROKER_SIGNING_KEY_MISSING';
    throw error;
  }

  const publicKeyPem = cleanString(options.publicKeyPem || process.env.THUMBGATE_BROKER_PUBLIC_KEY);
  if (!publicKeyPem) {
    const error = new Error('Broker public key is required to issue a receipt');
    error.code = 'THUMBGATE_BROKER_PUBLIC_KEY_MISSING';
    throw error;
  }

  const signable = buildSignableBody({
    ...input,
    broker: {
      id: cleanString(input.broker?.id || options.brokerId || 'thumbgate-dev-broker', 200),
      kind: 'broker',
    },
  });

  if (!signable.principal.id) {
    const error = new Error('principal.id is required');
    error.code = 'THUMBGATE_BROKER_RECEIPT_INVALID';
    throw error;
  }
  if (!signable.target.provider || !signable.target.action) {
    const error = new Error('target.provider and target.action are required');
    error.code = 'THUMBGATE_BROKER_RECEIPT_INVALID';
    throw error;
  }
  if (!signable.idempotencyKey) {
    const error = new Error('idempotencyKey is required');
    error.code = 'THUMBGATE_BROKER_RECEIPT_INVALID';
    throw error;
  }

  const payloadHash = computePayloadHash(signable);
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const signatureValue = crypto.sign(null, Buffer.from(payloadHash, 'utf8'), privateKey)
    .toString('base64');

  const receipt = {
    ...signable,
    payloadHash,
    signature: {
      alg: 'ed25519',
      publicKeyId: cleanString(options.publicKeyId) || publicKeyIdFromPem(publicKeyPem),
      value: signatureValue,
    },
  };

  receipt.receiptHash = sha256Hex(stableStringify({
    ...receipt,
    receiptHash: undefined,
  }));

  const validation = validateToolContract(BROKER_RECEIPT_SCHEMA, receipt);
  if (!validation.valid) {
    const error = new Error(`Invalid broker receipt: ${validation.errors.join('; ')}`);
    error.code = 'THUMBGATE_BROKER_RECEIPT_INVALID';
    error.details = validation.errors;
    throw error;
  }

  return receipt;
}

function loadTrustedPublicKeys(options = {}) {
  if (Array.isArray(options.trustedPublicKeys) && options.trustedPublicKeys.length > 0) {
    return options.trustedPublicKeys.map((entry) => ({
      publicKeyId: cleanString(entry.publicKeyId) || publicKeyIdFromPem(entry.publicKeyPem),
      publicKeyPem: cleanString(entry.publicKeyPem),
      brokerId: cleanString(entry.brokerId || ''),
    })).filter((entry) => entry.publicKeyPem);
  }

  const fromEnv = cleanString(process.env.THUMBGATE_BROKER_PUBLIC_KEYS_JSON);
  if (fromEnv) {
    try {
      const parsed = JSON.parse(fromEnv);
      if (Array.isArray(parsed)) {
        return loadTrustedPublicKeys({ trustedPublicKeys: parsed });
      }
    } catch {
      // fall through
    }
  }

  const singlePem = cleanString(options.publicKeyPem || process.env.THUMBGATE_BROKER_PUBLIC_KEY);
  if (singlePem) {
    return [{
      publicKeyId: publicKeyIdFromPem(singlePem),
      publicKeyPem: singlePem,
      brokerId: '',
    }];
  }

  try {
    const raw = fs.readFileSync(getPublicKeysPath(options), 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return loadTrustedPublicKeys({ trustedPublicKeys: parsed });
    }
    if (parsed && Array.isArray(parsed.keys)) {
      return loadTrustedPublicKeys({ trustedPublicKeys: parsed.keys });
    }
  } catch {
    // no keys on disk
  }

  return [];
}

function resolvePublicKeyPem(receipt, options = {}) {
  const trusted = loadTrustedPublicKeys(options);
  const keyId = cleanString(receipt?.signature?.publicKeyId);
  if (keyId) {
    const match = trusted.find((entry) => entry.publicKeyId === keyId);
    if (match) return match.publicKeyPem;
  }

  if (options.publicKeyPem) return cleanString(options.publicKeyPem);
  if (trusted.length === 1) return trusted[0].publicKeyPem;
  return '';
}

function verifyBrokerReceipt(receipt, options = {}) {
  const reasons = [];
  if (!receipt || typeof receipt !== 'object') {
    return { valid: false, reasons: ['receipt_missing'] };
  }

  const validation = validateToolContract(BROKER_RECEIPT_SCHEMA, receipt);
  if (!validation.valid) {
    return {
      valid: false,
      reasons: validation.errors.map((error) => `schema:${error}`),
    };
  }

  if (receipt.broker?.kind !== 'broker') {
    reasons.push('broker_kind_not_broker');
  }
  if (receipt.broker?.id && /agent/i.test(String(receipt.broker.id)) && options.rejectAgentBrokerId !== false) {
    // Soft signal only when id contains "agent" without a trusted key match later.
    reasons.push('broker_id_looks_like_agent');
  }

  const signable = buildSignableBody(receipt);
  // Preserve issuedAt/receiptId from receipt exactly for hash compare
  signable.receiptId = receipt.receiptId;
  signable.issuedAt = receipt.issuedAt;
  signable.previousReceiptHash = receipt.previousReceiptHash || null;
  if (receipt.target?.resource) {
    signable.target.resource = receipt.target.resource;
  } else {
    delete signable.target.resource;
  }
  if (receipt.metadata && typeof receipt.metadata === 'object') {
    signable.metadata = receipt.metadata;
  } else {
    delete signable.metadata;
  }

  const expectedPayloadHash = computePayloadHash(signable);
  if (expectedPayloadHash !== receipt.payloadHash) {
    reasons.push('payload_hash_mismatch');
  }

  const publicKeyPem = resolvePublicKeyPem(receipt, options);
  if (!publicKeyPem) {
    reasons.push('trusted_public_key_missing');
  } else {
    try {
      const publicKey = crypto.createPublicKey(publicKeyPem);
      const ok = crypto.verify(
        null,
        Buffer.from(receipt.payloadHash, 'utf8'),
        publicKey,
        Buffer.from(receipt.signature.value, 'base64'),
      );
      if (!ok) {
        reasons.push('signature_invalid');
      } else {
        // Valid signature clears the soft agent-id heuristic.
        const idx = reasons.indexOf('broker_id_looks_like_agent');
        if (idx >= 0) reasons.splice(idx, 1);
      }

      const expectedKeyId = publicKeyIdFromPem(publicKeyPem);
      if (receipt.signature.publicKeyId !== expectedKeyId && options.requireExactKeyId !== false) {
        const trusted = loadTrustedPublicKeys(options);
        const known = trusted.some((entry) => entry.publicKeyId === receipt.signature.publicKeyId);
        if (!known && trusted.length > 0) {
          reasons.push('public_key_id_untrusted');
        }
      }
    } catch {
      reasons.push('public_key_unusable');
    }
  }

  const expectedReceiptHash = sha256Hex(stableStringify({
    ...receipt,
    receiptHash: undefined,
  }));
  if (expectedReceiptHash !== receipt.receiptHash) {
    reasons.push('receipt_hash_mismatch');
  }

  // Agent-local rehash is not broker proof: principal may be agent, but broker
  // must not be agent-kind (already enforced by schema const).
  if (options.rejectAgentSelfSign !== false && receipt.signature?.publicKeyId === 'agent') {
    reasons.push('agent_self_sign_forbidden');
  }

  return {
    valid: reasons.length === 0,
    reasons,
    payloadHash: receipt.payloadHash,
    receiptHash: receipt.receiptHash,
    brokerId: receipt.broker?.id || null,
  };
}

function appendReceiptToLedger(receipt, options = {}) {
  const verification = verifyBrokerReceipt(receipt, options);
  if (!verification.valid) {
    const error = new Error(`Refusing to ledger invalid receipt: ${verification.reasons.join(', ')}`);
    error.code = 'THUMBGATE_BROKER_RECEIPT_INVALID';
    error.details = verification.reasons;
    throw error;
  }

  const ledgerPath = getLedgerPath(options);
  ensureDirFor(ledgerPath);
  const existing = readReceiptLedger(options);
  if (existing.length > 0) {
    const head = existing[existing.length - 1];
    // Non-genesis receipts must chain to the current head (no open forks).
    if (!receipt.previousReceiptHash) {
      const error = new Error('previousReceiptHash is required when the ledger is non-empty');
      error.code = 'THUMBGATE_BROKER_CHAIN_REQUIRED';
      throw error;
    }
    if (receipt.previousReceiptHash !== head.receiptHash) {
      const error = new Error('previousReceiptHash does not match ledger head');
      error.code = 'THUMBGATE_BROKER_CHAIN_BREAK';
      throw error;
    }
  } else if (receipt.previousReceiptHash) {
    const error = new Error('genesis receipt must not set previousReceiptHash');
    error.code = 'THUMBGATE_BROKER_CHAIN_BREAK';
    throw error;
  }

  fs.appendFileSync(ledgerPath, `${JSON.stringify(receipt)}\n`, 'utf8');
  return { recorded: true, receiptHash: receipt.receiptHash, count: existing.length + 1 };
}

function readReceiptLedger(options = {}) {
  const ledgerPath = getLedgerPath(options);
  let raw;
  try {
    raw = fs.readFileSync(ledgerPath, 'utf8');
  } catch {
    return [];
  }
  const rows = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // skip corrupt line
    }
  }
  return rows;
}

function reconcileReceiptChain(options = {}) {
  const rows = readReceiptLedger(options);
  const issues = [];
  let previousHash = null;

  for (let index = 0; index < rows.length; index += 1) {
    const receipt = rows[index];
    const verification = verifyBrokerReceipt(receipt, options);
    if (!verification.valid) {
      issues.push({ index, receiptId: receipt.receiptId, reasons: verification.reasons });
      continue;
    }
    if (index === 0) {
      if (receipt.previousReceiptHash) {
        issues.push({ index, receiptId: receipt.receiptId, reasons: ['unexpected_previous_hash_on_genesis'] });
      }
    } else if (receipt.previousReceiptHash !== previousHash) {
      issues.push({ index, receiptId: receipt.receiptId, reasons: ['chain_break'] });
    }
    previousHash = receipt.receiptHash;
  }

  return {
    ok: issues.length === 0,
    count: rows.length,
    issues,
  };
}

function getReceiptMode(options = {}) {
  const raw = cleanString(options.mode || process.env.THUMBGATE_BROKER_RECEIPT_MODE || 'verify').toLowerCase();
  if (raw === 'off' || raw === '0' || raw === 'false') return 'off';
  if (raw === 'enforce' || raw === 'required' || raw === 'strict') return 'enforce';
  return 'verify';
}

function extractReceiptFromToolInput(toolInput = {}) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  if (toolInput.brokerReceipt && typeof toolInput.brokerReceipt === 'object') {
    return toolInput.brokerReceipt;
  }
  if (toolInput.broker_execution_receipt && typeof toolInput.broker_execution_receipt === 'object') {
    return toolInput.broker_execution_receipt;
  }
  if (toolInput.receipt && toolInput.receipt.schemaVersion === SCHEMA_VERSION) {
    return toolInput.receipt;
  }
  return null;
}

function serializeToolSurface(toolName, toolInput) {
  let serialized = '';
  try {
    serialized = JSON.stringify(toolInput || {});
  } catch {
    serialized = String(toolInput || '');
  }
  return `${toolName || ''} ${serialized}`;
}

function isHighRiskProviderAction(toolName = '', toolInput = {}) {
  const name = String(toolName || '');
  if (HIGH_RISK_TOOL_NAMES.has(name)) return true;
  if (/^mcp__/.test(name) && /stripe|paypal|twilio|sendgrid|mailgun/i.test(name)) return true;

  const surface = serializeToolSurface(toolName, toolInput);
  if (toolInput && toolInput.requiresBrokerReceipt === true) return true;
  if (toolInput && toolInput.providerCredentialed === true) return true;
  return HIGH_RISK_PROVIDER_PATTERNS.some((pattern) => pattern.test(surface));
}

/**
 * Bind a receipt's target to the tool call being gated so a valid signature for
 * an unrelated action cannot unlock a different side effect.
 */
function receiptBindsToAction(receipt, toolName, toolInput = {}) {
  const reasons = [];
  if (!receipt || typeof receipt !== 'object') {
    return { bound: false, reasons: ['receipt_missing'] };
  }

  const target = receipt.target || {};
  const provider = cleanString(target.provider).toLowerCase();
  const action = cleanString(target.action).toLowerCase();
  // Exclude the receipt itself from the surface so a forged target cannot
  // self-match by being embedded in tool_input.brokerReceipt.
  const surfaceInput = (toolInput && typeof toolInput === 'object')
    ? { ...toolInput }
    : toolInput;
  if (surfaceInput && typeof surfaceInput === 'object') {
    delete surfaceInput.brokerReceipt;
    delete surfaceInput.broker_execution_receipt;
    if (surfaceInput.receipt && surfaceInput.receipt.schemaVersion === SCHEMA_VERSION) {
      delete surfaceInput.receipt;
    }
  }
  const surface = serializeToolSurface(toolName, surfaceInput).toLowerCase();
  const tool = String(toolName || '').toLowerCase();

  if (provider && !surface.includes(provider) && !tool.includes(provider)) {
    reasons.push('target_provider_mismatch');
  }
  if (action) {
    // Prefer whole action phrase; fall back to distinctive tokens (len>=4) so
    // short verbs like "create" alone cannot bind a receipt to unrelated tools.
    const phraseMatched = surface.includes(action) || tool.includes(action);
    const actionTokens = action.split(/[^a-z0-9]+/).filter((token) => token.length >= 4);
    const tokenMatched = actionTokens.length > 0
      && actionTokens.every((token) => surface.includes(token) || tool.includes(token));
    if (!phraseMatched && !tokenMatched) {
      reasons.push('target_action_mismatch');
    }
  }

  // Optional explicit binding fields from the broker.
  const expectedTool = cleanString(receipt.metadata?.toolName || receipt.metadata?.tool_name);
  if (expectedTool && expectedTool.toLowerCase() !== tool) {
    reasons.push('metadata_tool_mismatch');
  }
  const expectedIdempotency = cleanString(
    toolInput.idempotencyKey || toolInput.idempotency_key || '',
  );
  if (expectedIdempotency && expectedIdempotency !== cleanString(receipt.idempotencyKey)) {
    reasons.push('idempotency_key_mismatch');
  }

  return { bound: reasons.length === 0, reasons };
}

/**
 * Pre-tool gate evaluation for broker receipts.
 * Returns null when the gate does not apply or allows; otherwise a deny/warn result.
 */
function evaluateBrokerReceiptGate(toolName, toolInput = {}, options = {}) {
  const mode = getReceiptMode(options);
  if (mode === 'off') return null;

  const receipt = extractReceiptFromToolInput(toolInput);
  const highRisk = isHighRiskProviderAction(toolName, toolInput);
  const trustedKeys = loadTrustedPublicKeys(options);

  if (receipt) {
    const verification = verifyBrokerReceipt(receipt, options);
    if (!verification.valid) {
      return {
        decision: 'deny',
        gate: 'broker-execution-receipt',
        message: `Broker execution receipt failed verification (${verification.reasons.join(', ')}). `
          + 'A receipt an agent can rewrite is not evidence; only a credential-holding broker may sign.',
        severity: 'critical',
        reasons: verification.reasons,
        source: 'broker-execution-receipts',
      };
    }
    const binding = receiptBindsToAction(receipt, toolName, toolInput);
    if (!binding.bound) {
      return {
        decision: 'deny',
        gate: 'broker-execution-receipt',
        message: `Broker execution receipt does not bind to this action (${binding.reasons.join(', ')}). `
          + 'A signature for a different target cannot unlock this tool call.',
        severity: 'critical',
        reasons: binding.reasons,
        source: 'broker-execution-receipts',
      };
    }
    return null;
  }

  if (mode === 'enforce' && highRisk) {
    if (trustedKeys.length === 0 && options.allowEnforceWithoutKeys !== true) {
      // Fail closed when enforce is requested for high-risk work without keys:
      // operators must install broker public keys first.
      return {
        decision: 'deny',
        gate: 'broker-execution-receipt',
        message: 'High-risk provider action requires a broker-signed execution receipt, '
          + 'but no trusted broker public keys are configured on the host.',
        severity: 'critical',
        reasons: ['receipt_required', 'trusted_public_key_missing'],
        source: 'broker-execution-receipts',
      };
    }
    return {
      decision: 'deny',
      gate: 'broker-execution-receipt',
      message: 'High-risk provider action blocked: attach a valid broker-signed execution receipt '
        + '(tool_input.brokerReceipt). Agents cannot self-sign proof.',
      severity: 'critical',
      reasons: ['receipt_required'],
      source: 'broker-execution-receipts',
    };
  }

  return null;
}

function runCli(argv = process.argv.slice(2), options = {}) {
  const command = argv[0] || 'help';
  if (command === 'reconcile') {
    const result = reconcileReceiptChain(options);
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }
  if (command === 'verify') {
    const file = argv[1];
    if (!file) {
      console.error('Usage: broker-execution-receipts.js verify <receipt.json>');
      return 2;
    }
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
    const result = verifyBrokerReceipt(receipt, options);
    console.log(JSON.stringify(result, null, 2));
    return result.valid ? 0 : 1;
  }
  console.log('Usage: broker-execution-receipts.js <reconcile|verify> [...]');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = runCli();
}

module.exports = {
  SCHEMA_VERSION,
  RECEIPT_PROOF_BOUNDARY,
  BROKER_RECEIPT_SCHEMA,
  HIGH_RISK_PROVIDER_PATTERNS,
  appendReceiptToLedger,
  buildSignableBody,
  computePayloadHash,
  evaluateBrokerReceiptGate,
  extractReceiptFromToolInput,
  generateBrokerKeyPair,
  receiptBindsToAction,
  getLedgerPath,
  getReceiptMode,
  isHighRiskProviderAction,
  issueBrokerReceipt,
  loadTrustedPublicKeys,
  publicKeyIdFromPem,
  readReceiptLedger,
  reconcileReceiptChain,
  runCli,
  stableStringify,
  verifyBrokerReceipt,
};
