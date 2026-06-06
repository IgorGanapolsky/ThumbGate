#!/usr/bin/env node
'use strict';

// Agent work-claim lock.
//
// WHY: When a user runs MULTIPLE autonomous coding agents (Claude Code, Codex,
// Antigravity) on the same repo, two agents can pick up and work the SAME unit
// of work at once -> duplicate/conflicting output + wasted tokens. This
// literally happened 2026-06-06: two agents both built the statusline
// feedback-aggregation fix; one (feedback-aggregate-stats.js) became dead code.
//
// This module lets an agent CLAIM a unit of work before doing it so other
// agents skip or wait. It dogfoods ThumbGate's own pitch: pre-action gates for
// AI agents. Claims are tiny JSON files under
// ~/.thumbgate/runtime/work-claims/<sanitized-key>.json, acquired atomically
// via O_EXCL ('wx') file creation so two near-simultaneous claims cannot both
// win.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Default staleness threshold: a claim older than this is reclaimable even if
// its PID is still alive (the holding session likely died and was never
// reaped). 30 minutes matches a typical autonomous task window.
const DEFAULT_TTL_MS = 30 * 60 * 1000;

/**
 * Resolve the home directory that anchors the work-claims store. Reads
 * THUMBGATE_HOME first (test/CI override), then falls back to os.homedir(),
 * which honors $HOME on POSIX so tests can point at a temp dir.
 */
function resolveHomeDir() {
  return process.env.THUMBGATE_HOME || os.homedir();
}

function getClaimsDir() {
  return path.join(resolveHomeDir(), '.thumbgate', 'runtime', 'work-claims');
}

/**
 * Sanitize an arbitrary work key into a safe single-segment filename. Any char
 * outside [A-Za-z0-9._-] becomes '_', and the result is length-capped. To keep
 * distinct keys distinct after sanitization, a short hash of the original key
 * is appended.
 */
function sanitizeKey(key) {
  const raw = String(key == null ? '' : key);
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  // Small deterministic suffix so e.g. "a/b" and "a_b" don't collide.
  let hash = 5381;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
  }
  return `${safe || 'key'}.${hash.toString(36)}`;
}

function claimPathFor(key) {
  return path.join(getClaimsDir(), `${sanitizeKey(key)}.json`);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we can't signal it -> treat as alive.
    return err && err.code === 'EPERM';
  }
}

function readClaim(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * A claim is "live" (still holds the lock) only if it is BOTH within its TTL
 * AND its owning process is still alive. Otherwise it is reclaimable.
 */
function isClaimLive(claim, nowMs = Date.now()) {
  if (!claim || typeof claim !== 'object') return false;
  const claimedAt = Date.parse(claim.claimedAt);
  const ttlMs = Number(claim.ttlMs) > 0 ? Number(claim.ttlMs) : DEFAULT_TTL_MS;
  if (Number.isFinite(claimedAt) && nowMs - claimedAt >= ttlMs) return false;
  if (!isProcessAlive(Number(claim.pid))) return false;
  return true;
}

function publicHeldBy(claim) {
  if (!claim) return null;
  return {
    agentId: claim.agentId,
    pid: claim.pid,
    claimedAt: claim.claimedAt,
  };
}

function writeClaimAtomic(file, claim) {
  // O_EXCL: fails with EEXIST if the file already exists. This is the atomic
  // primitive that makes two simultaneous claims resolve to exactly one winner.
  const fd = fs.openSync(file, 'wx');
  try {
    fs.writeSync(fd, JSON.stringify(claim, null, 2));
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Atomically acquire a lock for `key` if it is not held by a LIVE, non-expired
 * claim.
 *
 * @param {string} key Logical work unit (e.g. "fix:statusline-aggregate").
 * @param {object} [opts]
 * @param {string} [opts.agentId] Caller identity. Defaults to env or a pid tag.
 * @param {number} [opts.ttlMs] Claim lifetime. Defaults to 30 minutes.
 * @param {number} [opts.pid] Owning pid. Defaults to process.pid.
 * @returns {{acquired: boolean, heldBy: {agentId, pid, claimedAt}|null, key, file}}
 */
function claimWork(key, opts = {}) {
  if (!key || typeof key !== 'string') {
    throw new Error('claimWork: key is required and must be a non-empty string');
  }
  const agentId = String(
    opts.agentId || process.env.THUMBGATE_AGENT_ID || `agent-${process.pid}`,
  );
  const ttlMs = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : DEFAULT_TTL_MS;
  const pid = Number.isInteger(opts.pid) ? opts.pid : process.pid;
  const dir = getClaimsDir();
  const file = claimPathFor(key);

  fs.mkdirSync(dir, { recursive: true });

  const claim = {
    key,
    agentId,
    pid,
    claimedAt: new Date().toISOString(),
    ttlMs,
  };

  try {
    writeClaimAtomic(file, claim);
    return { acquired: true, heldBy: publicHeldBy(claim), key, file };
  } catch (err) {
    if (!err || err.code !== 'EEXIST') throw err;
  }

  // A claim file already exists. If the existing holder is dead/expired, the
  // lock is reclaimable: replace the file atomically via temp + rename so a
  // concurrent racer either sees the old file or the new one, never a partial.
  const existing = readClaim(file);
  if (isClaimLive(existing)) {
    return { acquired: false, heldBy: publicHeldBy(existing), key, file };
  }

  // Stale/dead holder. Take over with a unique temp file + atomic rename.
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(claim, null, 2));
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* best-effort */ }
    throw err;
  }

  // Confirm we actually own it post-rename (guards against a racer that
  // reclaimed the same stale lock microseconds earlier).
  const after = readClaim(file);
  if (after && after.agentId === agentId && after.pid === pid && after.claimedAt === claim.claimedAt) {
    return { acquired: true, heldBy: publicHeldBy(claim), key, file };
  }
  return { acquired: false, heldBy: publicHeldBy(after), key, file };
}

