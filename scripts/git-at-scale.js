#!/usr/bin/env node
'use strict';

/**
 * Client-side Git scale hygiene (Cursor "Git at any scale" / Continuity).
 *
 * Steal the mechanic, not Origin hosting:
 *   1. Packfile sprawl → commit-graph + multi-pack-index (optional geometric repack)
 *   2. Agent worktrees as cattle under .claude/worktrees (clean prune only)
 *   3. Tip consistency vs origin (Git hates eventual views)
 *
 * Not a Git host. Not ThumbGate Continuity (VPS). Not net-new agent-governance IP.
 * Mutating commands honor scripts/session-lease.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const sessionLease = require('./session-lease');

const DEFAULT_AGENT_WORKTREE_BASE = '.claude/worktrees';
const PROTECTED_BRANCHES = new Set(['main', 'master', 'develop', 'production', 'gh-pages']);
const DEFAULT_MAX_AGE_DAYS = 5;
const PACK_UNHEALTHY = 40;
const LOOSE_UNHEALTHY = 500;
const WORKTREE_UNHEALTHY = 25;
const SCALE_TUNE = Object.freeze([
  ['fetch.writeCommitGraph', 'true'],
  ['gc.writeCommitGraph', 'true'],
  ['pack.writeReverseIndex', 'true'],
]);
const SAFE_GIT_PATH = '/usr/bin:/bin';
const GIT_BIN = ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'].find((candidate) => {
  try { return fs.existsSync(candidate); } catch { return false; }
}) || 'git';

function runGit(args, cwd = process.cwd(), opts = {}) {
  const env = { ...process.env, PATH: SAFE_GIT_PATH };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_COMMON_DIR;
  const res = spawnSync(GIT_BIN, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: opts.timeoutMs || 0,
    env,
  });
  return {
    status: res.status === null ? 1 : res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
    signal: res.signal || null,
  };
}

function getRepoRoot(cwd = process.cwd()) {
  const res = runGit(['rev-parse', '--show-toplevel'], cwd);
  if (res.status !== 0 || !res.stdout) {
    throw new Error(`Not a git repository: ${cwd}`);
  }
  return res.stdout;
}

function gitCommonDirAbs(repoRoot) {
  const res = runGit(['rev-parse', '--git-common-dir'], repoRoot);
  if (res.status !== 0 || !res.stdout) return path.join(repoRoot, '.git');
  return path.isAbsolute(res.stdout) ? res.stdout : path.join(repoRoot, res.stdout);
}

function parseCountObjects(repoRoot) {
  const common = gitCommonDirAbs(repoRoot);
  const res = runGit(['--git-dir', common, 'count-objects', '-v'], repoRoot);
  const out = {};
  if (res.status !== 0) return out;
  for (const line of res.stdout.split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    const num = Number(raw);
    out[key] = Number.isFinite(num) && String(num) === raw ? num : raw;
  }
  return out;
}

function hasCommitGraph(repoRoot) {
  const abs = gitCommonDirAbs(repoRoot);
  return (
    fs.existsSync(path.join(abs, 'objects', 'info', 'commit-graph'))
    || fs.existsSync(path.join(abs, 'objects', 'info', 'commit-graphs'))
  );
}

function hasMultiPackIndex(repoRoot) {
  const abs = gitCommonDirAbs(repoRoot);
  return (
    fs.existsSync(path.join(abs, 'objects', 'pack', 'multi-pack-index'))
    || fs.existsSync(path.join(abs, 'objects', 'info', 'multi-pack-index'))
  );
}

function hasPackBitmap(repoRoot) {
  const packDir = path.join(gitCommonDirAbs(repoRoot), 'objects', 'pack');
  try {
    if (fs.existsSync(path.join(packDir, 'multi-pack-index.bitmap'))) return true;
    return fs.readdirSync(packDir).some((name) => name.endsWith('.bitmap'));
  } catch {
    return false;
  }
}

function readLocalConfig(repoRoot, key) {
  const res = runGit(['config', '--local', '--get', key], repoRoot);
  return res.status === 0 ? res.stdout : '';
}

function hasScaleTune(repoRoot) {
  return SCALE_TUNE.every(([key, value]) => readLocalConfig(repoRoot, key) === value);
}

function applyScaleTune(repoRoot = getRepoRoot()) {
  const applied = [];
  const errors = [];
  for (const [key, value] of SCALE_TUNE) {
    const res = runGit(['config', '--local', key, value], repoRoot);
    if (res.status === 0) applied.push(key);
    else errors.push(`${key}: ${res.stderr || 'failed'}`);
  }
  return { ok: errors.length === 0, applied, errors };
}

function writeMultiPackIndex(repoRoot, results) {
  let midx = runGit(['multi-pack-index', 'write', '--bitmap'], repoRoot);
  if (midx.status !== 0) {
    midx = runGit(['multi-pack-index', 'write'], repoRoot);
  }
  results.multiPackIndexUpdated = midx.status === 0;
  results.packBitmapUpdated = hasPackBitmap(repoRoot);
  recordGitError(results, 'multi-pack-index', midx);
}

function primaryCheckout(repoRoot) {
  const common = gitCommonDirAbs(repoRoot);
  const candidate = path.basename(common) === '.git' ? path.dirname(common) : repoRoot;
  try {
    return fs.realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

function resolveAgentBase(repoRoot, override) {
  const raw = override || DEFAULT_AGENT_WORKTREE_BASE;
  return path.isAbsolute(raw) ? raw : path.join(primaryCheckout(repoRoot), raw);
}

function requireLiveLease(repoRoot) {
  const result = sessionLease.check(repoRoot);
  if (!result.ok) {
    return { ok: false, code: result.code || 'LEASED', message: result.message };
  }
  if (!result.held) {
    return {
      ok: false,
      code: 'UNCLAIMED',
      message: 'No session lease held. Claim the checkout before mutating git internals or pruning worktrees.',
    };
  }
  return { ok: true, lease: result.lease };
}

function recordGitError(results, label, res) {
  if (res.status === 0) return;
  const detail = res.stderr || res.signal || 'failed';
  if (detail) results.errors.push(`${label}: ${detail}`);
}

function runMaintenance(repoRoot = getRepoRoot(), options = {}) {
  // Cheap indexes do not mutate the working tree. Geometric repack is CPU-heavy
  // and must not race a foreign writer — require the checkout lease.
  if (options.geometric && !options.skipLease) {
    const lease = requireLiveLease(repoRoot);
    if (!lease.ok) {
      return { blocked: true, ...lease };
    }
  }

  const results = {
    commitGraphUpdated: false,
    multiPackIndexUpdated: false,
    packBitmapUpdated: false,
    geometricRepackDone: false,
    maintenanceAuto: false,
    errors: [],
  };

  const auto = runGit(['maintenance', 'run', '--auto'], repoRoot);
  results.maintenanceAuto = auto.status === 0;
  recordGitError(results, 'maintenance', auto);

  const graph = runGit(
    ['commit-graph', 'write', '--reachable', '--changed-paths'],
    repoRoot,
  );
  results.commitGraphUpdated = graph.status === 0;
  recordGitError(results, 'commit-graph', graph);

  writeMultiPackIndex(repoRoot, results);

  if (options.geometric) {
    const repack = runGit(['repack', '-d', '-l', '--geometric=2'], repoRoot, {
      timeoutMs: options.timeoutMs || 600000,
    });
    results.geometricRepackDone = repack.status === 0;
    recordGitError(results, 'geometric repack', repack);
    if (repack.status === 0) writeMultiPackIndex(repoRoot, results);
  }

  return results;
}

function listWorktrees(repoRoot = getRepoRoot()) {
  const res = runGit(['worktree', 'list', '--porcelain'], repoRoot);
  if (res.status !== 0) return [];
  const worktrees = [];
  let current = {};
  for (const line of res.stdout.split('\n')) {
    if (!line.trim()) {
      if (current.worktree) worktrees.push(current);
      current = {};
      continue;
    }
    if (line.startsWith('worktree ')) current.worktree = line.slice(9);
    else if (line.startsWith('HEAD ')) current.head = line.slice(5);
    else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).replace(/^refs\/heads\//, '');
    } else if (line === 'bare') current.bare = true;
    else if (line === 'detached') current.detached = true;
    else if (line === 'locked' || line.startsWith('locked ')) current.locked = true;
  }
  if (current.worktree) worktrees.push(current);
  return worktrees;
}

function isUnderBase(wtPath, basePath) {
  let realWt;
  let realBase;
  try {
    realWt = fs.existsSync(wtPath) ? fs.realpathSync(wtPath) : path.resolve(wtPath);
    realBase = fs.existsSync(basePath) ? fs.realpathSync(basePath) : path.resolve(basePath);
  } catch {
    return false;
  }
  return realWt === realBase || realWt.startsWith(realBase + path.sep);
}

function isPorcelainClean(wtPath) {
  const st = runGit(['status', '--porcelain'], wtPath);
  return st.status === 0 && st.stdout === '';
}

function isLiveLeaseOnPath(wtPath) {
  try {
    const result = sessionLease.check(wtPath);
    if (!result) return false;
    if (result.ok === false && result.code === 'LEASED') return true;
    if (result.held && result.ok && !result.stale) return true;
    return false;
  } catch {
    return false;
  }
}

function resolveWorktreePath(wtPath) {
  try {
    return fs.existsSync(wtPath) ? fs.realpathSync(wtPath) : path.resolve(wtPath);
  } catch {
    return null;
  }
}

function classifyPruneSkip(wt, ctx) {
  const realWt = resolveWorktreePath(wt.worktree);
  if (!realWt) return 'unreadable';
  if (realWt === ctx.primary || realWt === ctx.current) return 'primary';
  if (wt.locked) return 'locked';
  if (!isUnderBase(wt.worktree, ctx.worktreeBase)) return 'outside-agent-base';
  if (wt.branch && PROTECTED_BRANCHES.has(wt.branch)) return 'protected-branch';
  if (isLiveLeaseOnPath(wt.worktree)) return 'live-lease';
  if (!isPorcelainClean(wt.worktree)) return 'dirty';
  if (ctx.maxAgeMs == null) return null;
  try {
    const mtime = fs.statSync(wt.worktree).mtimeMs;
    if ((ctx.now - mtime) < ctx.maxAgeMs) return `younger-than-${ctx.maxAgeDays}d`;
  } catch {
    return 'mtime-unavailable';
  }
  return null;
}

function pruneWorktrees(options = {}) {
  const repoRoot = options.repoRoot || getRepoRoot();
  const worktreeBase = resolveAgentBase(repoRoot, options.worktreeBase);
  const maxAgeDays = options.maxAgeDays != null
    ? Number(options.maxAgeDays)
    : DEFAULT_MAX_AGE_DAYS;
  const dryRun = options.dryRun !== false;
  const pruned = [];
  const skipped = [];

  if (!dryRun) {
    const lease = requireLiveLease(repoRoot);
    if (!lease.ok) {
      return { blocked: true, ...lease, prunedCount: 0, prunedPaths: [], skipped, dryRun, worktreeBase };
    }
  }

  if (!fs.existsSync(worktreeBase)) {
    return { prunedCount: 0, prunedPaths: [], skipped, dryRun, worktreeBase };
  }

  const primary = fs.realpathSync(primaryCheckout(repoRoot));
  let current = repoRoot;
  try { current = fs.realpathSync(repoRoot); } catch { /* keep repoRoot */ }
  const now = Date.now();
  const maxAgeMs = Number.isFinite(maxAgeDays) ? maxAgeDays * 24 * 3600000 : null;
  const ctx = { primary, current, worktreeBase, now, maxAgeMs, maxAgeDays };

  for (const wt of listWorktrees(repoRoot)) {
    if (!wt.worktree) continue;
    const reason = classifyPruneSkip(wt, ctx);
    if (reason) {
      skipped.push({ path: wt.worktree, reason });
      continue;
    }
    if (dryRun) {
      pruned.push(wt.worktree);
      continue;
    }
    const rm = runGit(['worktree', 'remove', '--force', wt.worktree], repoRoot);
    if (rm.status === 0) pruned.push(wt.worktree);
    else skipped.push({ path: wt.worktree, reason: rm.stderr || 'remove-failed' });
  }

  if (!dryRun) runGit(['worktree', 'prune'], repoRoot);

  return {
    prunedCount: pruned.length,
    prunedPaths: pruned,
    skipped,
    dryRun,
    worktreeBase,
  };
}

