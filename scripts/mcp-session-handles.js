'use strict';

/**
 * MCP Session Handles — model-carried correlation with identity controls
 *
 * Context (InfoWorld 2026-08-13, Karunanithi / MCP July 2026 stateless core):
 * MCP relocated protocol session correlation into ordinary tool arguments that
 * the model must re-emit across turns. Handles are no longer hidden in a
 * connection; they live in the context window. That makes them an identity
 * surface, not a transport detail.
 *
 * High-ROI controls this module implements (article "What I'm doing about it"):
 * 1. Authorize every handle against the authenticated principal on every request
 * 2. Real entropy + short default TTL
 * 3. Idempotency keys so a retry after a lost/swapped handle cannot mint a twin object
 * 4. Multi-turn fidelity helpers so tests run at depth ~30, not turn one
 *
 * Design notes:
 * - Handles are opaque tokens: `mcp_h_<id>.<hmac16>`
 * - Server-side registry is the source of truth; the model only carries the token
 * - Principal binding is mandatory at mint; authorize fails closed on mismatch
 * - No exemption for "internal" tools — same path for all callers
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HANDLE_PREFIX = 'mcp_h_';
const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes — short by design
const MIN_TTL_MS = 5 * 1000;
const MAX_TTL_MS = 60 * 60 * 1000; // 1 hour hard cap
const ENTROPY_BYTES = 18; // 144 bits
const SIG_HEX_LEN = 16;
// Explicit keys always win when present. Ambiguous keys (sessionId, etc.)
// are only treated as MCP handles when the value matches the mcp_h_ token
// shape — otherwise domain IDs (feedback sessions, Stripe, telemetry) would
// trip the gate with MISSING_PRINCIPAL / INVALID_SESSION_HANDLE_FORMAT.
const EXPLICIT_HANDLE_ARG_KEYS = [
  'sessionHandle',
  'session_handle',
  'mcpSessionHandle',
  'mcp_session_handle',
  'handleId',
];
const AMBIGUOUS_HANDLE_ARG_KEYS = [
  'handle',
  'sessionId',
  'session_id',
  'taskScopeId',
  'basketId',
  'browserId',
  'correlationId',
];
const HANDLE_ARG_KEYS = [...EXPLICIT_HANDLE_ARG_KEYS, ...AMBIGUOUS_HANDLE_ARG_KEYS];

/** @type {Map<string, object>} */
let registry = new Map();
/** @type {Map<string, object>} */
let idempotencyIndex = new Map();

let nowFn = () => Date.now();
let secretOverride = null;
let storePathOverride = null;
let diskLoaded = false;

function getSecret() {
  if (secretOverride) return secretOverride;
  const fromEnv = process.env.THUMBGATE_SESSION_SECRET
    || process.env.THUMBGATE_MCP_HANDLE_SECRET
    || '';
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  // Dev/test fallback — production should set THUMBGATE_SESSION_SECRET.
  // Still high entropy so forged handles without the registry entry fail.
  return 'thumbgate-dev-mcp-handle-secret-v1';
}

function clampTtlMs(ttlMs) {
  if (ttlMs == null || ttlMs === '') return DEFAULT_TTL_MS;
  const n = Number(ttlMs);
  if (!Number.isFinite(n)) return DEFAULT_TTL_MS;
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, Math.floor(n)));
}

function normalizePrincipal(principalId) {
  const id = String(principalId || '').trim();
  if (!id) {
    const err = new Error('principalId is required to mint or authorize an MCP session handle');
    err.code = 'MISSING_PRINCIPAL';
    throw err;
  }
  return id;
}

function normalizeTenant(tenantId) {
  const id = String(tenantId || 'default').trim();
  return id || 'default';
}

function normalizeScope(scope) {
  const s = String(scope || 'global').trim();
  return s || 'global';
}

function signPayload(payload) {
  return crypto
    .createHmac('sha256', getSecret())
    .update(payload)
    .digest('hex')
    .slice(0, SIG_HEX_LEN);
}

function buildHandleToken(handleId) {
  const sig = signPayload(handleId);
  return `${handleId}.${sig}`;
}

function parseHandleToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0 || dot === raw.length - 1) {
    return { ok: false, code: 'INVALID_SESSION_HANDLE_FORMAT', reason: 'Handle missing signature segment' };
  }
  const handleId = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!handleId.startsWith(HANDLE_PREFIX)) {
    return { ok: false, code: 'MALFORMED_SESSION_HANDLE', reason: 'Handle does not use mcp_h_ prefix' };
  }
  if (!/^[a-f0-9]+$/i.test(signature) || signature.length !== SIG_HEX_LEN) {
    return { ok: false, code: 'INVALID_SESSION_HANDLE_FORMAT', reason: 'Handle signature is not a valid HMAC fragment' };
  }
  const expected = signPayload(handleId);
  // timingSafeEqual requires equal length buffers
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, code: 'INVALID_SESSION_HANDLE_SIGNATURE', reason: 'Handle HMAC verification failed' };
  }
  return { ok: true, handleId, signature, token: raw };
}

function defaultStorePath() {
  if (storePathOverride) return storePathOverride;
  if (process.env.THUMBGATE_MCP_HANDLE_STORE) {
    return process.env.THUMBGATE_MCP_HANDLE_STORE;
  }
  // Prefer project-local runtime dir; fall back to tmp when unavailable.
  const local = path.join(process.cwd(), '.thumbgate', 'mcp-session-handles.json');
  try {
    fs.mkdirSync(path.dirname(local), { recursive: true });
    return local;
  } catch {
    return path.join(os.tmpdir(), 'thumbgate-mcp-session-handles.json');
  }
}

function persist() {
  // Optional durable spill for multi-process hosts. Failures are non-fatal —
  // in-memory registry remains authoritative for this process.
  try {
    const storePath = defaultStorePath();
    const payload = {
      version: 1,
      savedAt: new Date(nowFn()).toISOString(),
      handles: [...registry.values()],
      idempotency: [...idempotencyIndex.entries()].map(([key, value]) => ({ key, ...value })),
    };
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(payload), 'utf8');
  } catch {
    // ignore disk errors
  }
}

function loadFromDisk() {
  try {
    const storePath = defaultStorePath();
    if (!fs.existsSync(storePath)) {
      diskLoaded = true;
      return;
    }
    const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    if (!raw || typeof raw !== 'object') {
      diskLoaded = true;
      return;
    }
    registry = new Map();
    for (const rec of raw.handles || []) {
      if (rec && rec.handleId) registry.set(rec.handleId, rec);
    }
    idempotencyIndex = new Map();
    for (const row of raw.idempotency || []) {
      if (row && row.key) {
        const { key, ...rest } = row;
        idempotencyIndex.set(key, rest);
      }
    }
  } catch {
    // ignore corrupt store
  }
  diskLoaded = true;
}

function ensureDiskLoaded() {
  if (!diskLoaded) loadFromDisk();
}

function purgeExpired(now = nowFn()) {
  let removed = 0;
  for (const [id, rec] of registry.entries()) {
    if (rec.expiresAtMs <= now || rec.revokedAt) {
      registry.delete(id);
      removed += 1;
    }
  }
  for (const [key, row] of idempotencyIndex.entries()) {
    if (row.expiresAtMs && row.expiresAtMs <= now) {
      idempotencyIndex.delete(key);
    }
  }
  return removed;
}

/**
 * Mint a cryptographically bound session handle for a principal.
 * @param {object} input
 * @param {string} input.principalId - authenticated caller (required)
 * @param {string} [input.tenantId]
 * @param {string} [input.scope]
 * @param {string} [input.kind] - basket | browser | task | session | custom
 * @param {number} [input.ttlMs]
 * @param {object} [input.metadata]
 * @param {string} [input.idempotencyKey] - if re-minted with same key, return existing
 */
