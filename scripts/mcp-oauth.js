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
 *
 * SECURITY NOTES:
 *   - PKCE S256 is mandatory; the plain method is rejected.
 *   - Auth codes are single-use and short-lived (60s); access tokens TTL-bound.
 *   - redirect_uri is matched exactly against the registered set.
 *   - The token never exposes the bound ThumbGate key; it maps server-side only.
 */

const crypto = require('crypto');

const AUTH_CODE_TTL_MS = 60 * 1000; // 1 minute
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_SCOPE = 'mcp:read mcp:write';

function now() {
  return Date.now();
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function base64UrlSha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('base64url');
}

/** Create a fresh in-memory store. Callers may persist if they wish. */
function createStore() {
  return {
    clients: new Map(),
    codes: new Map(),
    tokens: new Map(),
  };
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
    scopes_supported: ['mcp:read', 'mcp:write'],
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
    scopes_supported: ['mcp:read', 'mcp:write'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };
}

// ---------------------------------------------------------------------------
// Dynamic client registration (RFC 7591)
// ---------------------------------------------------------------------------

function registerClient(store, body = {}) {
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter(Boolean) : [];
  if (redirectUris.length === 0) {
    return { error: 'invalid_redirect_uri', error_description: 'redirect_uris is required' };
  }
  for (const uri of redirectUris) {
    const isHttps = /^https:\/\//.test(uri);
    const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(uri);
    // Custom native-app scheme (e.g. myapp://) — allowed, but never insecure web
    // or dangerous schemes.
    const isCustomScheme = /^[a-z][a-z0-9.+-]*:\/\//i.test(uri)
      && !/^(https?|ftp|file|data|javascript|vbscript):/i.test(uri);
    if (!isHttps && !isLocalhost && !isCustomScheme) {
      return { error: 'invalid_redirect_uri', error_description: `unsupported redirect_uri: ${uri}` };
    }
  }
  const clientId = `tg_${randomToken(16)}`;
  const record = {
    client_id: clientId,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    client_name: typeof body.client_name === 'string' ? body.client_name.slice(0, 200) : 'mcp-client',
    created_at: now(),
  };
  store.clients.set(clientId, record);
  return record;
}

function getClient(store, clientId) {
  return store.clients.get(clientId) || null;
}

// ---------------------------------------------------------------------------
// Authorization code (PKCE S256)
// ---------------------------------------------------------------------------

/**
 * Issue an auth code. `boundKey` is the ThumbGate API key the resulting access
 * token will act as (resolved by the authorize step once the user consents).
 */
function createAuthorizationCode(store, {
  clientId, redirectUri, codeChallenge, codeChallengeMethod, scope, boundKey, state, resource,
} = {}) {
  const client = getClient(store, clientId);
  if (!client) return { error: 'invalid_client' };
  if (!client.redirect_uris.includes(redirectUri)) return { error: 'invalid_request', error_description: 'redirect_uri mismatch' };
  if (codeChallengeMethod !== 'S256') return { error: 'invalid_request', error_description: 'code_challenge_method must be S256' };
  if (!codeChallenge || String(codeChallenge).length < 16) return { error: 'invalid_request', error_description: 'code_challenge required' };

  const code = randomToken(24);
  store.codes.set(code, {
    clientId,
    redirectUri,
    codeChallenge,
    scope: scope || DEFAULT_SCOPE,
    boundKey: boundKey || '',
    resource: resource || '', // RFC 8707 resource indicator (the MCP server URL)
    expiresAt: now() + AUTH_CODE_TTL_MS,
    used: false,
  });
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

  const accessToken = `tgat_${randomToken(32)}`;
  store.tokens.set(accessToken, {
    boundKey: entry.boundKey,
    scope: entry.scope,
    clientId,
    aud: entry.resource || resource || '',
    expiresAt: now() + ACCESS_TOKEN_TTL_MS,
  });
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scope: entry.scope,
  };
}

/** Resolve an access token to its session, or null if invalid/expired. */
function resolveAccessToken(store, token) {
  if (!token) return null;
  const entry = store.tokens.get(token);
  if (!entry) return null;
  if (now() > entry.expiresAt) {
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
}

module.exports = {
  createStore,
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
  base64UrlSha256,
  AUTH_CODE_TTL_MS,
  ACCESS_TOKEN_TTL_MS,
  DEFAULT_SCOPE,
};
