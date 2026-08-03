#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveFeedbackDir } = require('./feedback-paths');

const SPEND_CONTROL_GATE_ID = 'financial-spend-authorization-required';
const SPEND_AUTH_TTL_MS = 10 * 60 * 1000;
const SPEND_STATE_LOCK_TIMEOUT_MS = 2_000;
const SPEND_STATE_LOCK_STALE_MS = 30_000;
const MAX_ACTION_TEXT_CHARS = 20_000;
const MAX_AMOUNT_CENTS = 100_000_000_000;
const LOCK_SLEEPER = new Int32Array(new SharedArrayBuffer(4));

const EXPLICIT_AUTHORIZATION_PATTERNS = [
  /\bi\s+(?:hereby\s+|explicitly\s+)?authorize\b/i,
  /\bi\s+(?:hereby\s+|explicitly\s+)?approve\b/i,
  /\byou\s+may\b/i,
  /\byou\s+are\s+(?:explicitly\s+)?authorized\s+to\b/i,
];
const NEGATED_AUTHORIZATION_PATTERN = /\b(?:do\s+not|don['’]?t|never|not)\s+(?:authorize|approve|allow|spend|pay|purchase|buy|upgrade|subscribe|renew)\b/i;
const FINANCIAL_INTENT_PATTERN = /\b(?:spend|buy|purchase|pay|upgrade|subscribe|renew|checkout|credits?|payment|billing)\b/i;
const FINANCIAL_ACTION_PATTERNS = [
  /\b(?:buy|purchase|pay|upgrade|downgrade|subscribe|unsubscribe|renew)\b/i,
  /\b(?:checkout|billing|pricing|transfer|wire|withdraw|refund|invoice)\b/i,
  /\b(?:credits?|top[ -]?up)\b/i,
  /\bcancel\s+(?:the\s+)?subscription\b/i,
  /\badd\s+(?:credits?|funds?|payment\s+method)\b/i,
  /\bplace\s+(?:an?\s+)?order\b/i,
  /\bconfirm\s+(?:an?\s+)?(?:order|purchase|payment)\b/i,
  /\bsubmit\s+(?:a\s+)?payment\b/i,
  /\bcharge\s+(?:my|the|a\s+)?card\b/i,
];
const READ_ONLY_TOOL_WORDS = new Set([
  'get', 'list', 'search', 'find', 'lookup', 'preview', 'estimate', 'quote', 'retrieve', 'fetch', 'read',
]);
const MUTATION_TOOL_WORDS = new Set([
  'create', 'submit', 'complete', 'update', 'change', 'activate', 'upgrade', 'cancel',
  'attach', 'confirm', 'buy', 'purchase', 'charge', 'place', 'execute', 'send', 'issue',
]);
const FINANCIAL_RESOURCE_WORDS = new Set([
  'billing', 'plan', 'seat', 'seats', 'credit', 'credits', 'checkout', 'subscription', 'payment',
]);
const TRANSFER_TOOL_WORDS = new Set(['bank', 'wire', 'fund', 'funds', 'money']);
const SPEND_ENVELOPE_KEYS = new Set(['thumbgateSpend', 'thumbgate_spend', 'purchaseOrder']);
const SENSITIVE_ACTION_KEY_PATTERN = /token|secret|password|authorization|cookie|api.?key/i;
const BASH_EXTERNAL_ACTION_PATTERN = /\b(?:curl|wget|http|open|osascript|playwright|selenium|stripe|apollo|browser|chrome)\b/i;
const EXTERNAL_TOOL_PATTERN = /(?:bash|shell|exec|browser|chrome|computer|playwright|selenium|web|http|api|click|navigate|mcp)/i;
const CHECKOUT_ENTRY_WORDS = new Set(['open', 'navigate', 'visit', 'goto']);
const CHECKOUT_ENTRY_ACTIONS = new Set(['open', 'navigate', 'visit', 'goto', 'go_to']);
const BASH_CHECKOUT_ENTRY_PATTERN = /^\s*(?:open|xdg-open|start)\s+(?:['"]?https?:\/\/)?/i;

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function toolNameWords(toolName) {
  return normalizeText(toolName)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[_:.-]+/)
    .filter(Boolean);
}

function hasAnyWord(words, candidates) {
  return words.some((word) => candidates.has(word));
}

function hasWordPair(words, left, right) {
  return words.includes(left) && words.includes(right);
}

function isReadOnlyTool(words) {
  const hasMutationVerb = hasAnyWord(words, MUTATION_TOOL_WORDS);
  const endsWithStatus = words.at(-1) === 'status';
  return !hasMutationVerb && (hasAnyWord(words, READ_ONLY_TOOL_WORDS) || endsWithStatus);
}

function isNamedPurchaseTool(words) {
  return words.includes('purchase')
    || hasWordPair(words, 'buy', 'credits')
    || hasWordPair(words, 'charge', 'card');
}

function isTransferOrOrderTool(words) {
  const transfer = words.includes('transfer')
    && hasAnyWord(words, TRANSFER_TOOL_WORDS);
  const remittance = words.includes('send')
    && hasAnyWord(words, TRANSFER_TOOL_WORDS);
  const order = words.includes('order') && hasAnyWord(words, MUTATION_TOOL_WORDS);
  const withdrawal = words.includes('withdraw') || words.includes('withdrawal');
  const payout = words.includes('payout') && hasAnyWord(words, MUTATION_TOOL_WORDS);
  const refund = words.includes('refund') && hasAnyWord(words, MUTATION_TOOL_WORDS);
  return transfer || remittance || order || withdrawal || payout || refund;
}

function isFinancialResourceMutation(words) {
  return hasAnyWord(words, FINANCIAL_RESOURCE_WORDS)
    && hasAnyWord(words, MUTATION_TOOL_WORDS);
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeVendor(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9&+ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function amountToCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = typeof value === 'number'
    ? String(value)
    : String(value).replace(/[$£€¥,\s]/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) return null;
  return cents;
}

function parseMoney(text) {
  const value = normalizeText(text);
  let match = /\$\s*(\d{1,9}(?:,\d{3})*(?:\.\d{1,2})?)/.exec(value);
  if (match) return { amountCents: amountToCents(match[1]), currency: 'USD' };

  match = /\b([A-Z]{3})\s*(\d{1,9}(?:,\d{3})*(?:\.\d{1,2})?)\b/.exec(value);
  if (match) return { amountCents: amountToCents(match[2]), currency: match[1].toUpperCase() };

  match = /\b(\d{1,9}(?:,\d{3})*(?:\.\d{1,2})?)\s*([A-Z]{3})\b/.exec(value);
  if (match) return { amountCents: amountToCents(match[1]), currency: match[2].toUpperCase() };
  return null;
}

function truncateAtMatch(value, pattern) {
  const match = pattern.exec(value);
  return match ? value.slice(0, match.index) : value;
}

function parseVendor(text) {
  const match = /\b(?:for|on|from|with)\s+(?:the\s+)?([a-z0-9][a-z0-9 .&+'_-]{1,80})/i.exec(normalizeText(text));
  if (!match) return null;
  let vendor = truncateAtMatch(match[1], /\s+(?:credits?|subscription|plan|purchase|checkout|upgrade|license|seats?)\b/i);
  vendor = truncateAtMatch(vendor, /\b(?:up\s+to|maximum|max)\b/i);
  vendor = truncateAtMatch(vendor, /[.,;:]/).trim();
  return vendor.length >= 2 ? vendor : null;
}

function parsePromptSpendAuthorization(prompt, metadata = {}) {
  const text = normalizeText(prompt).slice(0, 2_000);
  const sessionId = normalizeText(metadata.sessionId || metadata.session_id);
  if (!text || !sessionId) return null;
  if (NEGATED_AUTHORIZATION_PATTERN.test(text)) return null;
  if (!matchesAny(text, EXPLICIT_AUTHORIZATION_PATTERNS) || !FINANCIAL_INTENT_PATTERN.test(text)) return null;

  const money = parseMoney(text);
  const vendor = parseVendor(text);
  if (!money?.amountCents || !vendor) return null;

  const nowMs = Number.isFinite(metadata.nowMs) ? metadata.nowMs : Date.now();
  return {
    id: `spend_auth_${crypto.randomUUID()}`,
    sessionId,
    promptId: normalizeText(metadata.promptId || metadata.prompt_id) || null,
    promptHash: crypto.createHash('sha256').update(text).digest('hex'),
    vendor,
    normalizedVendor: normalizeVendor(vendor),
    currency: money.currency,
    maxAmountCents: money.amountCents,
    remainingAmountCents: money.amountCents,
    source: 'human_user_prompt',
    status: 'pending',
    createdAt: new Date(nowMs).toISOString(),
    timestamp: nowMs,
    expiresAt: nowMs + SPEND_AUTH_TTL_MS,
    reservations: [],
  };
}

function getSpendControlPaths(options = {}) {
  const feedbackDir = resolveFeedbackDir({
    feedbackDir: options.feedbackDir,
    env: options.env || process.env,
    cwd: options.cwd,
    projectDir: options.projectDir,
  });
  return {
    feedbackDir,
    statePath: path.join(feedbackDir, 'spend-authorizations.json'),
    receiptsPath: path.join(feedbackDir, 'spend-decision-receipts.jsonl'),
    lockPath: path.join(feedbackDir, 'spend-control.lock'),
  };
}

function waitForLock(milliseconds) {
  Atomics.wait(LOCK_SLEEPER, 0, 0, milliseconds);
}

function removePathIfPresent(targetPath, options = {}) {
  try {
    fs.rmSync(targetPath, options);
    return true;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

function clearStaleLock(lockPath, lockStaleMs) {
  try {
    const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    return ageMs > lockStaleMs
      ? removePathIfPresent(lockPath, { recursive: true, force: true })
      : false;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

function acquireSpendControlLock(lockPath, lockTimeoutMs, lockStaleMs) {
  const startedAt = Date.now();

  while (true) {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
      return { acquired: true };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        return { acquired: false, error };
      }
      if (clearStaleLock(lockPath, lockStaleMs)) continue;
      if (Date.now() - startedAt >= lockTimeoutMs) {
        return { acquired: false, error: new Error('spend control ledger is busy') };
      }
      waitForLock(10);
    }
  }
}

function withSpendControlLock(callback, options = {}) {
  const { feedbackDir, lockPath } = getSpendControlPaths(options);
  const lockTimeoutMs = Number.isFinite(options.lockTimeoutMs)
    ? Math.max(0, options.lockTimeoutMs)
    : SPEND_STATE_LOCK_TIMEOUT_MS;
  const lockStaleMs = Number.isFinite(options.lockStaleMs)
    ? Math.max(1, options.lockStaleMs)
    : SPEND_STATE_LOCK_STALE_MS;
  fs.mkdirSync(feedbackDir, { recursive: true });
  const lock = acquireSpendControlLock(lockPath, lockTimeoutMs, lockStaleMs);
  if (!lock.acquired) return lock;

  try {
    return { acquired: true, value: callback() };
  } catch (error) {
    return { acquired: true, error };
  } finally {
    removePathIfPresent(lockPath, { recursive: true, force: true });
  }
}

function defaultState() {
  return { version: 1, authorizations: [] };
}

function readState(options = {}) {
  const { statePath } = getSpendControlPaths(options);
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return {
      version: 1,
      authorizations: Array.isArray(parsed.authorizations) ? parsed.authorizations : [],
    };
  } catch {
    return defaultState();
  }
}

function writeState(state, options = {}) {
  const { statePath } = getSpendControlPaths(options);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tempPath, statePath);
  } finally {
    removePathIfPresent(tempPath, { force: true });
  }
}

function appendReceipt(receipt, options = {}) {
  const { receiptsPath } = getSpendControlPaths(options);
  fs.mkdirSync(path.dirname(receiptsPath), { recursive: true });
  fs.appendFileSync(receiptsPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  return receipt;
}

function tryAppendReceipt(receipt, options = {}) {
  try {
    appendReceipt(receipt, options);
    return true;
  } catch (error) {
    options.onReceiptError?.(error);
    return false;
  }
}

function capturePromptSpendAuthorization(prompt, metadata = {}, options = {}) {
  const sessionId = normalizeText(metadata.sessionId || metadata.session_id);
  if (!sessionId) return { recorded: false, reason: 'session_id_required', authorization: null };

  const nowMs = Number.isFinite(metadata.nowMs) ? metadata.nowMs : Date.now();
  const locked = withSpendControlLock(() => {
    const state = readState(options);
    for (const authorization of state.authorizations) {
      if (authorization.sessionId === sessionId && authorization.status === 'pending') {
        authorization.status = 'revoked';
        authorization.revokedAt = new Date(nowMs).toISOString();
        authorization.revocationReason = 'superseded_by_new_user_prompt';
      }
    }

    const authorization = parsePromptSpendAuthorization(prompt, { ...metadata, sessionId, nowMs });
    if (authorization) {
      const receipt = {
        id: `spend_receipt_${crypto.randomUUID()}`,
        event: 'authorization_created',
        decision: 'authorize',
        authorizationId: authorization.id,
        sessionId,
        vendor: authorization.vendor,
        currency: authorization.currency,
        maxAmountCents: authorization.maxAmountCents,
        timestamp: nowMs,
      };
      // Never create usable authority without first creating its audit record.
      // An orphaned receipt is safe; an unaudited authorization is not.
      appendReceipt(receipt, options);
      authorization.auditReceiptId = receipt.id;
      state.authorizations.push(authorization);
    }
    state.authorizations = state.authorizations.slice(-100);
    writeState(state, options);
    return authorization;
  }, options);

  if (!locked.acquired || locked.error) {
    return { recorded: false, reason: 'spend_control_unavailable', authorization: null };
  }
  if (!locked.value) {
    return { recorded: false, reason: 'explicit_vendor_amount_authorization_required', authorization: null };
  }
  return { recorded: true, reason: null, authorization: locked.value };
}

function collectActionText(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map((entry) => collectActionText(entry, depth + 1)).join(' ');
  if (typeof value !== 'object') return '';
  return Object.entries(value)
    .filter(([key]) => !SPEND_ENVELOPE_KEYS.has(key) && !SENSITIVE_ACTION_KEY_PATTERN.test(key))
    .map(([, entry]) => collectActionText(entry, depth + 1))
    .join(' ');
}

function normalizeSpendEnvelope(toolInput = {}) {
  const raw = toolInput.thumbgateSpend || toolInput.thumbgate_spend || toolInput.purchaseOrder;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const amountCents = raw.amountCents !== undefined
    ? Number(raw.amountCents)
    : amountToCents(raw.amount);
  const currency = normalizeText(raw.currency || 'USD').toUpperCase();
  const vendor = normalizeText(raw.vendor);
  const operation = normalizeText(raw.operation || raw.action || 'purchase').toLowerCase();
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_AMOUNT_CENTS) return null;
  if (!/^[A-Z]{3}$/.test(currency) || vendor.length < 2 || vendor.length > 100) return null;
  return { amountCents, currency, vendor, normalizedVendor: normalizeVendor(vendor), operation };
}

function isDirectFinancialTool(toolName) {
  const words = toolNameWords(toolName);
  if (isReadOnlyTool(words)) return false;
  return isNamedPurchaseTool(words)
    || isTransferOrOrderTool(words)
    || isFinancialResourceMutation(words);
}

function isCheckoutEntryAction(toolName, toolInput = {}) {
  const normalizedTool = normalizeText(toolName);
  if (isDirectFinancialTool(normalizedTool)) return false;

  const action = normalizeText(toolInput.action || toolInput.method || toolInput.commandName).toLowerCase();
  if (CHECKOUT_ENTRY_ACTIONS.has(action)) return true;
  const words = toolNameWords(normalizedTool);
  if (hasAnyWord(words, CHECKOUT_ENTRY_WORDS) || hasWordPair(words, 'go', 'to')) return true;

  const command = normalizeText(toolInput.command);
  return /^(?:bash|shell|exec)$/i.test(normalizedTool)
    && BASH_CHECKOUT_ENTRY_PATTERN.test(command);
}

function classifyFinancialAction(toolName, toolInput = {}) {
  const normalizedTool = normalizeText(toolName);
  const envelope = normalizeSpendEnvelope(toolInput);
  const text = normalizeText(collectActionText(toolInput)).slice(0, MAX_ACTION_TEXT_CHARS);
  const directFinancialTool = isDirectFinancialTool(normalizedTool);
  const checkoutEntry = isCheckoutEntryAction(normalizedTool, toolInput);
  const operation = checkoutEntry ? 'checkout_entry' : 'financial_mutation';
  if (envelope) {
    return {
      envelope,
      actionText: text,
      operation,
      commit: !checkoutEntry,
    };
  }

  if (!directFinancialTool && (!EXTERNAL_TOOL_PATTERN.test(normalizedTool) || !matchesAny(text, FINANCIAL_ACTION_PATTERNS))) return null;
  if (/^(?:bash|shell|exec)$/i.test(normalizedTool) && !BASH_EXTERNAL_ACTION_PATTERN.test(text)) return null;

  return { envelope: null, actionText: text, operation, commit: !checkoutEntry };
}

function vendorsMatch(authorizedVendor, declaredVendor) {
  const allowed = normalizeVendor(authorizedVendor);
  const requested = normalizeVendor(declaredVendor);
  if (!allowed || !requested) return false;
  return allowed === requested || allowed.startsWith(`${requested} `) || requested.startsWith(`${allowed} `);
}

function buildActionFingerprint(input, action) {
  const material = action.envelope
    ? [
      action.operation,
      action.envelope.normalizedVendor,
      action.envelope.currency,
      action.envelope.amountCents,
    ].join('|')
    : [
      normalizeText(input.tool_name || input.toolName),
      action.operation,
      action.actionText,
    ].join('|');
  return crypto.createHash('sha256').update(material).digest('hex');
}

function denySpend(reasonCode, message, input, action, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const receipt = {
    id: `spend_receipt_${crypto.randomUUID()}`,
    event: 'financial_action_evaluated',
    decision: 'deny',
    reasonCode,
    sessionId: normalizeText(input.session_id || input.sessionId) || null,
    operation: action.operation,
    vendor: action.envelope ? action.envelope.vendor : null,
    currency: action.envelope ? action.envelope.currency : null,
    amountCents: action.envelope ? action.envelope.amountCents : null,
    actionHash: buildActionFingerprint(input, action),
    timestamp: nowMs,
  };
  const receiptPersisted = tryAppendReceipt(receipt, options);
  return {
    decision: 'deny',
    gate: SPEND_CONTROL_GATE_ID,
    severity: 'critical',
    message: receiptPersisted
      ? `${message} Audit receipt: ${receipt.id}.`
      : `${message} The audit ledger is unavailable; the action remains blocked.`,
    reasoning: [
      'Financial side effects require a human-origin authorization from the current user turn',
      'Vendor, currency, and maximum amount must match a structured thumbgateSpend declaration',
      'This hard floor is not downgraded by warn-by-default mode, quotas, or operator bypass',
    ],
    spendReceipt: { ...receipt, persisted: receiptPersisted },
  };
}

function evaluateSpendControl(input = {}, options = {}) {
  const controlOptions = {
    ...options,
    projectDir: options.projectDir || input.cwd || input.project_dir || input.projectDir,
  };
  const toolName = input.tool_name || input.toolName || '';
  const toolInput = input.tool_input || input.toolInput || {};
  const action = classifyFinancialAction(toolName, toolInput);
  if (!action) return null;

  if (!action.envelope) {
    return denySpend(
      'structured_spend_declaration_required',
      'Financial action blocked. Declare vendor, amount, currency, and operation in tool_input.thumbgateSpend.',
      input,
      action,
      controlOptions,
    );
  }

  const sessionId = normalizeText(input.session_id || input.sessionId);
  if (!sessionId) {
    return denySpend('session_id_required', 'Financial action blocked because the runtime supplied no session ID.', input, action, controlOptions);
  }

  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const locked = withSpendControlLock(() => {
    const state = readState(controlOptions);
    const authorization = [...state.authorizations].reverse().find((entry) => (
      entry?.sessionId === sessionId && entry.status === 'pending'
    ));
    if (!authorization) return { reasonCode: 'current_prompt_authorization_required' };
    if (!authorization.auditReceiptId) return { reasonCode: 'authorization_audit_missing' };

    if (nowMs >= Number(authorization.expiresAt || 0)) {
      authorization.status = 'expired';
      authorization.expiredAt = new Date(nowMs).toISOString();
      writeState(state, controlOptions);
      return { reasonCode: 'authorization_expired' };
    }
    if (authorization.currency !== action.envelope.currency) return { reasonCode: 'currency_mismatch' };
    if (!vendorsMatch(authorization.vendor, action.envelope.vendor)) return { reasonCode: 'vendor_mismatch' };
    if (action.envelope.amountCents > authorization.remainingAmountCents) {
      return { reasonCode: 'amount_exceeds_authorization' };
    }

    const actionHash = buildActionFingerprint(input, action);
    if (action.commit && authorization.reservations.some((entry) => entry.actionHash === actionHash)) {
      return { reasonCode: 'duplicate_financial_action' };
    }

    const receipt = {
      id: `spend_receipt_${crypto.randomUUID()}`,
      event: 'financial_action_evaluated',
      decision: 'allow',
      authorizationId: authorization.id,
      sessionId,
      operation: action.operation,
      vendor: action.envelope.vendor,
      currency: action.envelope.currency,
      amountCents: action.envelope.amountCents,
      actionHash,
      reservation: action.commit,
      timestamp: nowMs,
    };

    // Persist the allow receipt before consuming authorization. If the receipt
    // cannot be written, the state remains untouched and the action is denied.
    if (!tryAppendReceipt(receipt, controlOptions)) return { reasonCode: 'audit_ledger_unavailable' };

    if (action.commit) {
      authorization.remainingAmountCents -= action.envelope.amountCents;
      authorization.reservations.push({
        receiptId: receipt.id,
        actionHash,
        amountCents: action.envelope.amountCents,
        timestamp: nowMs,
      });
      if (authorization.remainingAmountCents === 0) {
        authorization.status = 'consumed';
        authorization.consumedAt = new Date(nowMs).toISOString();
      }
      writeState(state, controlOptions);
    }
    return { allowed: true };
  }, controlOptions);

  if (!locked.acquired || locked.error) {
    return denySpend(
      'spend_control_unavailable',
      'Financial action blocked because the authorization ledger is unavailable.',
      input,
      action,
      controlOptions,
    );
  }
  if (locked.value.allowed) return null;

  const denialMessages = {
    current_prompt_authorization_required: 'Financial action blocked. The current human message must explicitly authorize a vendor and maximum amount.',
    authorization_audit_missing: 'Financial action blocked because its authorization has no durable audit receipt.',
    authorization_expired: 'Financial action blocked because the current spend authorization expired.',
    currency_mismatch: 'Financial action blocked because its currency does not match the human authorization.',
    vendor_mismatch: 'Financial action blocked because its vendor does not match the human authorization.',
    amount_exceeds_authorization: 'Financial action blocked because its amount exceeds the remaining human-authorized maximum.',
    duplicate_financial_action: 'Financial action blocked because the same purchase was already reserved.',
    audit_ledger_unavailable: 'Financial action blocked because its allow receipt could not be written.',
  };
  const reasonCode = locked.value.reasonCode || 'spend_control_unavailable';
  return denySpend(reasonCode, denialMessages[reasonCode] || 'Financial action blocked by the spend control hard floor.', input, action, controlOptions);
}

function getSpendControlStatus(options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const state = readState(options);
  return {
    version: state.version,
    pending: state.authorizations.filter((entry) => entry.status === 'pending' && nowMs < Number(entry.expiresAt || 0)),
    authorizations: state.authorizations,
    paths: getSpendControlPaths(options),
  };
}

module.exports = {
  SPEND_AUTH_TTL_MS,
  SPEND_CONTROL_GATE_ID,
  SPEND_STATE_LOCK_STALE_MS,
  SPEND_STATE_LOCK_TIMEOUT_MS,
  amountToCents,
  capturePromptSpendAuthorization,
  classifyFinancialAction,
  evaluateSpendControl,
  getSpendControlPaths,
  getSpendControlStatus,
  normalizeSpendEnvelope,
  parsePromptSpendAuthorization,
  vendorsMatch,
};
