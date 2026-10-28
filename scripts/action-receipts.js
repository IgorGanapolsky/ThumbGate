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

/**
 * Reconstruct model-visible facts from the session/receipt log.
 * A missing receipt fails closed so the model cannot invent world-state.
 */
function reconstructModelVisibleFacts(actionId, options = {}) {
  const receipt = getReceiptForAction(actionId, options);
  if (!receipt) {
    return { ok: false, failClosed: true, reason: 'missing_receipt' };
  }
  if (!verifyReceiptSignature(receipt, options.signingKey)) {
    return { ok: false, failClosed: true, reason: 'unauthenticated_receipt' };
  }
  return {
    ok: true,
    facts: {
      actionId: receipt.actionId,
      toolName: receipt.toolName,
      toolInput: receipt.toolInput,
      decision: receipt.decision,
      principal: receipt.principal,
      requestDigest: receipt.requestDigest,
      recordedAt: receipt.recordedAt,
      outcome: receipt.outcome,
    },
  };
}

/**
 * OneShot FORMAT (oneshotagent.com/thesis, 2026-10-04): the model is not the
 * control. These functions quote and reserve before a side effect, and they
 * refuse a worker's own "done". They do not move money and they do not open
 * ThumbGate's $0 agent spend wall. An omitted cash cap is $0.
 */
function canonicalOneShotValue(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
      throw new TypeError('unhashable');
    }
    const encoded = JSON.stringify(value === undefined ? null : value);
    if (typeof encoded !== 'string') throw new TypeError('unhashable');
    return encoded;
  }
  if (seen.has(value)) throw new TypeError('cycle');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalOneShotValue(entry, seen)).join(',')}]`;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new TypeError('unhashable');
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalOneShotValue(value[key], seen)}`).join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

function oneShotFlag(value) {
  return value === true || value === 1 || value === 'true';
}

function oneShotId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function oneShotCents(usd, mode = 'ceil') {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) return null;
  const scaled = Math.round(usd * 10000);
  const cents = mode === 'floor' ? Math.floor(scaled / 100) : Math.ceil(scaled / 100);
  if (usd > 0 && cents <= 0) return 1;
  return cents;
}

