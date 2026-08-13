#!/usr/bin/env node
'use strict';

/**
 * Action Receipts — outcome-paired lessons.
 *
 * Pairs each tracked tool call with its concrete result (diff / exit code /
 * test outcome / state hash) so that a promoted prevention rule can encode
 * "this action -> this outcome" rather than only a bare thumbs signal.
 *
 * Receipts are persisted as JSONL beside the other feedback artifacts
 * (FEEDBACK_DIR/action-receipts.jsonl) using the same project-scoped
 * resolution as the rest of the feedback pipeline (feedback-paths).
 *
 * This module is self-contained: it only depends on feedback-paths + fs and
 * makes no edits to shared files. It is consumed from the MCP adapter wiring
 * step (record_action_receipt / get_action_receipts tools) and threads into
 * capture_feedback's lesson pipeline + construct_context_pack.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const { getFeedbackPaths } = require('./feedback-paths');

const RECEIPTS_FILE = 'action-receipts.jsonl';

function resolveReceiptSigningKey(signingKey) {
  const key = signingKey || process.env.THUMBGATE_RECEIPT_SIGNING_KEY || '';
  return typeof key === 'string' ? key.trim() : '';
}

/**
 * Length-prefixed field encoding avoids delimiter ambiguity between fields.
 * Example collision avoided: target "a|b" + id "c" vs target "a" + id "b|c".
 */
function encodeCanonicalField(value) {
  const str = safeString(value);
  return `${Buffer.byteLength(str, 'utf8')}:${str}`;
}

