#!/usr/bin/env node
'use strict';

/**
 * mcp-oauth.js — OAuth 2.1 (PKCE) authorization-server machinery for the remote
 * ThumbGate MCP connector, required by the Claude Connectors Directory
 * ("Use OAuth 2.0 for authenticated services").
 *
 * Pure, dependency-free, IO-free functions + an injectable store, so the full
 * flow is unit-testable without a network. The HTTP wiring (in src/api/server.js)
 * is a thin shell over these.
 *
 * Implements:
 *   - RFC 9728 protected-resource metadata
 *   - RFC 8414 authorization-server metadata
 *   - RFC 7591 dynamic client registration (open registration)
 *   - Authorization-code grant with mandatory PKCE S256 (RFC 7636)
 *   - Bearer access tokens bound to a ThumbGate API key (so existing gating is unchanged)
 *   - Refresh-token grant with rotation (RFC 6749 §6, OAuth 2.1 §4.3.1)
 *   - Optional durable store (persistPath) so connectors survive a redeploy
 *
 * SECURITY NOTES:
 *   - PKCE S256 is mandatory; the plain method is rejected.
 *   - Auth codes are single-use and short-lived (60s); access tokens TTL-bound.
 *   - redirect_uri is matched exactly against the registered set.
 *   - The token never exposes the bound ThumbGate key; it maps server-side only.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUTH_CODE_TTL_MS = 60 * 1000; // 1 minute
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_SCOPE = 'mcp:read mcp:write';
// Scope hierarchy (WorkOS / MCP Auth alignment): broader grants imply narrower ones.
// mcp:write covers side-effecting tools AND read-only tools (write ⇒ read).
// mcp:gates is for gate-evaluation tools; mcp:write implies mcp:gates.
// mcp:feedback is for feedback-capture tools; mcp:write implies mcp:feedback.
const SUPPORTED_SCOPES = Object.freeze(['mcp:read', 'mcp:write', 'mcp:gates', 'mcp:feedback']);
const SCOPE_IMPLIES = Object.freeze({
  'mcp:write': Object.freeze(['mcp:read', 'mcp:gates', 'mcp:feedback', 'mcp:write']),
  'mcp:gates': Object.freeze(['mcp:gates', 'mcp:read']),
  'mcp:feedback': Object.freeze(['mcp:feedback', 'mcp:read']),
  'mcp:read': Object.freeze(['mcp:read']),
});

// Upper bounds on the in-memory store. The registration and authorization
// endpoints are reachable pre-auth, so without a cap a malicious caller could
// grow these Maps unboundedly and exhaust server memory. When a Map is full we
// evict the oldest entry (FIFO) rather than deny service to legitimate clients.
const MAX_CLIENTS = 10000;
const MAX_CODES = 10000;
const MAX_TOKENS = 50000;
const STORE_FILE_VERSION = 1;

function now() {
  return Date.now();
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function base64UrlSha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('base64url');
}

/** Tokens are kept (in memory and on disk) only as SHA-256 digests. */
function tokenDigest(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

/**
 * Create a store.
 *
 * With no options it is a plain in-memory store (tests, local dev). With
 * `persistPath` it is loaded from and saved to that JSON file, so registered
 * clients, access tokens and refresh tokens survive a process restart (a
 * Railway redeploy restarts the process several times a day; without this,
 * every claude.ai / Claude Desktop connector lost its sign-in on each deploy).
 *
 * On disk: tokens are stored only as SHA-256 digests, and the ThumbGate key a
 * token acts as is stored only as a digest (`boundKeyRef`). On load, a token is
 * kept only if its `boundKeyRef` matches one of `knownKeys` (the keys the
 * server is configured with right now), so rotating a key revokes every
 * connector session that was bound to the old one.
 *
 * Still single-instance: a multi-instance deployment needs a shared backing.
 */
function createStore(options = {}) {
  const store = {
    clients: new Map(),
    codes: new Map(),
    tokens: new Map(),
    refreshTokens: new Map(),
    persistPath: options.persistPath || null,
  };
  if (store.persistPath) loadStore(store, options.knownKeys || []);
  return store;
}

function loadStore(store, knownKeys = []) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(store.persistPath, 'utf8'));
  } catch {
    return store; // missing or unreadable file: start empty
  }
  if (!raw || raw.version !== STORE_FILE_VERSION) return store;
  const keyByRef = new Map();
  for (const key of knownKeys) {
    const k = String(key || '').trim();
    if (k) keyByRef.set(tokenDigest(k), k);
  }
  const t = now();
  for (const client of Array.isArray(raw.clients) ? raw.clients : []) {
    if (client && client.client_id) capInsert(store.clients, client.client_id, client, MAX_CLIENTS);
  }
  const restore = (rows, map, max) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || !row.digest || !(row.expiresAt > t)) continue;
      const boundKey = keyByRef.get(row.boundKeyRef);
      if (!boundKey) continue; // key rotated or removed: drop the session
      const { digest, boundKeyRef, ...rest } = row;
      capInsert(map, digest, { ...rest, boundKey }, max);
    }
  };
  restore(raw.tokens, store.tokens, MAX_TOKENS);
  restore(raw.refreshTokens, store.refreshTokens, MAX_TOKENS);
  return store;
}

