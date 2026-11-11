'use strict';

const crypto = require('node:crypto');

const SSO_STATE_TTL_MS = 10 * 60 * 1000;
const ssoOauthStates = new Map();

function pruneSsoStates(nowMs = Date.now()) {
  for (const [key, entry] of ssoOauthStates) {
    if (!entry || entry.expiresAt <= nowMs) ssoOauthStates.delete(key);
  }
}

function rememberSsoState(state, record, nowMs = Date.now()) {
  pruneSsoStates(nowMs);
  ssoOauthStates.set(state, {
    provider: record.provider,
    redirectUri: record.redirectUri,
    expiresAt: nowMs + SSO_STATE_TTL_MS,
  });
}

function consumeSsoState(state, nowMs = Date.now()) {
  const key = String(state || '');
  const entry = ssoOauthStates.get(key);
  if (!entry) return null;
  ssoOauthStates.delete(key);
  if (entry.expiresAt <= nowMs) return null;
  return entry;
}

function buildSsoCallbackUrl(appOrigin) {
  return `${String(appOrigin || '').replace(/\/+$/, '')}/v1/cloud/sso/callback`;
}

function createSsoState(provider) {
  return `st_${provider}_${crypto.randomBytes(16).toString('hex')}`;
}

function buildGoogleAuthorizeUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function buildAppleAuthorizeUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'name email',
    response_mode: 'form_post',
    state,
  });
  return `https://appleid.apple.com/auth/authorize?${params.toString()}`;
}

function providerConfigured(env, provider) {
  const source = env || {};
  if (provider === 'google') {
    return Boolean(String(source.GOOGLE_CLIENT_ID || '').trim() && String(source.GOOGLE_CLIENT_SECRET || '').trim());
  }
  if (provider === 'apple') {
    return Boolean(
      String(source.APPLE_CLIENT_ID || '').trim()
      && String(source.APPLE_TEAM_ID || '').trim()
      && String(source.APPLE_KEY_ID || '').trim()
      && String(source.APPLE_PRIVATE_KEY || '').trim(),
    );
  }
  return false;
}

function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function verifyRs256Jwt(idToken, { jwks, audience, issuers, nowSec } = {}) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) return null;
  let header;
  let payload;
  try {
    header = decodeJwtPart(parts[0]);
    payload = decodeJwtPart(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;
  const now = nowSec == null ? Math.floor(Date.now() / 1000) : nowSec;
  if (!payload.exp || Number(payload.exp) <= now) return null;
  if (!Array.isArray(issuers) || !issuers.includes(payload.iss)) return null;
  const aud = payload.aud;
  const audOk = Array.isArray(aud) ? aud.includes(audience) : aud === audience;
  if (!audOk) return null;
  const jwk = (jwks && Array.isArray(jwks.keys) ? jwks.keys : []).find((key) => key && key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) return null;
  let key;
  try {
    key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    return null;
  }
  const valid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    key,
    Buffer.from(parts[2], 'base64url'),
  );
  return valid ? payload : null;
}

function verifiedEmailFromPayload(payload) {
  if (!payload) return '';
  const verified = payload.email_verified === true || payload.email_verified === 'true';
  const email = String(payload.email || '').trim().toLowerCase();
  if (!verified || !/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/.test(email)) return '';
  return email;
}

function buildAppleClientSecret({ teamId, clientId, keyId, privateKey, nowSec }) {
  const now = nowSec == null ? Math.floor(Date.now() / 1000) : nowSec;
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    iss: teamId,
    iat: now,
    exp: now + (60 * 60 * 24 * 150),
    aud: 'https://appleid.apple.com',
    sub: clientId,
  })).toString('base64url');
  const data = `${header}.${body}`;
  const signature = crypto.sign('SHA256', Buffer.from(data), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${data}.${signature.toString('base64url')}`;
}

async function exchangeAuthorizationCode({
  tokenUrl,
  body,
  fetchImpl = global.fetch,
}) {
  const response = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || !payload.id_token) return null;
  return payload;
}

module.exports = {
  rememberSsoState,
  consumeSsoState,
  buildSsoCallbackUrl,
  createSsoState,
  buildGoogleAuthorizeUrl,
  buildAppleAuthorizeUrl,
  providerConfigured,
  verifyRs256Jwt,
  verifiedEmailFromPayload,
  buildAppleClientSecret,
  exchangeAuthorizationCode,
};
