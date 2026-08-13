'use strict';

/**
 * MCP Session Handle Verifier
 *
 * Context: the Aug-2026 stateless MCP shift moved session correlation out of the
 * protocol and into model-carried arguments. The model now hands back a handle
 * ("which basket / which account / which repo") on every turn.
 *
 * The dangerous failure is NOT a malformed handle. It is a well-formed, correctly
 * signed, correctly-tenanted handle pointing at the WRONG resource, because the
 * model lost the thread across turns. The server then sees a legitimate authorized
 * call and nothing is logged as an error. That is the class that charges the wrong
 * account.
 *
 * Four checks, ordered by how often they actually bite:
 *   1. SIGNATURE - recomputed, compared in constant time. A signature that is never
 *                  re-derived is decoration, not a control.
 *   2. EXPIRY    - a minted TTL that is never read is fiction.
 *   3. TENANT    - read from the VERIFIED payload, never parsed out of the untrusted
 *                  string before the signature check.
 *   4. RESOURCE  - handle is bound to the resource it was minted for. This is the
 *                  check that catches lost-the-thread.
 */

const crypto = require('crypto');

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const HANDLE_PREFIX = 'mcp_sess';
const SECRET_ENV_KEY = ['THUMBGATE', 'SESSION', 'SECRET'].join('_');

/** Argument names a model might carry a handle under. */
const HANDLE_ARG_KEYS = [
  'sessionId', 'session_id', 'sessionHandle', 'session_handle',
  'taskScopeId', 'basketId', 'browserId', 'handle'
];

/** Argument names that identify the resource an operation targets. */
const RESOURCE_ARG_KEYS = [
  'resourceId', 'resource_id', 'accountId', 'account_id',
  'basketId', 'cartId', 'targetId', 'repositoryId'
];

class SessionSecretMissingError extends Error {
  constructor() {
    super(
      `${SECRET_ENV_KEY} is not configured. Refusing to mint or verify session handles ` +
      'with a built-in fallback value, which would be publicly known and therefore forgeable.'
    );
    this.code = 'SESSION_SECRET_MISSING';
  }
}

function resolveSigningMaterial(env) {
  const value = env[SECRET_ENV_KEY];
  if (!value || !String(value).trim()) throw new SessionSecretMissingError();
  return String(value);
}

function canonicalPayload({ handleId, tenantId, scope, resourceId, expiresAt }) {
  // Length-prefixed: no field can impersonate a delimiter boundary. Plain separator
  // concatenation lets {a:"x|y",b:"z"} and {a:"x",b:"y|z"} produce the same digest.
  return [handleId, tenantId, scope, resourceId == null ? '' : resourceId, String(expiresAt)]
    .map((part) => `${Buffer.byteLength(String(part), 'utf8')}:${part}`)
    .join('|');
}

function sign(payload, env) {
  return crypto.createHmac('sha256', resolveSigningMaterial(env)).update(payload).digest('hex');
}

function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Mint a session handle bound to tenant, scope, resource and expiry.
 */
function mintSessionHandle(options = {}, env = process.env) {
  const opts = typeof options === 'string' ? { tenantId: options } : options;
  const {
    tenantId = 'default',
    scope = 'global',
    resourceId = null,
    ttlMs = DEFAULT_TTL_MS,
    now = Date.now()
  } = opts;

  if (String(tenantId).includes('|') || String(scope).includes('|')) {
    throw new Error('tenantId and scope must not contain "|"');
  }

  const createdAt = now;
  const expiresAt = now + ttlMs;
  const base = `${HANDLE_PREFIX}_${tenantId}_${crypto.randomBytes(16).toString('hex')}`;
  const signature = sign(
    canonicalPayload({ handleId: base, tenantId, scope, resourceId, expiresAt }),
    env
  );

  // Every claim the verifier needs travels inside the signed handle; nothing is
  // re-derived from an unverified substring.
  const encoded = Buffer.from(
    JSON.stringify({ h: base, t: tenantId, s: scope, r: resourceId, x: expiresAt }),
    'utf8'
  ).toString('base64url');

  return { handleId: `${encoded}.${signature}`, tenantId, scope, resourceId, createdAt, expiresAt };
}