function computeCanonicalRequestDigest({ toolName, toolInput, target, idempotencyKey, recordedAt }) {
  const toolInputCanonical = typeof toolInput === 'object' && toolInput !== null
    ? JSON.stringify(toolInput)
    : safeString(toolInput);
  const payload = [
    encodeCanonicalField(toolName),
    encodeCanonicalField(toolInputCanonical),
    encodeCanonicalField(target),
    encodeCanonicalField(idempotencyKey),
    encodeCanonicalField(recordedAt),
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function signReceiptDigest(requestDigest, signingKey) {
  const key = resolveReceiptSigningKey(signingKey);
  if (!key) {
    throw new Error('THUMBGATE_RECEIPT_SIGNING_KEY is required to sign action receipts');
  }
  return crypto.createHmac('sha256', key).update(safeString(requestDigest)).digest('hex');
}

function verifyReceiptSignature(receipt, signingKey) {
  if (!receipt || !receipt.signature) return false;
  const key = resolveReceiptSigningKey(signingKey);
  if (!key) return false;

  // Recompute digest from stored fields so tampered body fields cannot pass.
  const recomputed = computeCanonicalRequestDigest({
    toolName: receipt.toolName,
    toolInput: receipt.toolInput,
    target: receipt.target,
    idempotencyKey: receipt.idempotencyKey,
    recordedAt: receipt.recordedAt,
  });
  if (receipt.requestDigest && receipt.requestDigest !== recomputed) {
    return false;
  }

  const expected = signReceiptDigest(recomputed, key);
  try {
    const sigBuf = Buffer.from(String(receipt.signature), 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

/**
 * Resolve the absolute path to the receipts JSONL for the active project.
 * @param {object} [options] - Passed through to getFeedbackPaths (e.g. for tests).
 * @returns {string}
 */
function getReceiptsPath(options = {}) {
  const { FEEDBACK_DIR } = getFeedbackPaths(options);
  return path.join(FEEDBACK_DIR, RECEIPTS_FILE);
}

function ensureDirFor(filePath) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    // best-effort; write will surface a real error if the dir truly cannot exist
  }
}

function safeString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return String(value);
  } catch {
    return '';
  }
}

/**
 * Build a short, human-readable summary of a tool input for the paired-lesson
 * string. Never throws; clamps length so the lesson stays compact.
 * @param {*} toolInput
 * @returns {string}
 */
function summarizeInput(toolInput) {
  if (toolInput === null || toolInput === undefined) return '';
  if (typeof toolInput === 'string') return clampText(toolInput, 120);

  if (typeof toolInput === 'object') {
    // Prefer the most lesson-relevant keys when present.
    const preferredKeys = ['file', 'filePath', 'path', 'command', 'cmd', 'query', 'pattern'];
    for (const key of preferredKeys) {
      if (toolInput[key]) {
        return `${key}=${clampText(safeString(toolInput[key]), 100)}`;
      }
    }
    try {
      return clampText(JSON.stringify(toolInput), 120);
    } catch {
      return '';
    }
  }

  return clampText(safeString(toolInput), 120);
}

function clampText(text, max) {
  const str = safeString(text);
  if (str.length <= max) return str;
  return `${str.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Derive a compact outcome descriptor from an outcome object.
 * @param {object} outcome
 * @returns {string}
 */
function summarizeOutcome(outcome) {
  if (!outcome || typeof outcome !== 'object') return 'unknown outcome';
  const parts = [];
  if (outcome.testOutcome) parts.push(`tests:${clampText(safeString(outcome.testOutcome), 40)}`);
  if (outcome.exitCode !== undefined && outcome.exitCode !== null) {
    parts.push(`exit:${outcome.exitCode}`);
  }
  if (outcome.diff) {
    const diffStr = safeString(outcome.diff);
    parts.push(`diff:${diffStr.length}b`);
  }
  if (outcome.stateHash) parts.push(`hash:${clampText(safeString(outcome.stateHash), 12)}`);
  return parts.length > 0 ? parts.join(' ') : 'no outcome fields';
}

/**
 * Normalize a raw record_action_receipt payload into a stored receipt object.
 * Accepts either a nested { outcome: {...} } shape or flat top-level fields
 * (diff / exitCode / testOutcome / stateHash) as the MCP tool surfaces them.
 * @param {object} params
 * @returns {object}
 */
function normalizeReceipt(params = {}) {
  const outcomeSource = (params.outcome && typeof params.outcome === 'object')
    ? params.outcome
    : params;

  const outcome = {
    diff: outcomeSource.diff !== undefined ? outcomeSource.diff : null,
    exitCode: (outcomeSource.exitCode !== undefined && outcomeSource.exitCode !== null)
      ? Number(outcomeSource.exitCode)
      : null,
    testOutcome: outcomeSource.testOutcome !== undefined ? outcomeSource.testOutcome : null,
    stateHash: outcomeSource.stateHash !== undefined ? outcomeSource.stateHash : null,
  };

  const recordedAt = params.recordedAt ? safeString(params.recordedAt) : new Date().toISOString();
  const toolName = params.toolName !== undefined ? safeString(params.toolName) : null;
  const toolInput = params.toolInput !== undefined ? params.toolInput : null;
  const target = safeString(params.target || params.file || params.filePath || '');
  const principal = safeString(params.principal || params.agentId || 'agent');
  const decision = safeString(params.decision || 'allow');
  const idempotencyKey = safeString(params.idempotencyKey || params.actionId || '');
  const providerEventId = safeString(params.providerEventId || '');

  const requestDigest = params.requestDigest || computeCanonicalRequestDigest({
    toolName,
    toolInput,
    target,
    idempotencyKey,
    recordedAt,
  });

  let signature = params.signature || null;
  if (!signature) {
    try {
      signature = signReceiptDigest(requestDigest, params.signingKey);
    } catch {
      signature = null; // unsigned when no key configured
    }
  }

  return {
    actionId: safeString(params.actionId) || null,
    toolName,
    toolInput,
    principal,
    target,
    decision,
    idempotencyKey,
    providerEventId,
    requestDigest,
    signature,
    outcome,
    recordedAt,
  };
}

/**
 * Append a receipt to the JSONL ledger.
 * @param {object} params - { actionId, toolName, toolInput, outcome:{ diff, exitCode, testOutcome, stateHash } }
 * @param {object} [options] - feedback-paths options (e.g. for tests).
 * @returns {object} The stored receipt record (with recorded:true).
 */
function recordReceipt(params = {}, options = {}) {
  const receipt = normalizeReceipt(params);
  const receiptsPath = getReceiptsPath(options);
  ensureDirFor(receiptsPath);
  fs.appendFileSync(receiptsPath, `${JSON.stringify(receipt)}\n`, 'utf8');
  return { recorded: true, ...receipt };
}

/**
 * Read all receipts from the ledger (oldest first). Tolerates malformed lines.
 * @param {object} [options]
 * @returns {object[]}
 */
function readAllReceipts(options = {}) {
  const receiptsPath = getReceiptsPath(options);
  let raw;
  try {
    raw = fs.readFileSync(receiptsPath, 'utf8');
  } catch {
    return [];
  }
  const receipts = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      receipts.push(JSON.parse(trimmed));
    } catch {
      // skip malformed line
    }
  }
  return receipts;
}

/**
 * Return the most recent receipt for a given actionId, or null.
 * @param {string} actionId
 * @param {object} [options]
 * @returns {object|null}
 */
function getReceiptForAction(actionId, options = {}) {
  if (!actionId) return null;
  const target = safeString(actionId);
  const receipts = readAllReceipts(options);
  for (let i = receipts.length - 1; i >= 0; i -= 1) {
    if (safeString(receipts[i].actionId) === target) return receipts[i];
  }
  return null;
}

/**
 * Return the last n receipts (most recent last, preserving chronological order).
 * @param {number} [n=20]
 * @param {object} [options]
 * @returns {object[]}
 */
function getRecentReceipts(n = 20, options = {}) {
  const limit = Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 20;
  const receipts = readAllReceipts(options);
  return receipts.slice(-limit);
}

/**
 * Build the "action -> outcome" lesson string for a matched receipt.
 * @param {object} receipt
 * @returns {string}
 */
function buildOutcomePairedLesson(receipt) {
  if (!receipt) return '';
  const toolName = safeString(receipt.toolName) || 'action';
  const inputSummary = summarizeInput(receipt.toolInput);
  const outcomeSummary = summarizeOutcome(receipt.outcome);
  return `${toolName}(${inputSummary}) -> ${outcomeSummary}`;
}

/**
 * Resolve which actionId a feedback payload refers to. Supports both the
 * legacy `lastAction` shape (object or string) and a flat `actionId` field.
 * @param {object} feedbackParams
 * @returns {string|null}
 */
function resolveFeedbackActionId(feedbackParams = {}) {
  if (feedbackParams.actionId) return safeString(feedbackParams.actionId);

  const lastAction = feedbackParams.lastAction;
  if (!lastAction) return null;
  if (typeof lastAction === 'string') return safeString(lastAction);
  if (typeof lastAction === 'object') {
    if (lastAction.actionId) return safeString(lastAction.actionId);
    if (lastAction.id) return safeString(lastAction.id);
  }
  return null;
}

/**
 * Enrich a capture_feedback payload with the most recent matching receipt's
 * outcome so the lesson pipeline encodes action->outcome. If no receipt
 * matches, the original payload is returned unchanged (never throws).
 * @param {object} feedbackParams
 * @param {object} [options]
 * @returns {object}
 */
function pairFeedbackWithReceipt(feedbackParams = {}, options = {}) {
  const actionId = resolveFeedbackActionId(feedbackParams);
  if (!actionId) return feedbackParams;

  let receipt = null;
  try {
    receipt = getReceiptForAction(actionId, options);
  } catch {
    return feedbackParams;
  }
  if (!receipt) return feedbackParams;

  const outcomePairedLesson = buildOutcomePairedLesson(receipt);

  return {
    ...feedbackParams,
    outcome: { ...receipt.outcome },
    outcomePairedLesson,
    receiptActionId: actionId,
  };
}

/**
 * Build construct_context_pack-shaped candidate entries from receipts that
 * match a free-text query. Returns [{ namespace, text, score }].
 * @param {string} query
 * @param {number} [limit=5]
 * @param {object} [options]
 * @returns {Array<{namespace:string, text:string, score:number}>}
 */
function buildReceiptContextEntries(query, limit = 5, options = {}) {
  const cap = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 5;
  const receipts = readAllReceipts(options);
  if (receipts.length === 0) return [];

  const queryTokens = safeString(query)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);

  const scored = receipts.map((receipt) => {
    const lesson = buildOutcomePairedLesson(receipt);
    const haystack = `${lesson} ${safeString(receipt.toolName)} ${summarizeInput(receipt.toolInput)}`.toLowerCase();
    let score = 0;
    for (const token of queryTokens) {
      if (haystack.includes(token)) score += 1;
    }
    const text = `${lesson} [outcome: ${summarizeOutcome(receipt.outcome)}]`;
    return { namespace: 'action-receipts', text, score };
  });

  // When the query is empty, surface the most recent receipts (score 0 but
  // still useful for the pack); otherwise rank by token overlap.
  const ranked = queryTokens.length === 0
    ? scored.slice(-cap).reverse()
    : scored
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, cap);

  return ranked;
}

module.exports = {
  RECEIPTS_FILE,
  getReceiptsPath,
  recordReceipt,
  readAllReceipts,
  getReceiptForAction,
  getRecentReceipts,
  buildOutcomePairedLesson,
  pairFeedbackWithReceipt,
  buildReceiptContextEntries,
  computeCanonicalRequestDigest,
  resolveReceiptSigningKey,
  signReceiptDigest,
  verifyReceiptSignature,
  // exposed for testing / reuse
  summarizeInput,
  summarizeOutcome,
  resolveFeedbackActionId,
};
