#!/usr/bin/env node
'use strict';

// Checkout session lease — single-writer ownership guard for a shared git checkout.
//
// Why this exists (incident 2026-08-11): two agents ran concurrently in the SAME
// checkout. Agent A force-checked-out another branch and ran `git clean`, wiping
// Agent B's untracked work; Agent B's `git add -A` swept Agent A's untracked file
// into the wrong branch. No mechanism marked "this checkout belongs to one live
// session." Task-scope leases (gates-engine) cap authority per capability, but
// nothing prevented two processes from mutating the same working tree.
//
// This module adds a checkout-level lease:
//   - `claim`    — write .git/thumbgate-session-lease.json. Fails if a DIFFERENT
//                  live session already holds it (same-session re-claim is
//                  idempotent). Uses exclusive-create so concurrent claimers
//                  cannot both succeed.
//   - `check`    — exit 0 if this session holds the lease or no live lease exists;
//                  exit 1 if a different live agent holds it.
//   - `release`  — remove the lease (only the holder may release; a stale holder
//                  may force-release after liveness is false).
//   - `guard`    — run a shell command only while holding the lease.
//
// Liveness:
//   - Prefer a durable PID: THUMBGATE_SESSION_PID (agent/shell parent), else the
//     CLI's process.ppid when the claim command itself is short-lived, else
//     process.pid for in-process API use.
//   - Explicit session tokens (THUMBGATE_SESSION_AGENT) also get a TTL
//     (default 8h, override THUMBGATE_SESSION_LEASE_TTL_MS) so short-lived claim
//     subprocesses do not immediately look "stale" after exit.
//
// The lease file lives in .git/ so `git clean` cannot delete it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LEASE_FILENAME = 'thumbgate-session-lease.json';
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_CLAIM_ATTEMPTS = 5;

function findRepoRoot(start = process.cwd()) {
  let current = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function leasePath(repoRoot) {
  // .git may be a file (worktree/submodule) — resolve its real dir first.
  const gitPath = path.join(repoRoot, '.git');
  let gitDir = gitPath;
  if (fs.existsSync(gitPath) && fs.statSync(gitPath).isFile()) {
    const contents = fs.readFileSync(gitPath, 'utf8').trim();
    const match = contents.match(/^gitdir:\s*(.+)$/);
    if (match) {
      gitDir = path.resolve(repoRoot, match[1]);
    }
  }
  return path.join(gitDir, LEASE_FILENAME);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH = no such process. EPERM = exists but not ours — still alive.
    return error.code === 'EPERM';
  }
}

function readLease(repoRoot) {
  const file = leasePath(repoRoot);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { invalid: true, file };
  }
}

function sessionTtlMs() {
  const fromEnv = Number(process.env.THUMBGATE_SESSION_LEASE_TTL_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.floor(fromEnv);
  }
  return DEFAULT_SESSION_TTL_MS;
}

function hasExplicitSessionAgent() {
  return Boolean(process.env.THUMBGATE_SESSION_AGENT && String(process.env.THUMBGATE_SESSION_AGENT).trim());
}

/**
 * Resolve the PID that should represent lease liveness.
 * Short-lived `node scripts/session-lease.js claim` must not record itself as
 * the only liveness signal — prefer the durable agent/shell parent.
 */
function resolveLeasePid() {
  const fromEnv = Number(process.env.THUMBGATE_SESSION_PID);
  if (Number.isInteger(fromEnv) && fromEnv > 0 && pidAlive(fromEnv)) {
    return fromEnv;
  }

  const invokedAsCli =
    process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
  if (invokedAsCli) {
    const parent = Number(process.ppid);
    if (Number.isInteger(parent) && parent > 1 && pidAlive(parent)) {
      return parent;
    }
  }

  return process.pid;
}

function isLeaseLive(lease) {
  if (!lease || typeof lease !== 'object' || lease.invalid) {
    return false;
  }
  if (Boolean(lease.pid) && pidAlive(Number(lease.pid))) {
    return true;
  }
  if (lease.expiresAt) {
    const expiresMs = Date.parse(lease.expiresAt);
    if (Number.isFinite(expiresMs) && Date.now() < expiresMs) {
      return true;
    }
  }
  return false;
}