function hashOneShotAction({ toolName, toolInput, quotedUsd, idempotencyKey } = {}) {
  const quoteField = typeof quotedUsd === 'number' && Number.isFinite(quotedUsd)
    ? String(quotedUsd)
    : '';
  const payload = [
    encodeCanonicalField(toolName),
    encodeCanonicalField(canonicalOneShotValue(toolInput)),
    encodeCanonicalField(quoteField),
    encodeCanonicalField(idempotencyKey),
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function oneShotDecision(verdict, reason, extra = {}) {
  return {
    actionHash: '',
    reservedUsd: 0,
    ...extra,
    verdict,
    reason,
    charged: false,
  };
}

function clampCapToCeiling(value, ceiling) {
  if (value == null) return ceiling;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.min(value, ceiling);
}

function nonNegativeUsd(value) {
  if (value == null) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function evaluateOneShotControl(input = {}) {
  let actionHash = '';
  try {
    actionHash = hashOneShotAction(input);
  } catch {
    return oneShotDecision('hold', 'action_unreadable', { actionHash: '' });
  }
  const base = { actionHash };

  if (oneShotFlag(input.uncapped)) {
    return oneShotDecision('deny', 'uncapped_refused', base);
  }

  const rawCap = input.cashCapUsd;
  if (rawCap != null && (typeof rawCap !== 'number' || !Number.isFinite(rawCap) || rawCap < 0)) {
    return oneShotDecision('hold', 'cap_unreadable', base);
  }
  const agentCeilingUsd = rawCap == null ? 0 : rawCap;

  if (input.ledgerReadable !== true) {
    return oneShotDecision('hold', 'ledger_unreadable', base);
  }

  const quote = input.quotedUsd;
  if (typeof quote !== 'number' || !Number.isFinite(quote) || quote < 0) {
    return oneShotDecision('hold', 'quote_required', base);
  }

  if (input.idempotencyKey != null && input.idempotencyKey !== '' && typeof input.idempotencyKey !== 'string') {
    return oneShotDecision('hold', 'idempotency_unreadable', base);
  }
  const key = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
  if (typeof input.idempotencyKey === 'string' && input.idempotencyKey !== '' && key === '') {
    return oneShotDecision('hold', 'idempotency_unreadable', base);
  }
  if (input.chargedKeys != null && !Array.isArray(input.chargedKeys)) {
    return oneShotDecision('hold', 'ledger_unreadable', base);
  }
  if (input.inFlightKeys != null && !Array.isArray(input.inFlightKeys)) {
    return oneShotDecision('hold', 'ledger_unreadable', base);
  }
  const sameKey = (list) => Array.isArray(list) && list.some((entry) => typeof entry === 'string' && entry.trim() === key);
  if (key && sameKey(input.chargedKeys)) {
    return oneShotDecision('deny', 'idempotent_replay', base);
  }
  if (key && sameKey(input.inFlightKeys)) {
    return oneShotDecision('hold', 'idempotency_in_flight', base);
  }

  const perCallUsd = clampCapToCeiling(input.perCallCapUsd, agentCeilingUsd);
  const dailyUsd = clampCapToCeiling(input.dailyCapUsd, agentCeilingUsd);
  const spentUsd = nonNegativeUsd(input.spentTodayUsd);
  const inFlightUsd = nonNegativeUsd(input.inFlightUsd);
  if (spentUsd == null || inFlightUsd == null) {
    return oneShotDecision('hold', 'ledger_unreadable', base);
  }
  if (perCallUsd == null || dailyUsd == null) {
    return oneShotDecision('hold', 'cap_unreadable', base);
  }

  const quoteCents = oneShotCents(quote, 'ceil');
  const perCallCents = oneShotCents(perCallUsd, 'floor');
  const dailyCents = oneShotCents(dailyUsd, 'floor');
  const spentCents = oneShotCents(spentUsd, 'ceil');
  const inFlightCents = oneShotCents(inFlightUsd, 'ceil');
  if ([quoteCents, perCallCents, dailyCents, spentCents, inFlightCents].some((cents) => cents == null)) {
    return oneShotDecision('hold', 'cap_unreadable', base);
  }

  if (quoteCents > perCallCents) {
    return oneShotDecision('deny', 'over_per_call_cap', base);
  }
  if (spentCents + inFlightCents + quoteCents > dailyCents) {
    return oneShotDecision('deny', 'over_daily_cap', base);
  }

  if (oneShotFlag(input.irreversible) || oneShotFlag(input.approvalRequired)) {
    const approval = input.approval;
    if (!approval || typeof approval !== 'object') {
      return oneShotDecision('hold', 'approval_required', base);
    }
    if (oneShotFlag(approval.used)) {
      return oneShotDecision('deny', 'approval_replay', base);
    }
    if (approval.expiresAt != null) {
      const expiresAt = Number(approval.expiresAt);
      const now = Number(input.now != null ? input.now : Date.now());
      if (!Number.isFinite(expiresAt) || !Number.isFinite(now) || expiresAt <= now) {
        return oneShotDecision('deny', 'approval_expired', base);
      }
    }
    if (approval.actionHash !== actionHash) {
      return oneShotDecision('deny', 'approval_action_mismatch', base);
    }
  }

  return oneShotDecision('allow', 'within_cap', { ...base, reservedUsd: quote });
}

function evaluateOneShotGoalDone(input = {}) {
  if (oneShotFlag(input.budgetExhausted)) {
    return { status: 'out_of_budget', done: false, reason: 'budget_exhausted', missing: [] };
  }

  const runStartedAt = input.runStartedAt;
  const check = input.check;
  const checkObject = Boolean(check) && typeof check === 'object';
  if (checkObject && check.passed === false) {
    const missing = Array.isArray(check.missing) && check.missing.length > 0
      ? check.missing.slice()
      : ['check_failed'];
    return { status: 'failed', done: false, reason: 'check_failed', missing };
  }

  const checkWrittenBeforeRun = checkObject
    && typeof check.writtenAt === 'number'
    && Number.isFinite(check.writtenAt)
    && typeof runStartedAt === 'number'
    && Number.isFinite(runStartedAt)
    && check.writtenAt < runStartedAt;

  if (checkWrittenBeforeRun && check.passed === true) {
    if (!oneShotEvidenceBacked(input)) {
      return {
        status: 'waiting_owner',
        done: false,
        reason: 'evidence_missing',
        missing: ['verification_evidence'],
      };
    }
    return { status: 'done', done: true, reason: 'check_confirmed', missing: [] };
  }

  const workerId = oneShotId(input.workerId);
  const confirmerId = oneShotId(input.confirmerId);
  if (workerId && confirmerId && confirmerId === workerId) {
    return { status: 'waiting_owner', done: false, reason: 'worker_cannot_confirm', missing: [] };
  }
  if (workerId && confirmerId && confirmerId !== workerId) {
    if (!oneShotEvidenceBacked(input)) {
      return {
        status: 'waiting_owner',
        done: false,
        reason: 'evidence_missing',
        missing: ['verification_evidence'],
      };
    }
    return { status: 'done', done: true, reason: 'owner_confirmed', missing: [] };
  }

  return {
    status: 'waiting_owner',
    done: false,
    reason: input.modelSaysDone === true ? 'model_done_ignored' : 'check_missing',
    missing: [],
  };
}

function oneShotPayloadNeedsControl(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) return false;
  const name = String(toolName || '');
  const status = typeof toolInput.status === 'string' ? toolInput.status.trim().toLowerCase() : '';
  if ((name === 'record_task_outcome' || name === 'verify_claim') && (status === 'completed' || status === 'done')) {
    return true;
  }
  if (toolInput.modelSaysDone === true || toolInput.goalDone === true) return true;
  if (oneShotFlag(toolInput.budgetExhausted)) return true;
  if (Object.prototype.hasOwnProperty.call(toolInput, 'quotedUsd')) return true;
  return oneShotFlag(toolInput.uncapped)
    || oneShotFlag(toolInput.irreversible)
    || oneShotFlag(toolInput.approvalRequired);
}

function oneShotIsDoneClaim(toolName, input) {
  const name = String(toolName || '');
  const status = typeof input.status === 'string' ? input.status.trim().toLowerCase() : '';
  if ((name === 'record_task_outcome' || name === 'verify_claim') && (status === 'completed' || status === 'done')) {
    return true;
  }
  return input.modelSaysDone === true || input.goalDone === true || oneShotFlag(input.budgetExhausted);
}

function oneShotEvidenceBacked(input) {
  const verification = input && input.verification;
  if (!verification || typeof verification !== 'object' || Array.isArray(verification)) return false;
  const evidence = verification.evidence;
  const worker = oneShotId(input.workerId) || 'worker';
  const verifier = oneShotId(verification.verifier);
  return verification.performed === true
    && verification.passed === true
    && Array.isArray(evidence)
    && evidence.length > 0
    && verifier !== worker;
}

function oneShotLiveGoalInput(input = {}) {
  const status = typeof input.status === 'string' ? input.status.trim().toLowerCase() : '';
  const goalInput = {
    budgetExhausted: input.budgetExhausted,
    modelSaysDone: input.modelSaysDone === true
      || input.goalDone === true
      || status === 'completed'
      || status === 'done',
    workerId: oneShotId(input.workerId) || 'worker',
    confirmerId: '',
    verification: input.verification,
  };
  const verification = input.verification;
  const verificationFailed = Boolean(verification)
    && typeof verification === 'object'
    && !Array.isArray(verification)
    && verification.passed === false;
  const checkFailed = Boolean(input.check) && typeof input.check === 'object' && input.check.passed === false;
  if (verificationFailed || checkFailed) {
    const missing = checkFailed && Array.isArray(input.check.missing) ? input.check.missing : undefined;
    goalInput.check = missing ? { passed: false, missing } : { passed: false };
    return goalInput;
  }
  if (oneShotEvidenceBacked(input)) {
    goalInput.check = { writtenAt: 0, passed: true };
    goalInput.runStartedAt = 1;
    return goalInput;
  }
  return goalInput;
}

const ONESHOT_CONTROL_KEYS = new Set([
  'toolName',
  'toolInput',
  'quotedUsd',
  'idempotencyKey',
  'cashCapUsd',
  'ledgerReadable',
  'uncapped',
  'irreversible',
  'approvalRequired',
  'approval',
  'perCallCapUsd',
  'dailyCapUsd',
  'spentTodayUsd',
  'inFlightUsd',
  'chargedKeys',
  'inFlightKeys',
  'now',
  'budgetExhausted',
  'modelSaysDone',
  'goalDone',
  'status',
  'workerId',
  'confirmerId',
  'runStartedAt',
  'check',
  'verification',
]);

function oneShotActionBody(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  if (input.toolInput && typeof input.toolInput === 'object') return input.toolInput;
  const body = {};
  for (const key of Object.keys(input)) {
    if (ONESHOT_CONTROL_KEYS.has(key)) continue;
    body[key] = input[key];
  }
  return body;
}

function oneShotHookDeny(gate, detail) {
  const ruleId = detail && detail.reason ? detail.reason : 'held';
  const message = gate === 'oneshot-goal-done'
    ? `ThumbGate refused this done-claim (${ruleId}) [oneshot-goal-done]. The worker cannot mark its own goal done.`
    : `ThumbGate refused this quoted action (${ruleId}) [oneshot-control]. The agent cash cap stays $0.`;
  return {
    decision: 'deny',
    gate,
    ruleId,
    reason: message,
    message,
    severity: 'high',
    oneShot: detail,
  };
}

function evaluateOneShotPretool(toolName, toolInput) {
  if (!oneShotPayloadNeedsControl(toolName, toolInput)) return null;
  const input = toolInput;
  const quoted = Object.prototype.hasOwnProperty.call(input, 'quotedUsd')
    || oneShotFlag(input.uncapped)
    || oneShotFlag(input.irreversible)
    || oneShotFlag(input.approvalRequired);
  if (quoted) {
    const control = evaluateOneShotControl({
      ...input,
      toolName: typeof input.toolName === 'string' && input.toolName ? input.toolName : toolName,
      toolInput: oneShotActionBody(input),
      cashCapUsd: 0,
    });
    if (control.verdict !== 'allow') return oneShotHookDeny('oneshot-control', control);
  }
  if (oneShotIsDoneClaim(toolName, input)) {
    const goal = evaluateOneShotGoalDone(oneShotLiveGoalInput(input));
    if (!goal.done) return oneShotHookDeny('oneshot-goal-done', goal);
  }
  return null;
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
  reconstructModelVisibleFacts,
  buildReceiptContextEntries,
  computeCanonicalRequestDigest,
  resolveReceiptSigningKey,
  signReceiptDigest,
  verifyReceiptSignature,
  hashOneShotAction,
  evaluateOneShotControl,
  evaluateOneShotGoalDone,
  evaluateOneShotPretool,
  oneShotPayloadNeedsControl,
  oneShotLiveGoalInput,
  // exposed for testing / reuse
  summarizeInput,
  summarizeOutcome,
  resolveFeedbackActionId,
};