function countRevs(fromSha, toSha, repoRoot) {
  const res = runGit(['rev-list', '--count', `${fromSha}..${toSha}`], repoRoot);
  if (res.status !== 0) return null;
  const n = Number(res.stdout);
  return Number.isFinite(n) ? n : null;
}

function checkTipConsistency(options = {}) {
  const repoRoot = options.repoRoot || getRepoRoot();
  const branch =
    options.branch
    || runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot).stdout
    || 'main';
  const remote = options.remote || 'origin';
  const doFetch = options.fetch === true;

  const before = runGit(['rev-parse', 'HEAD'], repoRoot).stdout;
  let fetch = { status: 0, stderr: '' };
  if (doFetch) {
    fetch = runGit(['fetch', remote, branch, '--quiet'], repoRoot, {
      timeoutMs: options.timeoutMs || 120000,
    });
    if (fetch.status !== 0) {
      return {
        branch,
        remote,
        localTip: before || null,
        remoteTip: null,
        fetched: false,
        fetchError: fetch.stderr || 'fetch failed',
        consistent: null,
        behind: null,
        ahead: null,
        indeterminate: true,
      };
    }
  }
  const remoteTip = runGit(['rev-parse', `${remote}/${branch}`], repoRoot);
  const after = runGit(['rev-parse', 'HEAD'], repoRoot).stdout;
  const localTip = after || before;
  if (remoteTip.status !== 0 || !remoteTip.stdout || !localTip) {
    return {
      branch,
      remote,
      localTip: localTip || null,
      remoteTip: null,
      fetched: doFetch && fetch.status === 0,
      fetchError: remoteTip.stderr || 'missing remote tip',
      consistent: null,
      behind: null,
      ahead: null,
      indeterminate: true,
    };
  }
  const behindCount = countRevs(localTip, remoteTip.stdout, repoRoot);
  const aheadCount = countRevs(remoteTip.stdout, localTip, repoRoot);
  const behind = behindCount != null ? behindCount > 0 : null;
  const ahead = aheadCount != null ? aheadCount > 0 : null;
  const consistent = behind === false && ahead === false;

  return {
    branch,
    remote,
    localTip,
    remoteTip: remoteTip.stdout,
    fetched: doFetch && fetch.status === 0,
    fetchError: null,
    consistent,
    behind,
    ahead,
    indeterminate: false,
  };
}

