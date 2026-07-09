'use strict';

/**
 * entitlement.js — signed license entitlements for ThumbGate's paid tier.
 *
 * Replaces the old bypassable `tg_`/`tg_pro_` prefix check in license.js with a
 * cryptographically-verifiable, offline-checkable license token.
 *
 * Token format (compact JWS-like, Ed25519 / "EdDSA"):
 *     base64url(header) "." base64url(payload) "." base64url(signature)
 *   header  = { alg: "EdDSA", kid }          // kid selects the public key
 *   payload = { tier, features[], exp, iat, customerId, keyId }
 *   sig     = Ed25519 over `${b64url(header)}.${b64url(payload)}`
 *
 * The PRIVATE signing key lives only in the hosted billing service (or a local
 * gitignored dev path). Only PUBLIC keys ship, in config/entitlement-public-keys.json,
 * so any client can verify a license offline without contacting a server.
 *
 * Enforcement is opt-in via THUMBGATE_ENFORCE_ENTITLEMENTS so paid features can be
 * gated without breaking existing users during rollout:
 *   - advisory (default): requireEntitlement returns {entitled:false, reason} and
 *     the caller may warn but proceed.
 *   - enforced (flag set): requireEntitlement throws EntitlementError when not entitled.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TIER_FEATURES = {
  free: [],
  pro: ['recall', 'lesson-search', 'unlimited-rules', 'data-export', 'hosted-dashboard', 'hosted-sync', 'learned-models'],
  team: ['recall', 'lesson-search', 'unlimited-rules', 'data-export', 'hosted-dashboard', 'hosted-sync', 'learned-models', 'org-visibility'],
  enterprise: ['recall', 'lesson-search', 'unlimited-rules', 'data-export', 'hosted-dashboard', 'hosted-sync', 'learned-models', 'org-visibility', 'sso', 'audit-log', 'compliance-export'],
};

class EntitlementError extends Error {
  constructor(message, code = 'entitlement_denied') {
    super(message);
    this.name = 'EntitlementError';
    this.code = code;
  }
}

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64url');
}
function b64urlDecodeJson(str) {
  return JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
}

function isTrueEnv(value) {
  if (!value) return false;
  const v = String(value).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function isEnforced(env = process.env) {
  return isTrueEnv(env.THUMBGATE_ENFORCE_ENTITLEMENTS);
}

/** Load the shipped public keyset ({ activeKid, keys: {kid: pem} }). */
function loadTrustedKeys(root = path.resolve(__dirname, '..')) {
  try {
    const p = path.join(root, 'config', 'entitlement-public-keys.json');
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return raw.keys || {};
  } catch {
    return {};
  }
}

/**
 * Verify a license token offline. Returns a normalized result — never throws on
 * bad input (returns { valid:false, reason }).
 * @param {string} token
 * @param {{ trustedKeys?: Record<string,string>, now?: number }} [opts]
 */
function verifyLicense(token, opts = {}) {
  const trustedKeys = opts.trustedKeys || loadTrustedKeys();
  const now = opts.now || Math.floor(nowMs() / 1000);
  if (typeof token !== 'string' || !token.trim()) {
    return { valid: false, reason: 'missing_token' };
  }
  // Reject the legacy bypassable prefix keys outright.
  if (/^tg_/.test(token.trim())) {
    return { valid: false, reason: 'legacy_prefix_key_not_a_signed_license' };
  }
  const parts = token.trim().split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed_token' };
  const [h, p, s] = parts;
  let header;
  let payload;
  try {
    header = b64urlDecodeJson(h);
    payload = b64urlDecodeJson(p);
  } catch {
    return { valid: false, reason: 'undecodable_token' };
  }
  if (header.alg !== 'EdDSA' || !header.kid) return { valid: false, reason: 'bad_header' };
  const pubPem = trustedKeys[header.kid];
  if (!pubPem) return { valid: false, reason: 'unknown_key_id' };

  let signatureOk = false;
  try {
    signatureOk = crypto.verify(
      null,
      Buffer.from(`${h}.${p}`),
      crypto.createPublicKey(pubPem),
      Buffer.from(s, 'base64url')
    );
  } catch {
    return { valid: false, reason: 'signature_verify_error' };
  }
  if (!signatureOk) return { valid: false, reason: 'bad_signature' };

  if (typeof payload.exp === 'number' && payload.exp < now) {
    return { valid: false, reason: 'expired', tier: payload.tier };
  }
  const tier = payload.tier || 'free';
  const features = Array.isArray(payload.features) && payload.features.length
    ? payload.features
    : (TIER_FEATURES[tier] || []);
  return {
    valid: true,
    tier,
    features,
    customerId: payload.customerId || null,
    keyId: header.kid,
    exp: payload.exp || null,
  };
}