function firstPresent(args, keys) {
  for (const key of keys) {
    if (args[key] != null && args[key] !== '') return String(args[key]);
  }
  return null;
}

function deny(code, reason, extra = {}) {
  return { allowed: false, code, reason, ...extra };
}

/**
 * Verify a model-carried session handle before the tool call executes.
 *
 * @param {string} toolName
 * @param {object} args     tool arguments exactly as the model produced them
 * @param {object|null} context  { required, tenantId, now }
 */
function verifySessionHandle(toolName = '', args = {}, context = null, env = process.env) {
  if (!args || typeof args !== 'object') {
    return { allowed: true, code: 'NO_ARGS', reason: 'No arguments provided.' };
  }

  const handle = firstPresent(args, HANDLE_ARG_KEYS);
  const ctx = context || {};
  const now = ctx.now == null ? Date.now() : ctx.now;

  if (!handle) {
    if (ctx.required) {
      return deny(
        'MISSING_SESSION_HANDLE',
        `Tool '${toolName}' requires a session handle but the model supplied none.`
      );
    }
    return { allowed: true, code: 'STATELESS_CALL', reason: 'Un-scoped stateless tool call.' };
  }

  const parts = handle.split('.');
  if (parts.length !== 2) {
    return deny('INVALID_SESSION_HANDLE_FORMAT', 'Handle is not in <payload>.<signature> form.');
  }

  const [encoded, signature] = parts;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return deny('MALFORMED_SESSION_HANDLE', 'Handle payload is not decodable.');
  }
  if (!claims || typeof claims !== 'object' || !claims.h || !claims.t) {
    return deny('MALFORMED_SESSION_HANDLE', 'Handle payload is missing required claims.');
  }

  // 1. Signature first. Nothing below is trustworthy until this passes.
  const expected = sign(
    canonicalPayload({
      handleId: claims.h, tenantId: claims.t, scope: claims.s,
      resourceId: claims.r, expiresAt: claims.x
    }),
    env
  );
  if (!timingSafeEqualHex(signature, expected)) {
    return deny(
      'SESSION_HANDLE_SIGNATURE_INVALID',
      'Handle signature does not verify. Handle was forged or tampered with.'
    );
  }

  // 2. Expiry.
  if (typeof claims.x !== 'number' || now > claims.x) {
    return deny('SESSION_HANDLE_EXPIRED', `Handle expired at ${new Date(claims.x || 0).toISOString()}.`);
  }

  // 3. Tenant, taken from the verified payload.
  if (ctx.tenantId && ctx.tenantId !== claims.t) {
    return deny(
      'CROSS_TENANT_SESSION_FORGERY',
      `Handle tenant '${claims.t}' does not match caller tenant '${ctx.tenantId}'.`
    );
  }

  // 4. Resource binding — the lost-the-thread case. A genuine, unexpired,
  // same-tenant handle aimed at a resource it was not minted for.
  const requested = firstPresent(args, RESOURCE_ARG_KEYS);
  if (claims.r != null && requested != null && String(claims.r) !== requested) {
    return deny(
      'SESSION_HANDLE_RESOURCE_MISMATCH',
      `Handle is bound to resource '${claims.r}' but tool '${toolName}' targets '${requested}'. ` +
      'The model likely carried a stale handle across turns.',
      { boundResource: String(claims.r), requestedResource: requested }
    );
  }

  return { allowed: true, code: 'SESSION_HANDLE_VERIFIED', reason: 'Handle verified.' };
}

module.exports = {
  mintSessionHandle,
  verifySessionHandle,
  SessionSecretMissingError,
  HANDLE_ARG_KEYS,
  RESOURCE_ARG_KEYS,
  SECRET_ENV_KEY
};