/**
 * Release a claim. Only succeeds if held by `agentId`, unless `force` is set.
 *
 * @returns {{released: boolean, reason?: string, heldBy?: object|null, key}}
 */
function releaseWork(key, agentId, opts = {}) {
  if (!key || typeof key !== 'string') {
    throw new Error('releaseWork: key is required and must be a non-empty string');
  }
  const file = claimPathFor(key);
  const existing = readClaim(file);

  if (!existing) {
    return { released: false, reason: 'not_held', heldBy: null, key };
  }
  if (!opts.force && existing.agentId !== String(agentId)) {
    return {
      released: false,
      reason: 'held_by_other',
      heldBy: publicHeldBy(existing),
      key,
    };
  }
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { released: false, reason: 'not_held', heldBy: null, key };
    }
    throw err;
  }
  return { released: true, key };
}

/**
 * List active (live) claims. Reclaimable (expired/dead-pid) claims are reported
 * with `live: false` so callers can see what is takeable.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.includeStale] Include reclaimable claims (default true).
 * @returns {Array<{key, agentId, pid, claimedAt, ttlMs, live, reclaimable}>}
 */
function listClaims(opts = {}) {
  const includeStale = opts.includeStale !== false;
  const dir = getClaimsDir();
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const now = Date.now();
  const claims = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const claim = readClaim(path.join(dir, name));
    if (!claim) continue;
    const live = isClaimLive(claim, now);
    if (!live && !includeStale) continue;
    claims.push({
      key: claim.key,
      agentId: claim.agentId,
      pid: claim.pid,
      claimedAt: claim.claimedAt,
      ttlMs: Number(claim.ttlMs) > 0 ? Number(claim.ttlMs) : DEFAULT_TTL_MS,
      live,
      reclaimable: !live,
    });
  }
  return claims.sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

module.exports = {
  claimWork,
  releaseWork,
  listClaims,
  // Exposed for tests and reuse.
  DEFAULT_TTL_MS,
  getClaimsDir,
  sanitizeKey,
  isClaimLive,
  isProcessAlive,
};

// CLI entrypoint. NEVER use `require.main === module` (SonarCloud S3403);
// use the path-based check per CLAUDE.md.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const [, , cmd, key, agentId] = process.argv;
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  try {
    if (cmd === 'claim') {
      out(claimWork(key, { agentId }));
    } else if (cmd === 'release') {
      out(releaseWork(key, agentId));
    } else if (cmd === 'list') {
      out(listClaims());
    } else {
      process.stderr.write('Usage: agent-work-lock.js <claim|release|list> [key] [agentId]\n');
      process.exit(2);
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
