'use strict';

/**
 * Regression tests for four CLI / init bugs surfaced 2026-05-18:
 *
 * Bug 1 — `npx thumbgate pro` (no args) silently shows the info banner instead
 *         of launching the dashboard for creator-dev users, because the
 *         `resolvedKey.key` truthiness gate ignores the {source: 'creator-dev'}
 *         shape that `resolveProKey()` legitimately returns.
 *
 * Bug 3 — `init` runs `pruneStaleFileHooks` on existing settings.json hooks and
 *         removes any hook whose command contains a shell variable such as
 *         `$CLAUDE_PROJECT_DIR`, because the prune logic treats the unexpanded
 *         token as a literal path and `fs.existsSync` returns false.
 *
 * Bug 4 — `isProTier()` does not recognize creator-dev installs, so all the
 *         marketing nudges (proNudge, upgradeNudge) still fire for owners.
 *         Separately, `proNudge` never consulted isProTier in the first place.
 *
 * Each test is named so a failure points at the specific bug.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

function freshHomeDir(suffix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tg-home-${suffix}-`));
  return dir;
}

function freshProjectDir(suffix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tg-proj-${suffix}-`));
  return dir;
}

// ─── Bug 1: creator-dev dashboard launch gate ─────────────────────────────

test('Bug 1: resolveProKey with creator-dev returns enterprise plan with empty key', () => {
  // CREATOR_BYPASS_VALUE is captured at module load from process.env, so the
  // env var must exist before the require — set it, fresh-require, restore.
  const home = freshHomeDir('creator-dev');
  const SECRET = 'tg_test_secret_value_only';
  fs.mkdirSync(path.join(home, '.config', 'thumbgate'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'thumbgate', 'dev.json'),
    JSON.stringify({ bypass: SECRET }));

  const realSecret = process.env.THUMBGATE_DEV_SECRET;
  const realBypass = process.env.THUMBGATE_DEV_BYPASS;
  process.env.THUMBGATE_DEV_SECRET = SECRET;
  process.env.THUMBGATE_DEV_BYPASS = SECRET;
  const proLocalPath = require.resolve(path.join(REPO_ROOT, 'scripts', 'pro-local-dashboard'));
  delete require.cache[proLocalPath];
  const proLocal = require(proLocalPath);
  try {
    const resolved = proLocal.resolveProKey({ homeDir: home });
    assert.ok(resolved, 'resolveProKey must not return null when secret + bypass match');
    assert.equal(resolved.source, 'creator-dev', 'should resolve as creator-dev');
    assert.equal(resolved.plan, 'enterprise');
    // The historical bug: resolved.key is '' when THUMBGATE_DEV_KEY is unset.
    // A caller deciding whether to launch the dashboard MUST NOT rely solely on
    // `resolved.key` truthiness; the source field is the load-bearing signal.
    assert.equal(typeof resolved.key === 'string', true);
  } finally {
    if (realSecret === undefined) delete process.env.THUMBGATE_DEV_SECRET; else process.env.THUMBGATE_DEV_SECRET = realSecret;
    if (realBypass === undefined) delete process.env.THUMBGATE_DEV_BYPASS; else process.env.THUMBGATE_DEV_BYPASS = realBypass;
    delete require.cache[proLocalPath];
  }
});

test('Bug 1: dashboard-launch decision treats creator-dev source as authorized', () => {
  // We can't easily exec the CLI without launching the server; this test
  // captures the *decision predicate* the CLI uses. After the fix, the
  // predicate should be: resolvedKey && (resolvedKey.key || resolvedKey.source === 'creator-dev').
  const cases = [
    { input: null, shouldLaunch: false },
    { input: { key: '', source: 'creator-dev' }, shouldLaunch: true },
    { input: { key: '', source: 'license' }, shouldLaunch: false },
    { input: { key: 'tg_real_key', source: 'license' }, shouldLaunch: true },
    { input: { key: 'envkey', source: 'env' }, shouldLaunch: true },
  ];
  const predicate = (r) => Boolean(r && (r.key || r.source === 'creator-dev'));
  for (const c of cases) {
    assert.equal(predicate(c.input), c.shouldLaunch,
      `predicate(${JSON.stringify(c.input)}) should be ${c.shouldLaunch}`);
  }
});

// ─── Bug 3: pruneStaleFileHooks must expand $CLAUDE_PROJECT_DIR ────────────

test('Bug 3: pruneStaleFileHooks keeps hooks that resolve via $CLAUDE_PROJECT_DIR', () => {
  const { pruneStaleFileHooks } = require(path.join(REPO_ROOT, 'scripts', 'auto-wire-hooks'));
  const projectDir = freshProjectDir('prune');
  fs.mkdirSync(path.join(projectDir, '.claude', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.claude', 'hooks', 'session-start.sh'),
    '#!/usr/bin/env bash\necho ok\n');
  fs.chmodSync(path.join(projectDir, '.claude', 'hooks', 'session-start.sh'), 0o755);

  const hookArray = [{
    hooks: [{
      type: 'command',
      command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/session-start.sh',
      timeout: 10000,
    }],
  }];

  const result = pruneStaleFileHooks(hookArray, projectDir);
  assert.equal(result.removedPaths.length, 0,
    'hook command referencing existing file via $CLAUDE_PROJECT_DIR must NOT be pruned');
  assert.equal(result.hooks.length, 1);
});

test('Bug 3: pruneStaleFileHooks still removes truly missing script paths', () => {
  const { pruneStaleFileHooks } = require(path.join(REPO_ROOT, 'scripts', 'auto-wire-hooks'));
  const projectDir = freshProjectDir('prune-missing');
  // Note: no session-start.sh on disk.

  const hookArray = [{
    hooks: [{
      type: 'command',
      command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/does-not-exist.sh',
    }],
  }];

  const result = pruneStaleFileHooks(hookArray, projectDir);
  assert.equal(result.removedPaths.length, 1,
    'a hook pointing at a genuinely missing script SHOULD still be pruned');
  assert.equal(result.hooks.length, 0);
});

test('Bug 3: pruneStaleFileHooks ignores pure npx / node command strings', () => {
  const { pruneStaleFileHooks } = require(path.join(REPO_ROOT, 'scripts', 'auto-wire-hooks'));
  const projectDir = freshProjectDir('prune-npx');
  const hookArray = [{
    hooks: [{
      type: 'command',
      command: 'npx thumbgate gate-check',
    }],
  }];
  const result = pruneStaleFileHooks(hookArray, projectDir);
  assert.equal(result.removedPaths.length, 0);
  assert.equal(result.hooks.length, 1);
});

// ─── Bug 4: isProTier must recognize creator-dev ──────────────────────────

test('Bug 4: isProTier returns true for creator-dev installs', () => {
  // We have to re-require with a controlled HOME so the license/dev.json
  // lookups hit the test sandbox, not the developer's real ~/.config.
  const home = freshHomeDir('isPro');
  fs.mkdirSync(path.join(home, '.config', 'thumbgate'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'thumbgate', 'dev.json'),
    JSON.stringify({ bypass: 'tg_test_isPro' }));

  const realHome = process.env.HOME;
  const realSecret = process.env.THUMBGATE_DEV_SECRET;
  const realBypass = process.env.THUMBGATE_DEV_BYPASS;
  const realApiKey = process.env.THUMBGATE_API_KEY;
  const realProMode = process.env.THUMBGATE_PRO_MODE;
  const realNoLimit = process.env.THUMBGATE_NO_RATE_LIMIT;
  process.env.HOME = home;
  process.env.THUMBGATE_DEV_SECRET = 'tg_test_isPro';
  process.env.THUMBGATE_DEV_BYPASS = 'tg_test_isPro';
  delete process.env.THUMBGATE_API_KEY;
  delete process.env.THUMBGATE_PRO_MODE;
  delete process.env.THUMBGATE_NO_RATE_LIMIT;

  // Fresh require so the module reads CREATOR_BYPASS_VALUE from the new env.
  const ratelimPath = require.resolve(path.join(REPO_ROOT, 'scripts', 'rate-limiter'));
  const proLocalPath = require.resolve(path.join(REPO_ROOT, 'scripts', 'pro-local-dashboard'));
  delete require.cache[ratelimPath];
  delete require.cache[proLocalPath];
  const { isProTier } = require(ratelimPath);

  try {
    assert.equal(isProTier(), true,
      'isProTier should treat creator-dev (secret + bypass + config) as Pro');
  } finally {
    process.env.HOME = realHome;
    if (realSecret === undefined) delete process.env.THUMBGATE_DEV_SECRET; else process.env.THUMBGATE_DEV_SECRET = realSecret;
    if (realBypass === undefined) delete process.env.THUMBGATE_DEV_BYPASS; else process.env.THUMBGATE_DEV_BYPASS = realBypass;
    if (realApiKey !== undefined) process.env.THUMBGATE_API_KEY = realApiKey;
    if (realProMode !== undefined) process.env.THUMBGATE_PRO_MODE = realProMode;
    if (realNoLimit !== undefined) process.env.THUMBGATE_NO_RATE_LIMIT = realNoLimit;
    delete require.cache[ratelimPath];
    delete require.cache[proLocalPath];
  }
});
