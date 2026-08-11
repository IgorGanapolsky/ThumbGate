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
//                  live PID already holds it (same-PID re-claim is idempotent).
//   - `check`    — exit 0 if this PID holds the lease or no live lease exists;
//                  exit 1 if a different live agent holds it.
//   - `release`  — remove the lease (only the holder may release; a stale holder
//                  may force-release after the PID is provably dead).
//   - `guard`    — run a shell command only while holding the lease.
//
// Stale detection: a lease whose PID is no longer alive (kill(pid, 0) throws
// ESRCH/EPERM rules) is considered expired and may be re-claimed by anyone.
// The lease file lives in .git/ so `git clean` cannot delete it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LEASE_FILENAME = 'thumbgate-session-lease.json';

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

function isLeaseLive(lease) {
  if (!lease || typeof lease !== 'object') {
    return false;
  }
  return Boolean(lease.pid) && pidAlive(Number(lease.pid));
}

function agentId() {
  // A session identity, not a pid identity: one agent session (Hermes, a CI
  // runner, a CLI tool) may span many short-lived subprocesses, each with a
  // different pid. The lease must survive across those subprocesses, so the
  // owning identity is an explicit session token (env override) falling back
  // to host:pid for in-process API use.
  return process.env.THUMBGATE_SESSION_AGENT || `${os.hostname()}:${process.pid}`;
}

function writeLease(repoRoot, details) {
  const file = leasePath(repoRoot);
  const lease = {
    agent: details.agent || agentId(),
    pid: process.pid,
    host: os.hostname(),
    startedAt: new Date().toISOString(),
    cwd: process.cwd(),
    user: process.env.USER || os.userInfo().username || null,
    command: (process.argv[1] || '').split(path.sep).pop() || null,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(lease, null, 2) + '\n');
  return lease;
}

function removeLease(repoRoot) {
  const file = leasePath(repoRoot);
  if (fs.existsSync(file)) {
    fs.rmSync(file, { force: true });
  }
}

function claim(repoRoot, options = {}) {
  const existing = readLease(repoRoot);
  const sameSession = existing && !existing.invalid && existing.agent === agentId();
  if (sameSession) {
    // Same session token — idempotent, and refresh the pid so the recorded
    // holder is this current subprocess (survives the claiming process exiting).
    const lease = writeLease(repoRoot, options);
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
  const lease = writeLease(repoRoot, options);
  return { ok: true, alreadyHeld: false, lease };
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
    // Stale holder is provably dead — cleaning up is safe and keeps the
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
      claim(repoRoot);
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
  writeLease,
};

if (require.main === module) {
  main();
}