function agentId() {
  // A session identity, not a pid identity: one agent session (Hermes, a CI
  // runner, a CLI tool) may span many short-lived subprocesses, each with a
  // different pid. The lease must survive across those subprocesses, so the
  // owning identity is an explicit session token (env override) falling back
  // to host:pid for in-process API use.
  return process.env.THUMBGATE_SESSION_AGENT || `${os.hostname()}:${process.pid}`;
}

function buildLeaseRecord(details = {}) {
  const explicitSession = hasExplicitSessionAgent();
  const ttlMs = details.ttlMs != null ? Number(details.ttlMs) : sessionTtlMs();
  const lease = {
    agent: details.agent || agentId(),
    pid: details.pid != null ? Number(details.pid) : resolveLeasePid(),
    host: os.hostname(),
    startedAt: details.startedAt || new Date().toISOString(),
    cwd: process.cwd(),
    user: process.env.USER || os.userInfo().username || null,
    command: (process.argv[1] || '').split(path.sep).pop() || null,
  };
  // Explicit session tokens get a TTL so claim CLI exit does not free the lease.
  if (explicitSession || details.expiresAt) {
    lease.expiresAt =
      details.expiresAt || new Date(Date.now() + (Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_SESSION_TTL_MS)).toISOString();
  }
  return lease;
}

function writeLease(repoRoot, details = {}, options = {}) {
  const file = leasePath(repoRoot);
  const lease = buildLeaseRecord(details);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = JSON.stringify(lease, null, 2) + '\n';
  if (options.exclusive) {
    fs.writeFileSync(file, payload, { flag: 'wx' });
  } else {
    fs.writeFileSync(file, payload);
  }
  return lease;
}

function removeLease(repoRoot) {
  const file = leasePath(repoRoot);
  if (fs.existsSync(file)) {
    fs.rmSync(file, { force: true });
  }
}

function claim(repoRoot, options = {}) {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
    const existing = readLease(repoRoot);
    const sameSession = existing && !existing.invalid && existing.agent === agentId();
    if (sameSession) {
      // Same session token — idempotent refresh (overwrite allowed).
      const lease = writeLease(repoRoot, {
        ...options,
        agent: existing.agent,
        startedAt: existing.startedAt,
      });
      return { ok: true, alreadyHeld: true, lease };
    }
    if (existing && !existing.invalid && isLeaseLive(existing)) {
      return {
        ok: false,
        code: 'LEASED',
        holder: existing,
        message: `Checkout lease held by live agent ${existing.agent} (pid ${existing.pid}) since ${existing.startedAt}. Another session owns this checkout. Use a separate worktree instead of writing to a claimed checkout.`,
      };
    }

    // Stale or missing: exclusive create so two concurrent claimers cannot both win.
    if (existing && !existing.invalid) {
      try {
        removeLease(repoRoot);
      } catch (error) {
        // retry loop will re-read
      }
    }

    try {
      const lease = writeLease(repoRoot, options, { exclusive: true });
      return { ok: true, alreadyHeld: false, lease };
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        // Lost the race — loop and re-evaluate the winner.
        continue;
      }
      throw error;
    }
  }

  const existing = readLease(repoRoot);
  if (existing && !existing.invalid && isLeaseLive(existing) && existing.agent !== agentId()) {
    return {
      ok: false,
      code: 'LEASED',
      holder: existing,
      message: `Checkout lease held by live agent ${existing.agent} (pid ${existing.pid}) since ${existing.startedAt}. Another session owns this checkout. Use a separate worktree instead of writing to a claimed checkout.`,
    };
  }
  return {
    ok: false,
    code: 'LEASE_RACE',
    message: 'Failed to claim checkout lease after concurrent attempts. Retry in a moment or use a separate worktree.',
  };
}

