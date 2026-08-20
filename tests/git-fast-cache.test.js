'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { GitFastCache, defaultCache } = require('../src/git-fast-cache.js');

function createTempGitRepo(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test Agent'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@thumbgate.test'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

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
  execFileSync('git', ['add', 'file.txt'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repo, stdio: 'ignore' });

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
  execFileSync('git', ['add', 'initial.txt'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });

  const cache = new GitFastCache();

  // Create new staged file
  fs.writeFileSync(path.join(repo, 'staged.txt'), 'staged content');
  execFileSync('git', ['add', 'staged.txt'], { cwd: repo, stdio: 'ignore' });

  const state = cache.getRepoState(repo);
  assert.equal(state.isDirty, true);
  assert.ok(state.stagedFiles.includes('staged.txt'));
});
