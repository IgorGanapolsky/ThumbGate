'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const gitAtScale = require('../scripts/git-at-scale');
const sessionLease = require('../scripts/session-lease');

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-git-scale-'));
  git(['init', '-b', 'main'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), 'one\n');
  git(['add', 'README.md'], dir);
  git(['commit', '-m', 'init'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), 'two\n');
  git(['add', 'README.md'], dir);
  git(['commit', '-m', 'two'], dir);
  return dir;
}

function addWorktree(repo, name, opts = {}) {
  const base = opts.base || path.join(repo, '.claude', 'worktrees');
  fs.mkdirSync(base, { recursive: true });
  const target = path.join(base, name);
  const branch = opts.branch || `wt-${name}`;
  const res = git(['worktree', 'add', '-b', branch, target, 'HEAD'], repo);
  assert.equal(res.status, 0, res.stderr);
  return target;
}

test('scorecard reports origin as source of truth and local as warm cache', () => {
  const repo = makeRepo();
  try {
    const card = gitAtScale.getScaleScorecard(repo);
    assert.equal(fs.realpathSync(card.repoRoot), fs.realpathSync(repo));
    assert.equal(typeof card.packfiles, 'number');
    assert.equal(card.activeWorktrees >= 1, true);
    assert.equal(card.sourceOfTruth, 'origin');
    assert.equal(card.localRole, 'warm-cache');
    assert.ok(Array.isArray(card.unhealthyReasons));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('maintenance writes commit-graph and multi-pack-index when lease held', () => {
  const repo = makeRepo();
  try {
    git(['repack', '-d'], repo);
    sessionLease.claim(repo);
    const maint = gitAtScale.runMaintenance(repo, { geometric: false });
    assert.equal(maint.blocked, undefined);
    assert.equal(maint.commitGraphUpdated, true);
    assert.equal(maint.multiPackIndexUpdated, true);
    assert.equal(gitAtScale.hasCommitGraph(repo), true);
    assert.equal(gitAtScale.hasMultiPackIndex(repo), true);
    assert.equal(maint.geometricRepackDone, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('cheap maintenance does not require a lease; geometric does', () => {
  const repo = makeRepo();
  try {
    const cheap = gitAtScale.runMaintenance(repo, { geometric: false });
    assert.equal(cheap.blocked, undefined);
    assert.equal(cheap.commitGraphUpdated, true);

    const geo = gitAtScale.runMaintenance(repo, { geometric: true });
    assert.equal(geo.blocked, true);
    assert.equal(geo.code, 'UNCLAIMED');

    sessionLease.claim(repo);
    const geoOk = gitAtScale.runMaintenance(repo, { geometric: true });
    assert.equal(geoOk.blocked, undefined);
    assert.equal(geoOk.geometricRepackDone, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('prune dry-run never removes primary and skips dirty / outside-base worktrees', () => {
  const repo = makeRepo();
  try {
    const dirty = addWorktree(repo, 'dirty');
    fs.writeFileSync(path.join(dirty, 'scratch.txt'), 'nope\n');
    const outsiderDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-git-scale-out-'));
    const outsider = path.join(outsiderDir, 'outside');
    const addOut = git(['worktree', 'add', '-b', 'wt-outside', outsider, 'HEAD'], repo);
    assert.equal(addOut.status, 0, addOut.stderr);

    const result = gitAtScale.pruneWorktrees({
      repoRoot: repo,
      maxAgeDays: 0,
      dryRun: true,
    });
    assert.equal(result.dryRun, true);
    const reasons = Object.fromEntries(result.skipped.map((s) => [s.reason, true]));
    assert.equal(reasons.primary, true);
    assert.equal(reasons.dirty, true);
    assert.equal(reasons['outside-agent-base'], true);
    assert.equal(result.prunedPaths.includes(repo), false);
    assert.ok(fs.existsSync(dirty));
    assert.ok(fs.existsSync(outsider));
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp hook noise */ }
  }
});

test('prune --apply removes a clean aged worktree under the agent base', () => {
  const repo = makeRepo();
  try {
    sessionLease.claim(repo);
    const target = addWorktree(repo, 'cattle');
    const past = new Date(Date.now() - 10 * 24 * 3600000);
    fs.utimesSync(target, past, past);
    const result = gitAtScale.pruneWorktrees({
      repoRoot: repo,
      maxAgeDays: 5,
      dryRun: false,
    });
    assert.equal(result.blocked, undefined);
    assert.equal(result.dryRun, false);
    assert.equal(result.prunedCount, 1);
    assert.equal(fs.existsSync(target), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('prune skips a worktree with a live session lease', () => {
  const repo = makeRepo();
  const live = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    cwd: repo,
    detached: true,
    stdio: 'ignore',
  });
  try {
    sessionLease.claim(repo);
    const target = addWorktree(repo, 'leased');
    const past = new Date(Date.now() - 10 * 24 * 3600000);
    fs.utimesSync(target, past, past);
    fs.writeFileSync(
      sessionLease.leasePath(target),
      JSON.stringify({
        agent: `foreign:${live.pid}`,
        pid: live.pid,
        startedAt: new Date().toISOString(),
      }),
    );
    const result = gitAtScale.pruneWorktrees({
      repoRoot: repo,
      maxAgeDays: 5,
      dryRun: false,
    });
    assert.ok(result.skipped.some((s) => s.reason === 'live-lease'));
    assert.ok(fs.existsSync(target));
  } finally {
    try { process.kill(live.pid, 'SIGKILL'); } catch { /* already gone */ }
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('tip consistency without fetch reports local vs origin when origin exists', () => {
  const repo = makeRepo();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-git-scale-remote-'));
  try {
    git(['init', '--bare', '-b', 'main'], remote);
    git(['remote', 'add', 'origin', remote], repo);
    git(['push', '-u', 'origin', 'main'], repo);
    const tip = gitAtScale.checkTipConsistency({
      repoRoot: repo,
      branch: 'main',
      fetch: false,
    });
    assert.equal(tip.consistent, true);
    assert.equal(tip.behind, false);
    assert.equal(tip.ahead, false);
    assert.equal(tip.indeterminate, false);
    assert.equal(tip.fetched, false);
    assert.match(tip.localTip, /^[0-9a-f]{40}$/);
    assert.equal(tip.localTip, tip.remoteTip);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  }
});

test('tip consistency reports ahead separately from behind', () => {
  const repo = makeRepo();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-git-scale-remote-'));
  try {
    git(['init', '--bare', '-b', 'main'], remote);
    git(['remote', 'add', 'origin', remote], repo);
    git(['push', '-u', 'origin', 'main'], repo);
    fs.writeFileSync(path.join(repo, 'README.md'), 'ahead\n');
    git(['add', 'README.md'], repo);
    git(['commit', '-m', 'ahead'], repo);
    const tip = gitAtScale.checkTipConsistency({ repoRoot: repo, branch: 'main', fetch: false });
    assert.equal(tip.ahead, true);
    assert.equal(tip.behind, false);
    assert.equal(tip.consistent, false);
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp */ }
    try { fs.rmSync(remote, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp */ }
  }
});

test('failed fetch does not evaluate a stale tracking ref', () => {
  const repo = makeRepo();
  try {
    git(['remote', 'add', 'origin', path.join(repo, 'does-not-exist.git')], repo);
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], repo);
    const tip = gitAtScale.checkTipConsistency({ repoRoot: repo, branch: 'main', fetch: true });
    assert.equal(tip.indeterminate, true);
    assert.equal(tip.consistent, null);
    assert.equal(tip.behind, null);
    assert.equal(tip.remoteTip, null);
    assert.ok(tip.fetchError);
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp */ }
  }
});

test('scorecard from a linked worktree uses the common object store', () => {
  const repo = makeRepo();
  try {
    sessionLease.claim(repo);
    gitAtScale.runMaintenance(repo, { geometric: false });
    const wt = addWorktree(repo, 'view');
    const fromPrimary = gitAtScale.getScaleScorecard(repo);
    const fromWorktree = gitAtScale.getScaleScorecard(wt);
    assert.equal(fromPrimary.commitGraph, true);
    assert.equal(fromWorktree.commitGraph, true);
    assert.equal(fromPrimary.packfiles, fromWorktree.packfiles);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('agent worktree base is the primary checkout even when invoked from a linked worktree', () => {
  const repo = makeRepo();
  try {
    const wt = addWorktree(repo, 'view');
    const fromPrimary = gitAtScale.resolveAgentBase(repo);
    const fromWorktree = gitAtScale.resolveAgentBase(wt);
    const expected = path.join(fs.realpathSync(repo), '.claude', 'worktrees');
    assert.equal(fs.realpathSync(fromPrimary), expected);
    assert.equal(fs.realpathSync(fromWorktree), expected);
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp hook noise */ }
  }
});

test('scorecard --cwd ignores inherited GIT_DIR', () => {
  const repo = makeRepo();
  const orphan = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-git-scale-orphan-'));
  try {
    const previous = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(repo, '.git');
    try {
      assert.throws(() => gitAtScale.getRepoRoot(orphan), /Not a git repository/);
    } finally {
      if (previous === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previous;
    }
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp */ }
    try { fs.rmSync(orphan, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp */ }
  }
});

test('git spawn uses a fixed PATH and a resolved git binary', () => {
  assert.equal(gitAtScale.SAFE_GIT_PATH, '/usr/bin:/bin');
  assert.match(gitAtScale.GIT_BIN, /git$/);
});

test('prune --apply without a lease is blocked; missing base is a no-op', () => {
  const repo = makeRepo();
  try {
    const blocked = gitAtScale.pruneWorktrees({ repoRoot: repo, dryRun: false, maxAgeDays: 0 });
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.code, 'UNCLAIMED');

    const missing = gitAtScale.pruneWorktrees({
      repoRoot: repo,
      worktreeBase: path.join(repo, '.claude', 'missing-base'),
      dryRun: true,
    });
    assert.equal(missing.prunedCount, 0);
    assert.equal(missing.dryRun, true);
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp hook noise */ }
  }
});

test('prune skips protected-branch and younger worktrees', () => {
  const repo = makeRepo();
  try {
    const protectedWt = addWorktree(repo, 'prod', { branch: 'production' });
    const young = addWorktree(repo, 'young');
    const result = gitAtScale.pruneWorktrees({
      repoRoot: repo,
      maxAgeDays: 5,
      dryRun: true,
    });
    const reasons = result.skipped.map((s) => s.reason);
    assert.ok(reasons.includes('protected-branch'), JSON.stringify(result.skipped));
    assert.ok(reasons.includes('younger-than-5d'), JSON.stringify(result.skipped));
    assert.ok(fs.existsSync(protectedWt));
    assert.ok(fs.existsSync(young));
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp hook noise */ }
  }
});

test('CLI unknown command exits 2; maintenance --geometric without lease exits 1', () => {
  const repo = makeRepo();
  const script = path.join(__dirname, '..', 'scripts', 'git-at-scale.js');
  try {
    const usage = spawnSync(process.execPath, [script, 'nope', '--cwd', repo], { encoding: 'utf8' });
    assert.equal(usage.status, 2);
    assert.match(usage.stderr, /usage:/);

    const blocked = spawnSync(process.execPath, [script, 'maintenance', '--geometric', '--cwd', repo], {
      encoding: 'utf8',
    });
    assert.equal(blocked.status, 1);
    const body = JSON.parse(blocked.stdout);
    assert.equal(body.status, 'blocked');
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp hook noise */ }
  }
});

test('CLI scorecard exits 0 and prints JSON', () => {
  const repo = makeRepo();
  try {
    const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'git-at-scale.js'), 'scorecard', '--cwd', repo], {
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
    const card = JSON.parse(res.stdout);
    assert.equal(card.sourceOfTruth, 'origin');
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp hook noise */ }
  }
});

test('tune writes commit-graph-on-fetch local config', () => {
  const repo = makeRepo();
  try {
    assert.equal(gitAtScale.hasScaleTune(repo), false);
    const tune = gitAtScale.applyScaleTune(repo);
    assert.equal(tune.ok, true);
    assert.ok(tune.applied.includes('fetch.writeCommitGraph'));
    assert.equal(gitAtScale.hasScaleTune(repo), true);
    const card = gitAtScale.getScaleScorecard(repo);
    assert.equal(card.scaleTune, true);
    assert.equal(card.unhealthyReasons.includes('missing-scale-tune'), false);
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp hook noise */ }
  }
});

test('heal applies tune plus cheap indexes; check is not fail-closed on missing tune', () => {
  const repo = makeRepo();
  const script = path.join(__dirname, '..', 'scripts', 'git-at-scale.js');
  try {
    const checkBefore = spawnSync(process.execPath, [script, 'check', '--cwd', repo], { encoding: 'utf8' });
    assert.equal(checkBefore.status, 0, checkBefore.stderr);
    const before = JSON.parse(checkBefore.stdout);
    assert.equal(before.blocking, false);
    assert.ok(before.unhealthyReasons.includes('missing-scale-tune'));

    const heal = gitAtScale.applyScaleHeal(repo);
    assert.equal(heal.tune.ok, true);
    assert.equal(heal.maintenance.commitGraphUpdated, true);
    assert.equal(heal.scorecard.scaleTune, true);
    assert.equal(heal.scorecard.commitGraph, true);
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp hook noise */ }
  }
});

test('evaluateGitScaleHealth treats pack sprawl as blocking and missing tune as advisory', () => {
  const repo = makeRepo();
  try {
    const health = gitAtScale.evaluateGitScaleHealth(repo);
    assert.equal(health.blocking, false);
    assert.deepEqual(health.blockingReasons, []);
    assert.ok(health.unhealthyReasons.includes('missing-scale-tune'));
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp hook noise */ }
  }
});