function getScaleScorecard(repoRoot = getRepoRoot()) {
  const objects = parseCountObjects(repoRoot);
  const worktrees = listWorktrees(repoRoot);
  const packs = Number(objects.packs) || 0;
  const loose = Number(objects.count) || 0;
  const commitGraph = hasCommitGraph(repoRoot);
  const midx = hasMultiPackIndex(repoRoot);
  const packBitmap = hasPackBitmap(repoRoot);
  const scaleTune = hasScaleTune(repoRoot);

  const unhealthyReasons = [];
  if (loose >= LOOSE_UNHEALTHY) unhealthyReasons.push('loose-objects>=500');
  if (packs >= PACK_UNHEALTHY) unhealthyReasons.push('packs>=40');
  if (!commitGraph) unhealthyReasons.push('missing-commit-graph');
  if (packs >= 2 && !midx) unhealthyReasons.push('missing-multi-pack-index');
  if (packs >= 2 && !packBitmap) unhealthyReasons.push('missing-pack-bitmap');
  if (!scaleTune) unhealthyReasons.push('missing-scale-tune');
  if (worktrees.length >= WORKTREE_UNHEALTHY) unhealthyReasons.push('worktrees>=25');
  const blockingReasons = unhealthyReasons.filter((reason) => (
    reason.startsWith('loose-objects') || reason.startsWith('packs>=')
  ));

  return {
    timestamp: new Date().toISOString(),
    repoRoot,
    looseObjects: loose,
    packfiles: packs,
    packedObjects: Number(objects['in-pack']) || 0,
    packedSizeKb: Number(objects['size-pack']) || 0,
    commitGraph,
    multiPackIndex: midx,
    packBitmap,
    scaleTune,
    activeWorktrees: worktrees.length,
    healthy: unhealthyReasons.length === 0,
    unhealthyReasons,
    blockingReasons,
    sourceOfTruth: 'origin',
    localRole: 'warm-cache',
  };
}

