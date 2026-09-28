'use strict';

// Checkout session lease tests — pin the single-writer property that was
// missing on 2026-08-11 when two agents mutated the same checkout concurrently
// (one wiped untracked work with git clean; the other's git add -A swept a
// foreign file into the wrong branch).
//
// The property that matters: a live lease held by another PID blocks claim,
// check, release, and guard. Stale leases (dead PID) are reclaimable.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const lease = require('../scripts/session-lease.js');

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-session-lease-'));
  // Minimal git checkout so findRepoRoot/leasePath behave like the real repo.
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

function runScript(args, cwd, env) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'session-lease.js'), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test.beforeEach(() => {});
test.afterEach(() => {});

test('claim writes a lease and check reports it held by this session', () => {
  const dir = makeSandbox();
  try {
    const result = lease.claim(dir);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.alreadyHeld, false);
    assert.strictEqual(result.lease.pid, process.pid);

    const held = lease.check(dir);
    assert.strictEqual(held.ok, true);
    assert.strictEqual(held.held, true);
    assert.strictEqual(held.mine, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a live foreign lease blocks claim, check, release, and guard', async () => {
  const dir = makeSandbox();
  const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: dir,
    detached: true,
    stdio: 'ignore',
  });
  try {
    // The child is alive but not this process — a genuine foreign holder.
    fs.writeFileSync(
      lease.leasePath(dir),
      JSON.stringify({ agent: `foreign:${child.pid}`, pid: child.pid, startedAt: new Date().toISOString() })
    );

    const claimResult = lease.claim(dir);
    assert.strictEqual(claimResult.ok, false, 'live foreign holder must block claim');
    assert.strictEqual(claimResult.code, 'LEASED');

    const checkResult = lease.check(dir);
    assert.strictEqual(checkResult.ok, false, 'live foreign holder must fail check');
    assert.strictEqual(checkResult.code, 'LEASED');

    const releaseResult = lease.release(dir);
    assert.strictEqual(releaseResult.ok, false, 'live foreign holder must not be releasable');
    assert.strictEqual(releaseResult.code, 'LEASED');

    const guardResult = lease.guard(dir, [process.execPath, '-e', 'console.log("ran")']);
    assert.strictEqual(guardResult.ok, false, 'live foreign holder must block guard');
    assert.strictEqual(guardResult.code, 'LEASED');
  } finally {
    try {
      process.kill(child.pid);
    } catch (error) {
      // already dead
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a stale lease (dead pid) is reclaimable and releasable', () => {
  const dir = makeSandbox();
  try {
    const deadPid = 99999999; // improbable live pid
    fs.writeFileSync(
      lease.leasePath(dir),
      JSON.stringify({ agent: 'dead-agent', pid: deadPid, startedAt: new Date().toISOString() })
    );

    const checkResult = lease.check(dir);
    assert.strictEqual(checkResult.ok, true, 'stale lease must not block');
    assert.strictEqual(checkResult.held, false);
    assert.strictEqual(checkResult.stale, true);

    const claimResult = lease.claim(dir);
    assert.strictEqual(claimResult.ok, true, 'stale lease must be reclaimable');
    assert.strictEqual(claimResult.lease.pid, process.pid);

    const releaseResult = lease.release(dir);
    assert.strictEqual(releaseResult.ok, true);
    assert.strictEqual(releaseResult.released, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no lease present means check passes and claim is instant', () => {
  const dir = makeSandbox();
  try {
    const free = lease.check(dir);
    assert.strictEqual(free.ok, true);
    assert.strictEqual(free.held, false);

    const result = lease.claim(dir);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.alreadyHeld, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('same-pid re-claim is idempotent', () => {
  const dir = makeSandbox();
  try {
    const first = lease.claim(dir);
    assert.strictEqual(first.ok, true);
    const second = lease.claim(dir);
    assert.strictEqual(second.ok, true);
    assert.strictEqual(second.alreadyHeld, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('release by a live foreign holder is refused', () => {
  const dir = makeSandbox();
  try {
    // Simulate a live foreign holder using this very process's pid (it is alive
    // and, from the lease's perspective, an owner other than... it IS us, which
    // makes this the same-pid case). To get a TRUE foreign holder we need a pid
    // that is alive but not ours — spawn a detached child that sleeps forever,
    // read its pid, and only kill it at the end.
    const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: dir,
      detached: true,
      stdio: 'ignore',
    });
    try {
      assert.ok(child.pid > 0, 'child pid should exist');
      fs.writeFileSync(
        lease.leasePath(dir),
        JSON.stringify({ agent: `foreign:${child.pid}`, pid: child.pid, startedAt: new Date().toISOString() })
      );

      const result = lease.release(dir);
      assert.strictEqual(result.ok, false, 'foreign live holder must not be releasable');
      assert.strictEqual(result.code, 'LEASED');

      const claimResult = lease.claim(dir);
      assert.strictEqual(claimResult.ok, false, 'foreign live holder must block claim');
      assert.strictEqual(claimResult.code, 'LEASED');
    } finally {
      try {
        process.kill(child.pid);
      } catch (error) {
        // already dead
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI claim/check/release round-trip (same session token across subprocesses)', () => {
  const dir = makeSandbox();
  const sessionEnv = { THUMBGATE_SESSION_AGENT: 'test-session-1' };
  try {
    const claimRun = runScript(['claim'], dir, sessionEnv);
    assert.strictEqual(claimRun.status, 0, claimRun.stderr);

    const checkRun = runScript(['check'], dir, sessionEnv);
    assert.strictEqual(checkRun.status, 0, checkRun.stderr);
    assert.match(checkRun.stdout, /held by this session/);

    const releaseRun = runScript(['release'], dir, sessionEnv);
    assert.strictEqual(releaseRun.status, 0, releaseRun.stderr);

    const checkAfter = runScript(['check'], dir, sessionEnv);
    assert.strictEqual(checkAfter.status, 0);
    assert.match(checkAfter.stdout, /lease free/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('findRepoRoot walks up and returns null outside any git checkout', () => {
  const dir = makeSandbox();
  try {
    const nested = path.join(dir, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    assert.strictEqual(lease.findRepoRoot(nested), dir);

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-no-git-'));
    try {
      assert.strictEqual(lease.findRepoRoot(outside), null);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('leasePath resolves a .git file (worktree) to its git dir', () => {
  const dir = makeSandbox();
  try {
    const realGit = path.join(dir, 'real-git');
    fs.mkdirSync(realGit, { recursive: true });
    // Replace the bare .git dir with a worktree pointer file.
    fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true });
    fs.writeFileSync(path.join(dir, '.git'), `gitdir: ${path.join(realGit, 'commondir')}\n`);
    const resolved = lease.leasePath(dir);
    assert.strictEqual(resolved, path.join(realGit, 'commondir', lease.LEASE_FILENAME));
    assert.strictEqual(lease.leasePath(dir), path.join(realGit, 'commondir', lease.LEASE_FILENAME));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid lease JSON and non-object leases are treated as free', () => {
  const dir = makeSandbox();
  try {
    fs.writeFileSync(lease.leasePath(dir), 'not json{{{');
    const checkResult = lease.check(dir);
    assert.strictEqual(checkResult.ok, true);
    assert.strictEqual(checkResult.held, false);

    fs.rmSync(lease.leasePath(dir));
    assert.strictEqual(lease.isLeaseLive(null), false);
    assert.strictEqual(lease.isLeaseLive({ pid: null }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('release with no lease and release of a stale lease', () => {
  const dir = makeSandbox();
  try {
    const none = lease.release(dir);
    assert.strictEqual(none.ok, true);
    assert.strictEqual(none.released, false);
    assert.strictEqual(none.reason, 'no-lease');

    fs.writeFileSync(
      lease.leasePath(dir),
      JSON.stringify({ agent: 'dead-agent', pid: 99999999, startedAt: new Date().toISOString() })
    );
    const stale = lease.release(dir);
    assert.strictEqual(stale.ok, true);
    assert.strictEqual(stale.released, true);
    assert.strictEqual(stale.stale, true);
    assert.strictEqual(fs.existsSync(lease.leasePath(dir)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('guard requires a claim unless --auto-claim is used, then runs the command', () => {
  const dir = makeSandbox();
  try {
    const noClaim = lease.guard(dir, [process.execPath, '-e', '']);
    assert.strictEqual(noClaim.ok, false);
    assert.strictEqual(noClaim.code, 'UNCLAIMED');

    const auto = lease.guard(dir, [process.execPath, '-e', 'console.log("ran-under-lease")'], {
      autoClaim: true,
    });
    assert.strictEqual(auto.ok, true);
    assert.strictEqual(auto.status, 0);
    const held = lease.check(dir);
    assert.strictEqual(held.held, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('guard reports a failing command status', () => {
  const dir = makeSandbox();
  try {
    const result = lease.guard(dir, [process.execPath, '-e', 'process.exit(3)'], { autoClaim: true });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI outside a git checkout errors', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-no-git-cli-'));
  try {
    const run = runScript(['claim'], outside);
    assert.notStrictEqual(run.status, 0);
    assert.match(run.stderr, /not inside a git checkout/);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('CLI release --force overrides a live foreign holder', () => {
  const dir = makeSandbox();
  const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: dir,
    detached: true,
    stdio: 'ignore',
  });
  try {
    fs.writeFileSync(
      lease.leasePath(dir),
      JSON.stringify({ agent: 'foreign-holder', pid: child.pid, startedAt: new Date().toISOString() })
    );
    const releaseRun = runScript(['release', '--force'], dir, {});
    assert.strictEqual(releaseRun.status, 0, releaseRun.stderr);
    assert.strictEqual(fs.existsSync(lease.leasePath(dir)), false);
  } finally {
    try {
      process.kill(child.pid);
    } catch (error) {
      // already dead
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI guard runs a command and lease-path prints the lease file', () => {
  const dir = makeSandbox();
  const sessionEnv = { THUMBGATE_SESSION_AGENT: 'test-session-guard' };
  try {
    const guardRun = runScript(['guard', '--auto-claim', process.execPath, '-e', 'console.log("guarded")'], dir, sessionEnv);
    assert.strictEqual(guardRun.status, 0, guardRun.stderr);
    assert.match(guardRun.stdout, /guarded/);

    const pathRun = runScript(['lease-path'], dir, sessionEnv);
    assert.strictEqual(pathRun.status, 0, pathRun.stderr);
    assert.strictEqual(pathRun.stdout.trim(), lease.leasePath(fs.realpathSync(dir)));

    const usage = runScript(['bogus'], dir, sessionEnv);
    assert.notStrictEqual(usage.status, 0);
    assert.match(usage.stderr, /usage:/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI blocks a second session from claiming a live lease', () => {
  const dir = makeSandbox();
  const sessionA = { THUMBGATE_SESSION_AGENT: 'test-session-A' };
  const sessionB = { THUMBGATE_SESSION_AGENT: 'test-session-B' };
  try {
    // Explicit session tokens keep the lease live via TTL even after the
    // short-lived claim process exits — that is the documented claim workflow.
    const claimRun = runScript(['claim'], dir, sessionA);
    assert.strictEqual(claimRun.status, 0, claimRun.stderr);

    const claimB = runScript(['claim'], dir, sessionB);
    assert.notStrictEqual(claimB.status, 0, 'session B must not claim a live foreign lease');
    assert.match(claimB.stderr, /held by live agent/);

    const checkB = runScript(['check'], dir, sessionB);
    assert.notStrictEqual(checkB.status, 0, 'session B must fail check');

    // Same session can re-claim / check after the claim subprocess exited.
    const checkA = runScript(['check'], dir, sessionA);
    assert.strictEqual(checkA.status, 0, checkA.stderr);
    assert.match(checkA.stdout, /held by this session/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('session-token lease with expired TTL is reclaimable when pid is dead', () => {
  const dir = makeSandbox();
  try {
    fs.writeFileSync(
      lease.leasePath(dir),
      JSON.stringify({
        agent: 'expired-session',
        pid: 99999999,
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      })
    );
    const claimResult = lease.claim(dir);
    assert.strictEqual(claimResult.ok, true, 'expired TTL + dead pid must be reclaimable');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('claim uses exclusive create so concurrent free-checkout claimers cannot both succeed', () => {
  const dir = makeSandbox();
  try {
    const file = lease.leasePath(dir);
    // Pre-create the lease file so the exclusive write path hits EEXIST and
    // re-evaluates the live foreign holder instead of overwriting.
    const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: dir,
      detached: true,
      stdio: 'ignore',
    });
    try {
      fs.writeFileSync(
        file,
        JSON.stringify({ agent: `foreign:${child.pid}`, pid: child.pid, startedAt: new Date().toISOString() })
      );
      const result = lease.claim(dir);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, 'LEASED');
      const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.strictEqual(onDisk.agent, `foreign:${child.pid}`);
    } finally {
      try {
        process.kill(child.pid);
      } catch (error) {
        // already dead
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('THUMBGATE_SESSION_PID is recorded as the durable lease holder', () => {
  const dir = makeSandbox();
  const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: dir,
    detached: true,
    stdio: 'ignore',
  });
  const prev = process.env.THUMBGATE_SESSION_PID;
  try {
    process.env.THUMBGATE_SESSION_PID = String(child.pid);
    const result = lease.claim(dir);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.lease.pid, child.pid);
  } finally {
    if (prev === undefined) {
      delete process.env.THUMBGATE_SESSION_PID;
    } else {
      process.env.THUMBGATE_SESSION_PID = prev;
    }
    try {
      process.kill(child.pid);
    } catch (error) {
      // already dead
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('monotonic lease epoch increments on reclamation and fencing token validates correctly', () => {
  const dir = makeSandbox();
  try {
    // Claim 1
    const firstClaim = lease.claim(dir);
    assert.strictEqual(firstClaim.ok, true);
    assert.strictEqual(firstClaim.lease.lease_epoch, 1);
    assert.strictEqual(firstClaim.lease.fencing_token, `epoch-1-pid-${process.pid}`);

    // Verify fencing token matches
    const verifyValid = lease.verifyFencingToken(dir, firstClaim.lease.fencing_token);
    assert.strictEqual(verifyValid.ok, true);
    assert.strictEqual(verifyValid.lease.lease_epoch, 1);

    // Verify stale/invalid fencing token fails
    const verifyStale = lease.verifyFencingToken(dir, 'epoch-0-pid-9999');
    assert.strictEqual(verifyStale.ok, false);
    assert.strictEqual(verifyStale.code, 'STALE_LEASE_FENCED');

    // Release lease
    lease.release(dir);

    // Claim 2: dead PID / new epoch simulation
    fs.writeFileSync(
      lease.leasePath(dir),
      JSON.stringify({ agent: 'stale-agent', pid: 99999999, lease_epoch: 1, startedAt: new Date().toISOString() })
    );

    const secondClaim = lease.claim(dir);
    assert.strictEqual(secondClaim.ok, true);
    assert.strictEqual(secondClaim.lease.lease_epoch, 2);
    assert.strictEqual(secondClaim.lease.fencing_token, `epoch-2-pid-${process.pid}`);

    // Previous epoch token is now fenced
    const verifyOlder = lease.verifyFencingToken(dir, firstClaim.lease.fencing_token);
    assert.strictEqual(verifyOlder.ok, false);
    assert.strictEqual(verifyOlder.code, 'STALE_LEASE_FENCED');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('auditControlPlane detects secrets and validates clean leases', () => {
  const cleanLease = {
    agent: 'test-agent',
    pid: 12345,
    lease_epoch: 3,
    fencing_token: 'epoch-3-pid-12345',
  };
  const cleanAudit = lease.auditControlPlane(cleanLease);
  assert.strictEqual(cleanAudit.ok, true);
  assert.strictEqual(cleanAudit.clean, true);

  const dirtyLease = {
    agent: 'test-agent',
    pid: 12345,
    token: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
  };
  const dirtyAudit = lease.auditControlPlane(dirtyLease);
  assert.strictEqual(dirtyAudit.ok, false);
  assert.strictEqual(dirtyAudit.clean, false);
  assert.strictEqual(dirtyAudit.code, 'SECRET_FOUND');

  const emptyAudit = lease.auditControlPlane(null);
  assert.strictEqual(emptyAudit.ok, true);
  assert.strictEqual(emptyAudit.clean, true);
});

test('release with executionId prevents releasing when replaced by newer execution', () => {
  const dir = makeSandbox();
  try {
    fs.writeFileSync(
      lease.leasePath(dir),
      JSON.stringify({
        agent: lease.agentId(),
        pid: process.pid,
        executionId: 'exec-new',
        startedAt: new Date().toISOString(),
      })
    );

    // Stale release attempt with older executionId
    const staleRelease = lease.release(dir, { executionId: 'exec-old' });
    assert.strictEqual(staleRelease.ok, false);
    assert.strictEqual(staleRelease.code, 'STALE_EXECUTION');

    // Matching executionId releases successfully
    const validRelease = lease.release(dir, { executionId: 'exec-new' });
    assert.strictEqual(validRelease.ok, true);
    assert.strictEqual(validRelease.released, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('same-session claim keeps executionId and a dead holder gets a new one', () => {
  const dir = makeSandbox();
  const prev = process.env.THUMBGATE_SESSION_AGENT;
  try {
    process.env.THUMBGATE_SESSION_AGENT = 'grok-e2b-planes-test';
    const first = lease.claim(dir);
    assert.strictEqual(first.ok, true);
    assert.match(first.lease.executionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const second = lease.claim(dir);
    assert.strictEqual(second.alreadyHeld, true);
    assert.strictEqual(second.lease.executionId, first.lease.executionId);
    assert.strictEqual(second.lease.lease_epoch, first.lease.lease_epoch);

    fs.writeFileSync(
      lease.leasePath(dir),
      JSON.stringify({
        agent: 'dead-other',
        pid: 99999999,
        executionId: first.lease.executionId,
        lease_epoch: 4,
        startedAt: new Date().toISOString(),
      })
    );
    const reclaimed = lease.claim(dir);
    assert.strictEqual(reclaimed.ok, true);
    assert.notStrictEqual(reclaimed.lease.executionId, first.lease.executionId);
    assert.strictEqual(reclaimed.lease.lease_epoch, 5);
  } finally {
    if (prev === undefined) {
      delete process.env.THUMBGATE_SESSION_AGENT;
    } else {
      process.env.THUMBGATE_SESSION_AGENT = prev;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('force does not delete a lease when the executionId is stale', () => {
  const dir = makeSandbox();
  try {
    fs.writeFileSync(
      lease.leasePath(dir),
      JSON.stringify({
        agent: 'someone-else',
        pid: process.pid,
        executionId: 'exec-new',
        startedAt: new Date().toISOString(),
      })
    );
    const stale = lease.release(dir, { executionId: 'exec-old', force: true });
    assert.strictEqual(stale.ok, false);
    assert.strictEqual(stale.code, 'STALE_EXECUTION');
    const still = JSON.parse(fs.readFileSync(lease.leasePath(dir), 'utf8'));
    assert.strictEqual(still.executionId, 'exec-new');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('claim refuses a secret session identity and does not store it', () => {
  const dir = makeSandbox();
  const prev = process.env.THUMBGATE_SESSION_AGENT;
  const secret = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
  try {
    process.env.THUMBGATE_SESSION_AGENT = secret;
    assert.throws(
      () => lease.claim(dir),
      (error) => {
        assert.strictEqual(error.code, 'SECRET_IN_CONTROL_PLANE');
        assert.ok(!String(error.message).includes(secret));
        assert.ok(!String(error.message).includes('ghp_'));
        return true;
      }
    );
    const file = lease.leasePath(dir);
    if (fs.existsSync(file)) {
      assert.ok(!fs.readFileSync(file, 'utf8').includes('ghp_'));
    }
  } finally {
    if (prev === undefined) {
      delete process.env.THUMBGATE_SESSION_AGENT;
    } else {
      process.env.THUMBGATE_SESSION_AGENT = prev;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('planes flags a shell payload and does not echo a secret', () => {
  const secret = 'github_pat_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const audited = lease.auditControlPlane({
    agent: 'holder',
    command: 'git clean -fd; rm -rf /',
    token: secret,
  });
  assert.strictEqual(audited.ok, false);
  assert.strictEqual(audited.code, 'SECRET_FOUND');
  const encoded = JSON.stringify(audited);
  assert.ok(!encoded.includes(secret));
  assert.ok(!encoded.includes('github_pat_'));

  const payloadOnly = lease.auditControlPlane({
    agent: 'holder',
    command: 'echo hi | tee /tmp/x',
  });
  assert.strictEqual(payloadOnly.ok, false);
  assert.strictEqual(payloadOnly.code, 'DATA_PLANE_PAYLOAD');
  assert.ok(!JSON.stringify(payloadOnly).includes('echo hi'));
});

test('planes on an empty checkout exits 0', () => {
  const dir = makeSandbox();
  try {
    const result = runScript(['planes'], dir);
    assert.strictEqual(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.clean, true);
    assert.deepStrictEqual(parsed.findings, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('claim removes the checkout lock when it finishes', () => {
  const dir = makeSandbox();
  try {
    const result = lease.claim(dir);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(fs.existsSync(`${lease.leasePath(dir)}.lock`), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