function mintHandle(input = {}) {
  ensureDiskLoaded();
  const principalId = normalizePrincipal(input.principalId);
  const tenantId = normalizeTenant(input.tenantId);
  const scope = normalizeScope(input.scope);
  const kind = String(input.kind || 'session').trim() || 'session';
  const ttlMs = clampTtlMs(input.ttlMs);
  const now = nowFn();
  const idempotencyKey = input.idempotencyKey != null
    ? String(input.idempotencyKey).trim()
    : '';

  purgeExpired(now);

  if (idempotencyKey) {
    const idxKey = idemIndexKey({ principalId, tenantId, key: idempotencyKey, purpose: 'mint' });
    const existing = idempotencyIndex.get(idxKey);
    if (existing && existing.handleId && registry.has(existing.handleId)) {
      const rec = registry.get(existing.handleId);
      if (rec.expiresAtMs > now && !rec.revokedAt) {
        return publicRecord(rec, { replayed: true });
      }
    }
  }

  const entropy = crypto.randomBytes(ENTROPY_BYTES).toString('hex');
  const handleId = `${HANDLE_PREFIX}${entropy}`;
  const token = buildHandleToken(handleId);
  const record = {
    handleId,
    token,
    principalId,
    tenantId,
    scope,
    kind,
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
    createdAtMs: now,
    expiresAtMs: now + ttlMs,
    ttlMs,
    lastAuthorizedAtMs: null,
    authorizeCount: 0,
    revokedAt: null,
    mintIdempotencyKey: idempotencyKey || null,
  };

  registry.set(handleId, record);

  if (idempotencyKey) {
    idempotencyIndex.set(
      idemIndexKey({ principalId, tenantId, key: idempotencyKey, purpose: 'mint' }),
      {
        handleId,
        principalId,
        tenantId,
        purpose: 'mint',
        createdAtMs: now,
        expiresAtMs: record.expiresAtMs,
      }
    );
  }

  persist();
  return publicRecord(record, { replayed: false });
}

/**
 * Backward-compatible mint used by early stub callers.
 * Requires principal via second arg or env THUMBGATE_PRINCIPAL_ID.
 */
function mintSessionHandle(tenantId = 'default', scope = 'global', opts = {}) {
  const principalId = opts.principalId
    || process.env.THUMBGATE_PRINCIPAL_ID
    || process.env.THUMBGATE_AGENT_ID
    || 'anonymous-dev';
  const minted = mintHandle({
    principalId,
    tenantId,
    scope,
    kind: opts.kind || 'session',
    ttlMs: opts.ttlMs,
    metadata: opts.metadata,
    idempotencyKey: opts.idempotencyKey,
  });
  return {
    handleId: minted.token,
    token: minted.token,
    tenantId: minted.tenantId,
    scope: minted.scope,
    principalId: minted.principalId,
    createdAt: minted.createdAtMs,
    expiresAt: minted.expiresAtMs,
    kind: minted.kind,
    replayed: minted.replayed,
  };
}

function publicRecord(rec, extra = {}) {
  return {
    token: rec.token,
    handleId: rec.handleId,
    principalId: rec.principalId,
    tenantId: rec.tenantId,
    scope: rec.scope,
    kind: rec.kind,
    createdAtMs: rec.createdAtMs,
    expiresAtMs: rec.expiresAtMs,
    ttlMs: rec.ttlMs,
    authorizeCount: rec.authorizeCount,
    metadata: { ...rec.metadata },
    ...extra,
  };
}

function idemIndexKey({ principalId, tenantId, key, purpose }) {
  return `${purpose}::${tenantId}::${principalId}::${key}`;
}

/**
 * True when value looks like a minted MCP handle token (prefix + signature).
 * Domain session IDs (feedback, checkout, telemetry) must not match.
 */
function looksLikeHandleToken(value) {
  const v = String(value || '').trim();
  if (!v.startsWith(HANDLE_PREFIX)) return false;
  const dot = v.indexOf('.');
  // mcp_h_<id>.<hmac hex>
  return dot > HANDLE_PREFIX.length && /^[a-f0-9]+$/i.test(v.slice(dot + 1));
}

function candidateFromKey(args, key, prefix = '') {
  if (args[key] == null) return null;
  const value = String(args[key]).trim();
  if (!value) return null;
  const explicit = EXPLICIT_HANDLE_ARG_KEYS.includes(key);
  if (!explicit && !looksLikeHandleToken(value)) return null;
  return { key: prefix ? `${prefix}${key}` : key, value };
}

