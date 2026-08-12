#!/usr/bin/env node
'use strict';

/**
 * MCP Tool Idempotency Guard
 *
 * Enforces idempotency keys for MCP tool calls so a retry after a lost session handle
 * does not quietly create a second object. Covers the high-ROI control from the
 * August 2026 MCP Stateless Specification update:
 * "I use idempotency keys so a retry after a lost handle doesn’t quietly create a second object."
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_IDEMPOTENCY_KEYS = 50000;

const IDEMPOTENCY_KEY_FIELDS = ['idempotencyKey', 'idempotency_key', 'idempotencyId'];
const METADATA_FIELDS = new Set([
  'idempotencyKey',
  'idempotency_key',
  'idempotencyId',
  'mcpSessionHandle',
  'sessionId',
  'session_id',
  'taskScopeId',
  'basketId',
  'browserId',
  'timestamp',
  'requestTimestamp',
  'turn',
  'turnDepth',
]);

let cachedDefaultStore = null;
let cachedDefaultStorePath = null;

function resolveStateDir() {
  if (process.env.THUMBGATE_STATE_DIR) return process.env.THUMBGATE_STATE_DIR;
  if (process.env.XDG_STATE_HOME) return path.join(process.env.XDG_STATE_HOME, 'thumbgate');
  if (process.env.CODEX_SANDBOX) return path.join(require('os').tmpdir(), 'thumbgate');
  return path.join(process.env.HOME || require('os').tmpdir(), '.thumbgate');
}

function getDefaultStorePath() {
  return path.join(resolveStateDir(), 'mcp-idempotency-keys.json');
}

function loadDefaultStore() {
  const storePath = getDefaultStorePath();
  if (cachedDefaultStore && cachedDefaultStorePath === storePath) return cachedDefaultStore;
  cachedDefaultStorePath = storePath;
  if (fs.existsSync(storePath)) {
    try {
      const raw = fs.readFileSync(storePath, 'utf8');
      const data = JSON.parse(raw);
      const entries = Object.entries(data || {});
      const now = Date.now();
      // Drop expired entries on load.
      const valid = entries.filter(([, record]) => record.expiresAt > now);
      cachedDefaultStore = new Map(valid);
      return cachedDefaultStore;
    } catch {
      cachedDefaultStore = new Map();
      return cachedDefaultStore;
    }
  }
  cachedDefaultStore = new Map();
  return cachedDefaultStore;
}

function saveDefaultStore() {
  const storePath = getDefaultStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const data = Object.fromEntries((cachedDefaultStore || new Map()).entries());
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2) + '\n');
}

function resolveStore(options = {}) {
  if (options && options.store instanceof Map) return options.store;
  return loadDefaultStore();
}

function capSet(store, key, value) {
  if (store.size >= MAX_IDEMPOTENCY_KEYS && !store.has(key)) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, value);
}

function extractIdempotencyKey(args = {}) {
  if (!args || typeof args !== 'object') return undefined;
  for (const field of IDEMPOTENCY_KEY_FIELDS) {
    if (args[field] != null && args[field] !== '') return String(args[field]);
  }
  return undefined;
}

function canonicalizeForDigest(toolName, toolInput) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const cleaned = {};
  const keys = Object.keys(input).sort();
  for (const key of keys) {
    if (METADATA_FIELDS.has(key)) continue;
    const value = input[key];
    if (value === undefined) continue;
    cleaned[key] = value;
  }
  return JSON.stringify({ toolName, input: cleaned });
}

function computeActionDigest(toolName, toolInput) {
  const canonical = canonicalizeForDigest(toolName, toolInput);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Check an idempotency key for a tool call.
 *
 * @param {object} options
 * @param {string} options.idempotencyKey - Optional caller-provided key.
 * @param {string} options.toolName
 * @param {object} options.toolInput
 * @param {boolean} options.sideEffect - Whether the tool may mutate state.
 * @param {string} options.agentId - Caller identity.
 * @param {Map} options.store - Optional in-memory store for tests.
 * @param {number} options.now - Optional timestamp override for tests.
 * @param {boolean} options.required - Whether keys are mandatory for side-effect calls.
 * @returns {object} { allowed: boolean, code: string, isDuplicate?: boolean, record?: object }.
 */
function checkIdempotencyKey(options = {}) {
  const {
    idempotencyKey: providedKey,
    toolName,
    toolInput,
    sideEffect = false,
    agentId = 'unknown',
    store: providedStore,
    now: providedNow,
    required = false,
  } = options;

  const key = providedKey !== undefined ? providedKey : extractIdempotencyKey(toolInput);
  const now = typeof providedNow === 'number' ? providedNow : Date.now();

  if (key === undefined || key === null || key === '') {
    if (required && sideEffect) {
      return {
        allowed: false,
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        reason: `Side-effect tool '${toolName}' requires an idempotency key.`,
      };
    }
    return {
      allowed: true,
      code: 'IDEMPOTENCY_KEY_NOT_REQUIRED',
      reason: 'No idempotency key provided; no enforcement necessary.',
    };
  }

  if (typeof key !== 'string' || key.length > 512) {
    return {
      allowed: false,
      code: 'IDEMPOTENCY_KEY_INVALID',
      reason: 'Idempotency key must be a non-empty string of at most 512 characters.',
    };
  }

  const actionDigest = computeActionDigest(toolName, toolInput);
  const store = resolveStore({ store: providedStore });
  const existing = store.get(key);

  if (existing) {
    if (existing.actionDigest !== actionDigest) {
      return {
        allowed: false,
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        reason: `Idempotency key '${key}' was reused with different arguments.`,
      };
    }
    if (existing.sideEffect && sideEffect) {
      return {
        allowed: false,
        code: 'DUPLICATE_SIDE_EFFECT',
        reason: `Duplicate side-effect request rejected for idempotency key '${key}'.`,
      };
    }
    return {
      allowed: true,
      code: 'IDEMPOTENCY_KEY_REUSED',
      isDuplicate: true,
      record: existing,
      reason: 'Idempotency key matches a previous identical request; returning idempotent result.',
    };
  }

  const record = {
    idempotencyKey: key,
    actionDigest,
    toolName,
    sideEffect,
    agentId,
    createdAt: now,
    expiresAt: now + DEFAULT_IDEMPOTENCY_TTL_MS,
  };

  capSet(store, key, record);
  if (!providedStore) saveDefaultStore();

  return {
    allowed: true,
    code: 'IDEMPOTENCY_KEY_STORED',
    isDuplicate: false,
    record,
    reason: 'Idempotency key stored for this request.',
  };
}

/**
 * Clear the in-memory default store cache. Useful for tests.
 */
function resetDefaultStore() {
  cachedDefaultStore = null;
  cachedDefaultStorePath = null;
}

module.exports = {
  checkIdempotencyKey,
  computeActionDigest,
  extractIdempotencyKey,
  resetDefaultStore,
  DEFAULT_IDEMPOTENCY_TTL_MS,
  MAX_IDEMPOTENCY_KEYS,
};