/** Write the durable parts of the store (no-op for in-memory stores). */
function saveStore(store) {
  if (!store || !store.persistPath) return false;
  const t = now();
  const dump = (map) => [...map.entries()]
    .filter(([, v]) => v && v.expiresAt > t)
    .map(([digest, v]) => {
      const { boundKey, ...rest } = v;
      return { ...rest, digest, boundKeyRef: tokenDigest(boundKey || '') };
    });
  const payload = {
    version: STORE_FILE_VERSION,
    savedAt: new Date(t).toISOString(),
    clients: [...store.clients.values()],
    tokens: dump(store.tokens),
    refreshTokens: dump(store.refreshTokens),
  };
  try {
    fs.mkdirSync(path.dirname(store.persistPath), { recursive: true });
    const tmp = `${store.persistPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
    fs.renameSync(tmp, store.persistPath);
    return true;
  } catch {
    return false; // never fail an auth request because the disk write failed
  }
}

/** Insert into a Map, evicting the oldest entry (FIFO) once `max` is reached. */
function capInsert(map, key, value, max) {
  if (map.size >= max && !map.has(key)) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

// ---------------------------------------------------------------------------
// Metadata (RFC 9728 / RFC 8414)
// ---------------------------------------------------------------------------

function trimSlash(u) {
  // Non-regex trailing-slash strip (avoids a SonarCloud S5852 false-positive on a
  // provably-linear pattern).
  let s = String(u || '');
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

function buildProtectedResourceMetadata(baseUrl) {
  const base = trimSlash(baseUrl);
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    scopes_supported: [...SUPPORTED_SCOPES],
    resource_documentation: `${base}/docs/connectors`,
  };
}

function buildAuthServerMetadata(baseUrl) {
  const base = trimSlash(baseUrl);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    scopes_supported: [...SUPPORTED_SCOPES],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };
}

// ---------------------------------------------------------------------------
// Dynamic client registration (RFC 7591)
// ---------------------------------------------------------------------------

// The MCP authorization spec is explicit: "All redirect URIs MUST be either
// `localhost` or use HTTPS." We therefore accept only HTTPS and loopback
// (http://localhost | http://127.0.0.1) and reject every other scheme —
// including native-app custom schemes (myapp://, intent://, etc.), which the MCP
// profile does not sanction and the real client (Claude) does not use.
function isAllowedRedirectUri(uri) {
  const u = String(uri || '');
  if (/^https:\/\//i.test(u)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(u)) return true;
  return false;
}

function registerClient(store, body = {}) {
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter(Boolean) : [];
  if (redirectUris.length === 0) {
    return { error: 'invalid_redirect_uri', error_description: 'redirect_uris is required' };
  }
  for (const uri of redirectUris) {
    if (!isAllowedRedirectUri(uri)) {
      return { error: 'invalid_redirect_uri', error_description: `unsupported redirect_uri: ${uri}` };
    }
  }
  const clientId = `tg_${randomToken(16)}`;
  const record = {
    client_id: clientId,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_name: typeof body.client_name === 'string' ? body.client_name.slice(0, 200) : 'mcp-client',
    created_at: now(),
  };
  capInsert(store.clients, clientId, record, MAX_CLIENTS);
  saveStore(store);
  return record;
}

function getClient(store, clientId) {
  return store.clients.get(clientId) || null;
}

function normalizeScopes(scope = DEFAULT_SCOPE, allowedScopes = SUPPORTED_SCOPES) {
  const requested = [...new Set(String(scope || DEFAULT_SCOPE).split(/\s+/).filter(Boolean))];
  const supported = new Set(SUPPORTED_SCOPES);
  const allowed = new Set(allowedScopes || SUPPORTED_SCOPES);
  const invalid = requested.filter((candidate) => !supported.has(candidate));
  const disallowed = requested.filter((candidate) => supported.has(candidate) && !allowed.has(candidate));
  return {
    valid: requested.length > 0 && invalid.length === 0 && disallowed.length === 0,
    scopes: requested,
    scope: requested.join(' '),
    invalid,
    disallowed,
  };
}

/**
 * True when the session's granted scopes cover `requiredScope`, including
 * hierarchy (e.g. a token with only `mcp:write` may call read-only tools).
 * Mirrors enterprise MCP Auth patterns (WorkOS AuthKit maps OAuth scopes to
 * tool roles with least privilege + natural implication).
 */
function scopeAllows(session, requiredScope) {
  if (!session || !requiredScope) return false;
  const normalized = normalizeScopes(session.scope, SUPPORTED_SCOPES);
  if (!normalized.valid) return false;
  const required = String(requiredScope);
  for (const granted of normalized.scopes) {
    const implies = SCOPE_IMPLIES[granted] || [granted];
    if (implies.includes(required)) return true;
  }
  return false;
}

/**
 * Map an MCP tool annotation to the minimum OAuth scope required.
 * - readOnlyHint → mcp:read
 * - openWorld/side-effect tools → mcp:write
 * - gate-eval tools can opt into mcp:gates via annotations.thumbgateScope
 * - feedback tools can opt into mcp:feedback via annotations.thumbgateScope
 */
function requiredScopeForTool(tool = {}) {
  const explicit = tool?.annotations?.thumbgateScope;
  if (explicit && SUPPORTED_SCOPES.includes(explicit)) return explicit;
  if (tool?.annotations?.readOnlyHint === true) return 'mcp:read';
  return 'mcp:write';
}

// ---------------------------------------------------------------------------
// Authorization code (PKCE S256)
// ---------------------------------------------------------------------------

/**
 * Issue an auth code. `boundKey` is the ThumbGate API key the resulting access
 * token will act as (resolved by the authorize step once the user consents).
 */
function createAuthorizationCode(store, {
  clientId, redirectUri, codeChallenge, codeChallengeMethod, scope, allowedScopes, boundKey, state, resource,
} = {}) {
  const client = getClient(store, clientId);
  if (!client) return { error: 'invalid_client' };
  if (!client.redirect_uris.includes(redirectUri)) return { error: 'invalid_request', error_description: 'redirect_uri mismatch' };
  if (codeChallengeMethod !== 'S256') return { error: 'invalid_request', error_description: 'code_challenge_method must be S256' };
  if (!codeChallenge || String(codeChallenge).length < 16) return { error: 'invalid_request', error_description: 'code_challenge required' };
  const normalizedScopes = normalizeScopes(scope, allowedScopes || SUPPORTED_SCOPES);
  if (!normalizedScopes.valid) {
    return {
      error: 'invalid_scope',
      error_description: [
        normalizedScopes.invalid.length > 0 ? `unsupported: ${normalizedScopes.invalid.join(', ')}` : '',
        normalizedScopes.disallowed.length > 0 ? `not permitted: ${normalizedScopes.disallowed.join(', ')}` : '',
      ].filter(Boolean).join('; ') || 'scope is required',
    };
  }

  const code = randomToken(24);
  capInsert(store.codes, code, {
    clientId,
    redirectUri,
    codeChallenge,
    scope: normalizedScopes.scope,
    boundKey: boundKey || '',
    resource: resource || '', // RFC 8707 resource indicator (the MCP server URL)
    expiresAt: now() + AUTH_CODE_TTL_MS,
    used: false,
  }, MAX_CODES);
  return { code, state };
}

function verifyPkce(codeChallenge, codeVerifier) {
  if (!codeChallenge || !codeVerifier) return false;
  // RFC 7636: verifier 43–128 chars.
  if (String(codeVerifier).length < 43 || String(codeVerifier).length > 128) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(base64UrlSha256(codeVerifier)),
      Buffer.from(String(codeChallenge)),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Token exchange + validation
// ---------------------------------------------------------------------------

function exchangeCode(store, { code, codeVerifier, clientId, redirectUri, resource } = {}) {
  const entry = store.codes.get(code);
  if (!entry) return { error: 'invalid_grant', error_description: 'unknown code' };
  // Single-use + expiry: consume regardless of outcome.
  store.codes.delete(code);
  if (entry.used) return { error: 'invalid_grant', error_description: 'code already used' };
  if (now() > entry.expiresAt) return { error: 'invalid_grant', error_description: 'code expired' };
  if (entry.clientId !== clientId) return { error: 'invalid_grant', error_description: 'client mismatch' };
  if (entry.redirectUri !== redirectUri) return { error: 'invalid_grant', error_description: 'redirect_uri mismatch' };
  if (!verifyPkce(entry.codeChallenge, codeVerifier)) return { error: 'invalid_grant', error_description: 'PKCE verification failed' };
  // RFC 8707: the resource at token time must match the one bound at authorize time.
  if (entry.resource && resource && entry.resource !== resource) {
    return { error: 'invalid_target', error_description: 'resource indicator mismatch' };
  }

  return issueTokenPair(store, {
    boundKey: entry.boundKey,
    scope: entry.scope,
    clientId,
    aud: entry.resource || resource || '',
  });
}

function issueTokenPair(store, { boundKey, scope, clientId, aud }) {
  const accessToken = `tgat_${randomToken(32)}`;
  const refreshToken = `tgrt_${randomToken(32)}`;
  capInsert(store.tokens, tokenDigest(accessToken), {
    boundKey,
    scope,
    clientId,
    aud,
    expiresAt: now() + ACCESS_TOKEN_TTL_MS,
  }, MAX_TOKENS);
  capInsert(store.refreshTokens, tokenDigest(refreshToken), {
    boundKey,
    scope,
    clientId,
    aud,
    expiresAt: now() + REFRESH_TOKEN_TTL_MS,
  }, MAX_TOKENS);
  saveStore(store);
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope,
  };
}

/**
 * Refresh-token grant. Refresh tokens are single-use and rotate (OAuth 2.1
 * §4.3.1 for public clients): the presented one is consumed and a new pair is
 * issued. The scope may be narrowed, never widened.
 */
function refreshAccessToken(store, { refreshToken, clientId, scope, resource } = {}) {
  const digest = tokenDigest(refreshToken);
  const entry = refreshToken ? store.refreshTokens.get(digest) : null;
  if (!entry) return { error: 'invalid_grant', error_description: 'unknown refresh token' };
  store.refreshTokens.delete(digest);
  if (now() > entry.expiresAt) {
    saveStore(store);
    return { error: 'invalid_grant', error_description: 'refresh token expired' };
  }
  if (entry.clientId !== clientId) {
    saveStore(store);
    return { error: 'invalid_grant', error_description: 'client mismatch' };
  }
  if (entry.aud && resource && entry.aud !== resource) {
    saveStore(store);
    return { error: 'invalid_target', error_description: 'resource indicator mismatch' };
  }
  let grantedScope = entry.scope;
  if (scope) {
    const granted = new Set(String(entry.scope).split(/\s+/).filter(Boolean));
    const requested = String(scope).split(/\s+/).filter(Boolean);
    if (requested.length === 0 || requested.some((s) => !granted.has(s))) {
      saveStore(store);
      return { error: 'invalid_scope', error_description: 'refresh may not widen scope' };
    }
    grantedScope = requested.join(' ');
  }
  return issueTokenPair(store, {
    boundKey: entry.boundKey,
    scope: grantedScope,
    clientId: entry.clientId,
    aud: entry.aud,
  });
}

/** Resolve an access token to its session, or null if invalid/expired. */
function resolveAccessToken(store, token) {
  if (!token) return null;
  const digest = tokenDigest(token);
  const entry = store.tokens.get(digest) || store.tokens.get(token);
  if (!entry) return null;
  if (now() > entry.expiresAt) {
    store.tokens.delete(digest);
    store.tokens.delete(token);
    return null;
  }
  return { boundKey: entry.boundKey, scope: entry.scope, clientId: entry.clientId, aud: entry.aud };
}

/**
 * RFC 8707 audience validation: a token is valid for `expectedResource` only if it
 * was issued for it (or carries no audience, for back-compat). MCP servers MUST
 * reject tokens minted for a different resource.
 */
function tokenAudienceValid(session, expectedResource) {
  if (!session) return false;
  if (!session.aud) return true; // no audience recorded — accept (back-compat)
  return session.aud === expectedResource;
}

/** Best-effort GC of expired codes/tokens (call opportunistically). */
function pruneExpired(store) {
  const t = now();
  for (const [k, v] of store.codes) if (t > v.expiresAt) store.codes.delete(k);
  for (const [k, v] of store.tokens) if (t > v.expiresAt) store.tokens.delete(k);
  if (store.refreshTokens) {
    for (const [k, v] of store.refreshTokens) if (t > v.expiresAt) store.refreshTokens.delete(k);
  }
}

module.exports = {
  createStore,
  loadStore,
  saveStore,
  tokenDigest,
  refreshAccessToken,
  REFRESH_TOKEN_TTL_MS,
  buildProtectedResourceMetadata,
  buildAuthServerMetadata,
  registerClient,
  getClient,
  createAuthorizationCode,
  verifyPkce,
  exchangeCode,
  resolveAccessToken,
  tokenAudienceValid,
  pruneExpired,
  isAllowedRedirectUri,
  base64UrlSha256,
  AUTH_CODE_TTL_MS,
  ACCESS_TOKEN_TTL_MS,
  DEFAULT_SCOPE,
  SUPPORTED_SCOPES,
  SCOPE_IMPLIES,
  normalizeScopes,
  scopeAllows,
  requiredScopeForTool,
  MAX_CLIENTS,
  MAX_CODES,
  MAX_TOKENS,
};
