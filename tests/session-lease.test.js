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

test('CLI blocks a second session from claiming a live lease', () => {
  const dir = makeSandbox();
  const sessionA = { THUMBGATE_SESSION_AGENT: 'test-session-A' };
  const sessionB = { THUMBGATE_SESSION_AGENT: 'test-session-B' };
  try {
    const claimRun = runScript(['claim'], dir, sessionA);
    assert.strictEqual(claimRun.status, 0, claimRun.stderr);

    // Session B is a different agent; the lease is live because... the recorded
    // pid is from session A's claim process which has exited. To simulate a live
    // foreign holder, write a lease whose pid is a live detached child.
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
      const claimB = runScript(['claim'], dir, sessionB);
      assert.notStrictEqual(claimB.status, 0, 'session B must not claim a live foreign lease');
      assert.match(claimB.stderr, /held by live agent/);

      const checkB = runScript(['check'], dir, sessionB);
      assert.notStrictEqual(checkB.status, 0, 'session B must fail check');
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