function evaluateGitScaleHealth(repoRoot = getRepoRoot()) {
  const card = getScaleScorecard(repoRoot);
  return {
    ...card,
    blocking: Array.isArray(card.blockingReasons) && card.blockingReasons.length > 0,
  };
}

function applyScaleHeal(repoRoot = getRepoRoot()) {
  const before = getScaleScorecard(repoRoot);
  const tune = applyScaleTune(repoRoot);
  const maintenance = runMaintenance(repoRoot, { geometric: false });
  return {
    applied: true,
    tune,
    maintenance,
    before,
    scorecard: getScaleScorecard(repoRoot),
  };
}

function flagValue(args, name) {
  const idx = args.indexOf(name);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'scorecard';
  const repoRoot = flagValue(argv, '--cwd')
    ? getRepoRoot(flagValue(argv, '--cwd'))
    : getRepoRoot();

  const emit = (obj, code = 0) => {
    process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
    return code;
  };

  if (command === 'scorecard' || command === '--scorecard' || command === '-s') {
    return emit(getScaleScorecard(repoRoot));
  }

  if (command === 'maintenance' || command === '--maintenance' || command === '-m') {
    const maintenance = runMaintenance(repoRoot, { geometric: argv.includes('--geometric') });
    const code = maintenance.blocked ? 1 : 0;
    return emit({
      status: maintenance.blocked ? 'blocked' : 'ok',
      maintenance,
      scorecard: maintenance.blocked ? null : getScaleScorecard(repoRoot),
    }, code);
  }

  if (command === 'prune-worktrees' || command === '--prune-worktrees') {
    const age = flagValue(argv, '--max-age-days');
    const result = pruneWorktrees({
      repoRoot,
      worktreeBase: flagValue(argv, '--base'),
      maxAgeDays: age != null ? Number(age) : DEFAULT_MAX_AGE_DAYS,
      dryRun: !argv.includes('--apply'),
    });
    return emit(result, result.blocked ? 1 : 0);
  }

  if (command === 'tip' || command === '--tip-consistency') {
    return emit(checkTipConsistency({
      repoRoot,
      branch: flagValue(argv, '--branch'),
      fetch: argv.includes('--fetch'),
    }));
  }

  if (command === 'tune' || command === '--tune') {
    return emit({
      status: 'ok',
      tune: applyScaleTune(repoRoot),
      scorecard: getScaleScorecard(repoRoot),
    });
  }

  if (command === 'check' || command === '--check') {
    const health = evaluateGitScaleHealth(repoRoot);
    return emit(health, health.blocking ? 1 : 0);
  }

  if (command === 'heal' || command === '--heal') {
    return emit({ status: 'ok', ...applyScaleHeal(repoRoot) });
  }

  process.stderr.write(
    'usage: node scripts/git-at-scale.js <scorecard|maintenance|prune-worktrees|tip|tune|check|heal> [flags]\n'
    + '  maintenance [--geometric]\n'
    + '  prune-worktrees [--base DIR] [--max-age-days N] [--apply]\n'
    + '  tip [--branch main] [--fetch]\n'
    + '  tune\n'
    + '  check\n'
    + '  heal\n'
  );
  return 2;
}

module.exports = {
  DEFAULT_AGENT_WORKTREE_BASE,
  DEFAULT_MAX_AGE_DAYS,
  GIT_BIN,
  PACK_UNHEALTHY,
  SAFE_GIT_PATH,
  SCALE_TUNE,
  applyScaleHeal,
  applyScaleTune,
  checkTipConsistency,
  evaluateGitScaleHealth,
  getRepoRoot,
  getScaleScorecard,
  gitCommonDirAbs,
  hasCommitGraph,
  hasPackBitmap,
  hasScaleTune,
  primaryCheckout,
  hasMultiPackIndex,
  listWorktrees,
  main,
  parseCountObjects,
  pruneWorktrees,
  requireLiveLease,
  resolveAgentBase,
  runGit,
  runMaintenance,
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  process.exit(main());
}
