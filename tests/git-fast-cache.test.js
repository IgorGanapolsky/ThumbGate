'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  GitFastCache,
  defaultCache,
  resolveGitBinary,
  FIXED_GIT_BIN_CANDIDATES,
} = require('../src/git-fast-cache.js');

const GIT_BIN = resolveGitBinary() || 'git';

function createTempGitRepo(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync(GIT_BIN, ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync(GIT_BIN, ['config', 'user.name', 'Test Agent'], { cwd: dir, stdio: 'ignore' });
  execFileSync(GIT_BIN, ['config', 'user.email', 'test@thumbgate.test'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

test('GitFastCache: resolveGitBinary returns an absolute executable path', () => {
  const bin = resolveGitBinary();
  assert.ok(bin, 'expected a resolved git binary on this host');
  assert.ok(bin.includes(path.sep), `expected absolute path, got ${bin}`);
  assert.ok(FIXED_GIT_BIN_CANDIDATES.some((c) => c === bin) || bin.startsWith('/'));
});

test('GitFastCache: resolves repository root accurately', () => {
  const repo = createTempGitRepo('fast-cache-repo-');
  const cache = new GitFastCache();

  const root = cache.findRepoRoot(repo);
  assert.equal(fs.realpathSync(root), fs.realpathSync(repo));

  const subDir = path.join(repo, 'src', 'components');
  fs.mkdirSync(subDir, { recursive: true });
  const subRoot = cache.findRepoRoot(subDir);
  assert.equal(fs.realpathSync(subRoot), fs.realpathSync(repo));
});

test('GitFastCache: retrieves repo state with sub-millisecond cached lookups', () => {
  const repo = createTempGitRepo('fast-cache-state-');
  fs.writeFileSync(path.join(repo, 'file.txt'), 'hello');
  execFileSync(GIT_BIN, ['add', 'file.txt'], { cwd: repo, stdio: 'ignore' });
  execFileSync(GIT_BIN, ['commit', '-m', 'initial'], { cwd: repo, stdio: 'ignore' });

  const cache = new GitFastCache();

  // First lookup (uncached)
  const state1 = cache.getRepoState(repo);
  assert.equal(state1.isGitRepo, true);
  assert.ok(state1.headSha);
  assert.equal(state1.cached, false);

  // Second lookup (cached)
  const state2 = cache.getRepoState(repo);
  assert.equal(state2.isGitRepo, true);
  assert.equal(state2.headSha, state1.headSha);
  assert.equal(state2.cached, true);
  assert.ok(state2.lookupTimeMs < 5); // sub-millisecond to low single digit
});

test('GitFastCache: detects dirty working tree changes and staged files', () => {
  const repo = createTempGitRepo('fast-cache-dirty-');
  fs.writeFileSync(path.join(repo, 'initial.txt'), 'init');
  execFileSync(GIT_BIN, ['add', 'initial.txt'], { cwd: repo, stdio: 'ignore' });
  execFileSync(GIT_BIN, ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });

  const cache = new GitFastCache();

  // Create new staged file
  fs.writeFileSync(path.join(repo, 'staged.txt'), 'staged content');
  execFileSync(GIT_BIN, ['add', 'staged.txt'], { cwd: repo, stdio: 'ignore' });

  const state = cache.getRepoState(repo);
  assert.equal(state.isDirty, true);
  assert.ok(state.stagedFiles.includes('staged.txt'));
});