function check(repoRoot) {
  const existing = readLease(repoRoot);
  if (!existing || existing.invalid) {
    return { ok: true, held: false, lease: null };
  }
  if (existing.agent === agentId()) {
    return { ok: true, held: true, lease: existing, mine: true };
  }
  if (!isLeaseLive(existing)) {
    return { ok: true, held: false, lease: existing, stale: true };
  }
  return {
    ok: false,
    code: 'LEASED',
    held: true,
    lease: existing,
    holder: existing,
    message: `Checkout lease held by live agent ${existing.agent} (pid ${existing.pid}) since ${existing.startedAt}.`,
  };
}

function release(repoRoot, options = {}) {
  const existing = readLease(repoRoot);
  if (!existing || existing.invalid) {
    return { ok: true, released: false, reason: 'no-lease' };
  }
  if (existing.agent === agentId() || options.force) {
    removeLease(repoRoot);
    return { ok: true, released: true, force: Boolean(options.force) };
  }
  if (!isLeaseLive(existing)) {
    // Stale holder is provably dead / expired — cleaning up is safe and keeps the
    // checkout usable after a crashed session.
    removeLease(repoRoot);
    return { ok: true, released: true, stale: true };
  }
  return {
    ok: false,
    code: 'LEASED',
    message: `Lease held by live agent ${existing.agent} (pid ${existing.pid}); only the holder may release.`,
  };
}

function guard(repoRoot, commandArgs, options = {}) {
  const leaseCheck = check(repoRoot);
  if (!leaseCheck.ok) {
    return { ok: false, code: leaseCheck.code, message: leaseCheck.message };
  }
  if (!leaseCheck.held) {
    if (options.autoClaim) {
      const claimResult = claim(repoRoot);
      if (!claimResult.ok) {
        return { ok: false, code: claimResult.code, message: claimResult.message };
      }
    } else {
      return {
        ok: false,
        code: 'UNCLAIMED',
        message: 'No session lease held. Run `node scripts/session-lease.js claim` (or pass --auto-claim) before mutating this checkout.',
      };
    }
  }
  const result = spawnSync(commandArgs[0], commandArgs.slice(1), {
    stdio: 'inherit',
    cwd: repoRoot,
  });
  return { ok: result.status === 0, status: result.status };
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const repoRoot = findRepoRoot();
  if (!repoRoot) {
    console.error('error: not inside a git checkout');
    process.exit(1);
  }

  try {
    switch (command) {
      case 'claim': {
        const result = claim(repoRoot);
        if (!result.ok) {
          console.error(result.message);
          process.exit(1);
        }
        console.log(
          result.alreadyHeld
            ? `lease already held by this session (pid ${result.lease.pid})`
            : `lease claimed: ${result.lease.agent} since ${result.lease.startedAt}`
        );
        process.exit(0);
      }
      case 'check': {
        const result = check(repoRoot);
        if (!result.ok) {
          console.error(result.message);
          process.exit(1);
        }
        console.log(result.held ? `lease held by this session (pid ${result.lease.pid})` : 'lease free');
        process.exit(0);
      }
      case 'release': {
        const result = release(repoRoot, { force: args.includes('--force') });
        if (!result.ok) {
          console.error(result.message);
          process.exit(1);
        }
        console.log(
          result.released
            ? `lease released${result.stale ? ' (stale holder)' : ''}`
            : 'no lease to release'
        );
        process.exit(0);
      }
      case 'guard': {
        const autoClaim = args.includes('--auto-claim');
        const commandArgs = args.slice(1).filter((arg) => arg !== '--auto-claim');
        const result = guard(repoRoot, commandArgs, { autoClaim });
        if (!result.ok) {
          console.error(result.message || `command failed with status ${result.status}`);
          process.exit(result.code === 'LEASED' || result.code === 'UNCLAIMED' ? 1 : 2);
        }
        process.exit(0);
      }
      case 'lease-path': {
        console.log(leasePath(repoRoot));
        process.exit(0);
      }
      default: {
        console.error('usage: node scripts/session-lease.js <claim|check|release|guard|lease-path>');
        process.exit(1);
      }
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_SESSION_TTL_MS,
  LEASE_FILENAME,
  agentId,
  check,
  claim,
  findRepoRoot,
  guard,
  isLeaseLive,
  leasePath,
  pidAlive,
  readLease,
  release,
  removeLease,
  resolveLeasePid,
  writeLease,
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main();
}