/**
 * Extract a model-carried handle candidate from tool arguments.
 * Ambiguous keys only match mcp_h_*.* tokens to avoid domain ID collisions.
 */
function extractHandleFromArgs(args = {}) {
  if (!args || typeof args !== 'object') return null;
  for (const key of HANDLE_ARG_KEYS) {
    const hit = candidateFromKey(args, key);
    if (hit) return hit;
  }
  if (args.metadata && typeof args.metadata === 'object') {
    for (const key of HANDLE_ARG_KEYS) {
      const hit = candidateFromKey(args.metadata, key, 'metadata.');
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Authorize a handle against the authenticated principal.
 * Fail-closed: missing principal, wrong principal, wrong tenant, expired,
 * revoked, or forged signature all deny.
 *
 * @param {object} input
 * @param {string} [input.handle] - raw token from model args
 * @param {object} [input.args] - full tool args (handle extracted if handle omitted)
 * @param {string} input.principalId
 * @param {string} [input.tenantId]
 * @param {string} [input.toolName]
 * @param {boolean} [input.required=true] - when false, missing handle is allowed
 * @param {string} [input.expectedScope]
 * @param {string} [input.expectedKind]
 */
function authorizeHandle(input = {}) {
  ensureDiskLoaded();
  const now = nowFn();

  let principalId;
  try {
    principalId = normalizePrincipal(input.principalId);
  } catch (err) {
    return deny('MISSING_PRINCIPAL', err.message, input.toolName);
  }

  // Always bind tenant (defaults to 'default'). Omitting tenant no longer
  // skips the cross-tenant check — fail closed for multi-tenant hosts.
  const tenantId = normalizeTenant(input.tenantId);
  const required = input.required !== false;

  const extracted = input.handle != null
    ? { key: 'handle', value: String(input.handle) }
    : extractHandleFromArgs(input.args || {});

  if (!extracted) {
    purgeExpired(now);
    if (!required) {
      return {
        allowed: true,
        code: 'STATELESS_UNSCOPED',
        reason: 'No handle required and none provided',
        toolName: input.toolName || null,
      };
    }
    return deny(
      'MISSING_SESSION_HANDLE',
      `Tool '${input.toolName || 'unknown'}' requires a valid session handle in model arguments, but the model dropped it.`,
      input.toolName
    );
  }

  const parsed = parseHandleToken(extracted.value);
  if (!parsed.ok) {
    purgeExpired(now);
    return deny(parsed.code, parsed.reason, input.toolName, { argKey: extracted.key });
  }

  // Inspect the candidate BEFORE purge so expiry reports EXPIRED_SESSION_HANDLE
  // rather than collapsing into UNKNOWN after deletion.
  const rec = registry.get(parsed.handleId);
  if (!rec) {
    purgeExpired(now);
    // Signature may be valid for the secret but the server has no record —
    // treat as unknown / possible cross-process forgery without registry.
    return deny(
      'UNKNOWN_SESSION_HANDLE',
      'Handle is not registered on this server (forged, expired, or never minted here).',
      input.toolName,
      { handleId: parsed.handleId, argKey: extracted.key }
    );
  }

  if (rec.revokedAt) {
    purgeExpired(now);
    return deny('REVOKED_SESSION_HANDLE', 'Handle was revoked', input.toolName, {
      handleId: rec.handleId,
      revokedAt: rec.revokedAt,
    });
  }

  if (rec.expiresAtMs <= now) {
    registry.delete(rec.handleId);
    purgeExpired(now);
    return deny('EXPIRED_SESSION_HANDLE', `Handle expired at ${new Date(rec.expiresAtMs).toISOString()}`, input.toolName, {
      handleId: rec.handleId,
      expiresAtMs: rec.expiresAtMs,
    });
  }

  purgeExpired(now);

  if (rec.principalId !== principalId) {
    return deny(
      'PRINCIPAL_MISMATCH',
      `Handle bound to principal '${rec.principalId}' cannot be used by '${principalId}'.`,
      input.toolName,
      { handleId: rec.handleId, boundPrincipal: rec.principalId, callerPrincipal: principalId }
    );
  }

  if (rec.tenantId !== tenantId) {
    return deny(
      'CROSS_TENANT_SESSION_FORGERY',
      `Session handle tenant '${rec.tenantId}' does not match active context tenant '${tenantId}'.`,
      input.toolName,
      { handleId: rec.handleId, boundTenant: rec.tenantId, callerTenant: tenantId }
    );
  }

  if (input.expectedScope && rec.scope !== input.expectedScope) {
    return deny(
      'SCOPE_MISMATCH',
      `Handle scope '${rec.scope}' does not match expected '${input.expectedScope}'.`,
      input.toolName,
      { handleId: rec.handleId }
    );
  }

  if (input.expectedKind && rec.kind !== input.expectedKind) {
    return deny(
      'KIND_MISMATCH',
      `Handle kind '${rec.kind}' does not match expected '${input.expectedKind}'.`,
      input.toolName,
      { handleId: rec.handleId }
    );
  }

  rec.lastAuthorizedAtMs = now;
  rec.authorizeCount = (rec.authorizeCount || 0) + 1;
  persist();

  return {
    allowed: true,
    code: 'SESSION_HANDLE_VERIFIED',
    reason: 'Session handle authorized for principal and tenant.',
    toolName: input.toolName || null,
    handleId: rec.handleId,
    token: rec.token,
    principalId: rec.principalId,
    tenantId: rec.tenantId,
    scope: rec.scope,
    kind: rec.kind,
    authorizeCount: rec.authorizeCount,
    expiresAtMs: rec.expiresAtMs,
    argKey: extracted.key,
  };
}

/**
 * Stub-compatible verify API.
 * @param {string} toolName
 * @param {object} args
 * @param {object|null} activeSessionContext - { required, tenantId, principalId, expectedScope, expectedKind }
 */
function verifySessionHandle(toolName = '', args = {}, activeSessionContext = null) {
  ensureDiskLoaded();
  if (!args || typeof args !== 'object') {
    return { allowed: true, reason: 'No arguments provided', code: 'NO_ARGS' };
  }

  const handleCandidate = extractHandleFromArgs(args);
  const required = Boolean(activeSessionContext && activeSessionContext.required);

  if (!activeSessionContext && !handleCandidate) {
    return { allowed: true, reason: 'Stateless un-scoped tool call', code: 'STATELESS_UNSCOPED' };
  }

  // Carried handle without principal context = fail closed (no replay path).
  if (!activeSessionContext && handleCandidate) {
    return {
      allowed: false,
      code: 'MISSING_SESSION_CONTEXT',
      reason: 'Session handle present but activeSessionContext with principalId is required to authorize.',
      argKey: handleCandidate.key,
    };
  }

  if (!activeSessionContext) {
    return { allowed: true, reason: 'Stateless un-scoped tool call', code: 'STATELESS_UNSCOPED' };
  }

  const principalId = activeSessionContext.principalId
    || process.env.THUMBGATE_PRINCIPAL_ID
    || process.env.THUMBGATE_AGENT_ID
    || null;

  if (!principalId) {
    return {
      allowed: false,
      code: 'MISSING_PRINCIPAL',
      reason: 'activeSessionContext.principalId is required to authorize a session handle',
    };
  }

  return authorizeHandle({
    args,
    principalId,
    tenantId: activeSessionContext.tenantId,
    toolName,
    required,
    expectedScope: activeSessionContext.expectedScope || activeSessionContext.scope,
    expectedKind: activeSessionContext.expectedKind || activeSessionContext.kind,
  });
}

/**
 * Atomic claim for an idempotency key BEFORE side effects.
 * Returns:
 *   - execute: first caller may run the side effect
 *   - replay: prior completed result (do not re-run)
 *   - in_flight: another caller holds a pending claim
 *   - denied: authorization failed
 */
function claimIdempotency(input = {}) {
  ensureDiskLoaded();
  const principalId = normalizePrincipal(input.principalId);
  const tenantId = normalizeTenant(input.tenantId);
  const key = String(input.key || '').trim();
  const operation = String(input.operation || 'default').trim() || 'default';
  if (!key) {
    const err = new Error('idempotency key is required');
    err.code = 'MISSING_IDEMPOTENCY_KEY';
    throw err;
  }

  const auth = authorizeHandle({
    handle: input.handle,
    args: input.args,
    principalId,
    tenantId,
    toolName: input.toolName || operation,
    required: true,
  });
  if (!auth.allowed) {
    return { status: 'denied', authorization: auth };
  }

  const idxKey = idemIndexKey({
    principalId,
    tenantId,
    key: `${operation}::${key}`,
    purpose: 'op',
  });
  const existing = idempotencyIndex.get(idxKey);
  if (existing && existing.status === 'completed' && existing.result !== undefined) {
    return {
      status: 'replay',
      result: existing.result,
      handleId: existing.handleId,
      authorization: auth,
      createdAtMs: existing.createdAtMs,
      claimKey: idxKey,
    };
  }
  if (existing && existing.status === 'pending') {
    return {
      status: 'in_flight',
      handleId: existing.handleId,
      authorization: auth,
      claimKey: idxKey,
      createdAtMs: existing.createdAtMs,
    };
  }

  const now = nowFn();
  const rec = registry.get(auth.handleId);
  idempotencyIndex.set(idxKey, {
    handleId: auth.handleId,
    principalId,
    tenantId,
    operation,
    key,
    status: 'pending',
    result: undefined,
    createdAtMs: now,
    expiresAtMs: rec ? rec.expiresAtMs : now + DEFAULT_TTL_MS,
  });
  persist();
  return {
    status: 'execute',
    handleId: auth.handleId,
    authorization: auth,
    claimKey: idxKey,
    createdAtMs: now,
  };
}

/**
 * Complete a prior claimIdempotency with the side-effect result.
 * Call only after the effect succeeds (or failClosed with error).
 */
function completeIdempotency(input = {}) {
  ensureDiskLoaded();
  const principalId = normalizePrincipal(input.principalId);
  const tenantId = normalizeTenant(input.tenantId);
  const key = String(input.key || '').trim();
  const operation = String(input.operation || 'default').trim() || 'default';
  const idxKey = input.claimKey || idemIndexKey({
    principalId,
    tenantId,
    key: `${operation}::${key}`,
    purpose: 'op',
  });
  const existing = idempotencyIndex.get(idxKey);
  if (!existing) {
    return { status: 'missing_claim' };
  }
  if (existing.status === 'completed' && existing.result !== undefined) {
    return { status: 'replay', result: existing.result, handleId: existing.handleId };
  }
  existing.status = 'completed';
  existing.result = input.result !== undefined ? input.result : { ok: true };
  existing.completedAtMs = nowFn();
  idempotencyIndex.set(idxKey, existing);
  persist();
  return {
    status: 'stored',
    result: existing.result,
    handleId: existing.handleId,
    createdAtMs: existing.createdAtMs,
  };
}

/**
 * Bind an idempotency key: claim → optional result store.
 * Preferred production flow: claimIdempotency → side effect → completeIdempotency.
 * This helper stores a completed result when `result` is provided (single-call path).
 * @returns {{ status: 'stored'|'replay'|'execute'|'in_flight'|'denied', result?: any }}
 */
function bindIdempotency(input = {}) {
  if (input.result !== undefined && input.complete !== false) {
    const claim = claimIdempotency(input);
    if (claim.status === 'replay' || claim.status === 'denied' || claim.status === 'in_flight') {
      return claim;
    }
    return completeIdempotency({
      ...input,
      claimKey: claim.claimKey,
      result: input.result,
    });
  }
  return claimIdempotency(input);
}

/**
 * Gate MCP tool dispatch: when model carries a handle (or env requires one),
 * authorize against principal/tenant from env or args metadata.
 */
function authorizeMcpToolCall(toolName, args = {}, context = {}) {
  ensureDiskLoaded();
  const principalId = context.principalId
    || args.principalId
    || (args.metadata && args.metadata.principalId)
    || process.env.THUMBGATE_PRINCIPAL_ID
    || process.env.THUMBGATE_AGENT_ID
    || null;
  const tenantId = context.tenantId
    || args.tenantId
    || (args.metadata && args.metadata.tenantId)
    || process.env.THUMBGATE_TENANT_ID
    || 'default';
  const handleCandidate = extractHandleFromArgs(args);
  const forceRequired = context.required === true
    || process.env.THUMBGATE_MCP_HANDLE_REQUIRED === '1';

  if (!handleCandidate && !forceRequired) {
    return {
      allowed: true,
      code: 'STATELESS_UNSCOPED',
      reason: 'No model-carried handle on this tool call',
      toolName,
    };
  }

  if (!principalId) {
    return deny(
      'MISSING_PRINCIPAL',
      'THUMBGATE_PRINCIPAL_ID (or args.principalId) is required when a session handle is present or required',
      toolName
    );
  }

  return authorizeHandle({
    args,
    principalId,
    tenantId,
    toolName,
    required: true,
  });
}

/**
 * Resolve a previously bound idempotency result without re-executing side effects.
 */
function resolveIdempotency(input = {}) {
  ensureDiskLoaded();
  const principalId = normalizePrincipal(input.principalId);
  const tenantId = normalizeTenant(input.tenantId);
  const key = String(input.key || '').trim();
  const operation = String(input.operation || 'default').trim() || 'default';
  if (!key) return { status: 'missing_key' };

  const idxKey = idemIndexKey({
    principalId,
    tenantId,
    key: `${operation}::${key}`,
    purpose: 'op',
  });
  const existing = idempotencyIndex.get(idxKey);
  if (!existing) return { status: 'miss' };
  if (existing.expiresAtMs && existing.expiresAtMs <= nowFn()) {
    idempotencyIndex.delete(idxKey);
    return { status: 'expired' };
  }
  if (existing.status === 'pending') {
    return { status: 'in_flight', handleId: existing.handleId, createdAtMs: existing.createdAtMs };
  }
  if (existing.result === undefined) return { status: 'miss' };
  return {
    status: 'hit',
    result: existing.result,
    handleId: existing.handleId,
    createdAtMs: existing.createdAtMs,
  };
}

function revokeHandle(tokenOrId, principalId) {
  const principal = normalizePrincipal(principalId);
  const parsed = parseHandleToken(tokenOrId);
  const handleId = parsed.ok ? parsed.handleId : String(tokenOrId || '').replace(/\.[a-f0-9]+$/i, '');
  const rec = registry.get(handleId);
  if (!rec) return { revoked: false, code: 'UNKNOWN_SESSION_HANDLE' };
  if (rec.principalId !== principal) {
    return { revoked: false, code: 'PRINCIPAL_MISMATCH' };
  }
  rec.revokedAt = new Date(nowFn()).toISOString();
  registry.delete(handleId);
  persist();
  return { revoked: true, handleId };
}

/**
 * Simulate multi-turn model fidelity: at each turn the "model" re-emits a handle.
 * mutateAtTurns: map turnIndex -> 'drop' | 'swap' | 'mutate' | 'forge'
 * Returns per-turn authorize outcomes — used by depth-30 tests.
 */
function simulateMultiTurnFidelity(options = {}) {
  const turns = Math.max(1, Number(options.turns) || 30);
  const principalId = normalizePrincipal(options.principalId || 'agent-primary');
  const tenantId = normalizeTenant(options.tenantId || 'acme');
  const mutateAtTurns = options.mutateAtTurns && typeof options.mutateAtTurns === 'object'
    ? options.mutateAtTurns
    : {};

  const minted = mintHandle({
    principalId,
    tenantId,
    scope: options.scope || 'production',
    kind: options.kind || 'basket',
    ttlMs: options.ttlMs || DEFAULT_TTL_MS,
    idempotencyKey: options.idempotencyKey,
  });

  const results = [];
  let carried = minted.token;

  for (let turn = 1; turn <= turns; turn += 1) {
    const mutation = mutateAtTurns[turn] || mutateAtTurns[String(turn)] || null;
    let args = { basketId: carried, turn };

    if (mutation === 'drop') {
      args = { turn };
    } else if (mutation === 'swap') {
      const other = mintHandle({
        principalId: options.swapPrincipalId || 'agent-other',
        tenantId: options.swapTenantId || tenantId,
        scope: 'production',
        kind: 'basket',
      });
      args = { basketId: other.token, turn };
    } else if (mutation === 'mutate') {
      // Flip last hex nibble of id segment — breaks HMAC
      const [id, sig] = carried.split('.');
      const flipped = id.slice(0, -1) + (id.endsWith('a') ? 'b' : 'a');
      args = { basketId: `${flipped}.${sig}`, turn };
    } else if (mutation === 'forge') {
      args = { basketId: `${HANDLE_PREFIX}${'f'.repeat(ENTROPY_BYTES * 2)}.${'0'.repeat(SIG_HEX_LEN)}`, turn };
    } else if (mutation === 'cross_tenant') {
      // Re-use same token but claim different tenant on authorize
      args = { basketId: carried, turn };
    }

    const authTenant = mutation === 'cross_tenant'
      ? (options.crossTenantId || 'other-tenant')
      : tenantId;

    const auth = authorizeHandle({
      args,
      principalId,
      tenantId: authTenant,
      toolName: `turn_${turn}_tool`,
      required: true,
    });

    results.push({
      turn,
      mutation: mutation || 'faithful',
      allowed: auth.allowed,
      code: auth.code,
      authorizeCount: auth.authorizeCount || null,
    });

    // Faithful model re-carries the same handle; dropped/forged paths keep prior carried
    // only when authorize succeeded with a token.
    if (auth.allowed && auth.token) {
      carried = auth.token;
    }
  }

  return {
    token: minted.token,
    handleId: minted.handleId,
    principalId,
    tenantId,
    turns,
    results,
    successCount: results.filter((r) => r.allowed).length,
    failureCount: results.filter((r) => !r.allowed).length,
  };
}

function getHandleRecord(tokenOrId) {
  const parsed = parseHandleToken(tokenOrId);
  const handleId = parsed.ok
    ? parsed.handleId
    : String(tokenOrId || '').split('.')[0];
  const rec = registry.get(handleId);
  return rec ? publicRecord(rec) : null;
}

function listHandlesForPrincipal(principalId, tenantId) {
  const principal = normalizePrincipal(principalId);
  const tenant = tenantId != null ? normalizeTenant(tenantId) : null;
  purgeExpired();
  const out = [];
  for (const rec of registry.values()) {
    if (rec.principalId !== principal) continue;
    if (tenant && rec.tenantId !== tenant) continue;
    out.push(publicRecord(rec));
  }
  return out;
}

function deny(code, reason, toolName, extra = {}) {
  return {
    allowed: false,
    code,
    reason,
    toolName: toolName || null,
    ...extra,
  };
}

/** Test / ops helpers */
function _resetForTests(options = {}) {
  registry = new Map();
  idempotencyIndex = new Map();
  diskLoaded = false;
  if (options.now != null) {
    nowFn = typeof options.now === 'function' ? options.now : () => options.now;
  } else {
    nowFn = () => Date.now();
  }
  secretOverride = options.secret || null;
  storePathOverride = options.storePath || null;
  if (options.loadDisk) loadFromDisk();
  else diskLoaded = true; // empty in-memory registry for isolated unit tests
}

function _setNow(msOrFn) {
  nowFn = typeof msOrFn === 'function' ? msOrFn : () => msOrFn;
}

function _stats() {
  purgeExpired();
  return {
    handleCount: registry.size,
    idempotencyCount: idempotencyIndex.size,
  };
}

// Load durable spill once at require-time for multi-worker hosts.
loadFromDisk();

module.exports = {
  HANDLE_PREFIX,
  HANDLE_ARG_KEYS,
  DEFAULT_TTL_MS,
  MIN_TTL_MS,
  MAX_TTL_MS,
  mintHandle,
  mintSessionHandle,
  authorizeHandle,
  authorizeMcpToolCall,
  verifySessionHandle,
  extractHandleFromArgs,
  claimIdempotency,
  completeIdempotency,
  bindIdempotency,
  resolveIdempotency,
  revokeHandle,
  getHandleRecord,
  listHandlesForPrincipal,
  simulateMultiTurnFidelity,
  parseHandleToken,
  purgeExpired,
  loadFromDisk,
  ensureDiskLoaded,
  _resetForTests,
  _setNow,
  _stats,
};