/**
 * Sign a license token. PRIVATE-key operation — runs in the hosted billing
 * service (or a local dev/setup script), never in the shipped client at runtime.
 * @param {string} privateKeyPem
 * @param {{ tier:string, features?:string[], customerId?:string, kid:string, expSeconds?:number, iat?:number, exp?:number }} claims
 */
function issueLicense(privateKeyPem, claims) {
  const header = { alg: 'EdDSA', kid: claims.kid };
  const iat = claims.iat || Math.floor(nowMs() / 1000);
  const exp = claims.exp || (claims.expSeconds ? iat + claims.expSeconds : undefined);
  const payload = {
    tier: claims.tier,
    features: claims.features || TIER_FEATURES[claims.tier] || [],
    customerId: claims.customerId || null,
    keyId: claims.kid,
    iat,
    ...(exp ? { exp } : {}),
  };
  const h = b64urlEncode(JSON.stringify(header));
  const p = b64urlEncode(JSON.stringify(payload));
  const sig = crypto.sign(null, Buffer.from(`${h}.${p}`), crypto.createPrivateKey(privateKeyPem));
  return `${h}.${p}.${b64urlEncode(sig)}`;
}

/** Resolve the active license token from env or the local config file. */
function resolveLicenseToken(env = process.env) {
  if (env.THUMBGATE_LICENSE && env.THUMBGATE_LICENSE.trim()) return env.THUMBGATE_LICENSE.trim();
  try {
    const p = path.join(os.homedir(), '.config', 'thumbgate', 'license.json');
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (raw.license || raw.token) return String(raw.license || raw.token).trim();
  } catch { /* no local license */ }
  return null;
}

/**
 * Gate a paid feature. Advisory by default; throws EntitlementError only when
 * THUMBGATE_ENFORCE_ENTITLEMENTS is set. Returns { entitled, tier, reason }.
 * @param {string} feature
 * @param {{ env?: NodeJS.ProcessEnv, trustedKeys?: object, token?: string }} [opts]
 */
function requireEntitlement(feature, opts = {}) {
  const env = opts.env || process.env;
  const token = opts.token !== undefined ? opts.token : resolveLicenseToken(env);
  const result = verifyLicense(token, { trustedKeys: opts.trustedKeys });
  const entitled = result.valid && result.features.includes(feature);
  const decision = {
    entitled,
    tier: result.valid ? result.tier : 'free',
    feature,
    reason: entitled ? 'entitled' : (result.valid ? 'feature_not_in_tier' : result.reason),
    enforced: isEnforced(env),
  };
  if (!entitled && decision.enforced) {
    throw new EntitlementError(
      `ThumbGate: "${feature}" requires a paid license (current tier: ${decision.tier}, reason: ${decision.reason}). `
      + `Get a license at https://thumbgate.ai/pricing, then set THUMBGATE_LICENSE or ~/.config/thumbgate/license.json.`,
      decision.reason
    );
  }
  return decision;
}

// Injectable clock (Date.now is fine at runtime; kept in one place for testability).
function nowMs() {
  return Date.now();
}

module.exports = {
  verifyLicense,
  issueLicense,
  requireEntitlement,
  resolveLicenseToken,
  loadTrustedKeys,
  isEnforced,
  TIER_FEATURES,
  EntitlementError,
};
