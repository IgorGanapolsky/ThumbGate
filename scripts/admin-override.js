'use strict';

/**
 * admin-override.js — a governed way for the operator to unlock a gate.
 *
 * DESIGN HONESTY
 * --------------
 * An agent running in the operator's shell can already do anything the operator
 * can. So this module does NOT pretend to be a wall that stops a determined
 * agent. Its job is to make every override **loud, attributed, time-boxed, and
 * permanently recorded**. Accountability, not prevention — which is the same
 * thesis the product sells: receipts at the boundary, not a taller fence.
 *
 * Three properties it does enforce, because each one failed in practice:
 *
 *   1. NO BLANKET GRANTS. A grant names exactly one gate. There is no "*".
 *      A blanket override is indistinguishable from turning the product off.
 *   2. ALWAYS EXPIRES. A grant without a deadline becomes permanent by
 *      forgetting, which is how controls die quietly.
 *   3. SELF-PROTECT GATES NEED EXPLICIT ACKNOWLEDGEMENT. Overriding the gates
 *      that protect the enforcement machinery itself is legitimate for an owner
 *      but must never be a side effect of routine work.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { recordOverride } = require('./override-audit');

/** Grants live beside the other runtime state, not in tracked config. */
function grantStorePath() {
  const base = process.env.THUMBGATE_FEEDBACK_DIR
    || path.join(os.homedir(), '.thumbgate');
  return path.join(base, 'admin-overrides.json');
}

/** Hard ceiling. A grant that outlives the task it was for is a standing hole. */
const MAX_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h

/**
 * Gates that protect the enforcement mechanism itself. Overriding these is the
 * difference between "unblock my work" and "disable the product", so they
 * require the caller to say so out loud.
 */
const SELF_PROTECT_PREFIXES = Object.freeze([
  'self-protect',
  'never-bypass',
  'branch-protection',
  'secret',
]);

function isSelfProtectGate(gateId) {
  const lower = String(gateId || '').toLowerCase();
  return SELF_PROTECT_PREFIXES.some((p) => lower.includes(p));
}

function readStore() {
  try {
    const raw = fs.readFileSync(grantStorePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {}; // absent or corrupt store means "no active grants", never a crash
  }
}

function writeStore(store) {
  const p = grantStorePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(store, null, 2)}\n`);
}

/**
 * Grant a time-boxed override for exactly one gate.
 *
 * @param {object} params
 * @param {string} params.gateId              exact gate id; wildcards refused
 * @param {string} params.grantedBy           who authorized it (a person)
 * @param {string} params.reason              why — required, non-trivial
 * @param {number} [params.ttlMs]             defaults 1h, capped at 24h
 * @param {boolean} [params.acknowledgeSelfProtect]  required for self-protect gates
 * @returns {{ok: boolean, error?: string, grant?: object}}
 */
function grantOverride(params = {}) {
  const gateId = typeof params.gateId === 'string' ? params.gateId.trim() : '';
  if (!gateId) return { ok: false, error: 'gateId is required' };
  if (gateId === '*' || gateId.includes('*')) {
    return { ok: false, error: 'blanket overrides are refused; name exactly one gate' };
  }

  const grantedBy = typeof params.grantedBy === 'string' ? params.grantedBy.trim() : '';
  if (!grantedBy) return { ok: false, error: 'grantedBy is required (name a person)' };

  const reason = typeof params.reason === 'string' ? params.reason.trim() : '';
  // A one-word reason is not a reason. This is the field a reviewer reads later.
  if (reason.length < 12) {
    return { ok: false, error: 'reason must be a real sentence (>= 12 chars)' };
  }

  if (isSelfProtectGate(gateId) && params.acknowledgeSelfProtect !== true) {
    return {
      ok: false,
      error:
        `${gateId} protects the enforcement mechanism itself. `
        + 'Pass acknowledgeSelfProtect: true to override it deliberately.',
    };
  }

  const ttlMs = Math.min(
    Number.isFinite(params.ttlMs) && params.ttlMs > 0 ? params.ttlMs : DEFAULT_TTL_MS,
    MAX_TTL_MS,
  );
  const now = Date.now();
  const grant = {
    gateId,
    grantedBy,
    reason,
    grantedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    ttlMs,
    selfProtect: isSelfProtectGate(gateId),
  };

  const store = readStore();
  store[gateId] = grant;
  writeStore(store);

  // The receipt is the point. A grant that is not recorded did not happen.
  recordOverride({
    gateId,
    source: 'break-glass',
    actor: grantedBy,
    reason,
    evidence: `admin grant, expires ${grant.expiresAt}`
      + (grant.selfProtect ? ' [SELF-PROTECT GATE — acknowledged]' : ''),
    ttlMs,
  });

  return { ok: true, grant };
}

/** True only while an unexpired grant exists for this exact gate. */
function isOverrideActive(gateId) {
  if (!gateId) return false;
  const grant = readStore()[gateId];
  if (!grant || !grant.expiresAt) return false;
  const expiry = Date.parse(grant.expiresAt);
  return Number.isFinite(expiry) && expiry > Date.now();
}

/** Active grants only. Expired entries are dropped from the returned view. */
function listActiveOverrides() {
  const store = readStore();
  const now = Date.now();
  return Object.values(store).filter((g) => {
    const expiry = Date.parse(g && g.expiresAt);
    return Number.isFinite(expiry) && expiry > now;
  });
}

/** Remove expired grants from disk. Returns how many were reaped. */
function expireOverrides() {
  const store = readStore();
  const now = Date.now();
  let reaped = 0;
  for (const [gateId, grant] of Object.entries(store)) {
    const expiry = Date.parse(grant && grant.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now) {
      delete store[gateId];
      reaped += 1;
    }
  }
  if (reaped > 0) writeStore(store);
  return reaped;
}

/** Revoke a grant early. Recorded, because revocation is also an audit event. */
function revokeOverride(gateId, revokedBy = 'operator') {
  const store = readStore();
  if (!store[gateId]) return { ok: false, error: 'no such grant' };
  delete store[gateId];
  writeStore(store);
  recordOverride({
    gateId,
    source: 'break-glass',
    actor: revokedBy,
    reason: 'grant revoked before expiry',
  });
  return { ok: true };
}

module.exports = {
  grantOverride,
  isOverrideActive,
  listActiveOverrides,
  expireOverrides,
  revokeOverride,
  isSelfProtectGate,
  grantStorePath,
  MAX_TTL_MS,
  DEFAULT_TTL_MS,
  SELF_PROTECT_PREFIXES,
};
