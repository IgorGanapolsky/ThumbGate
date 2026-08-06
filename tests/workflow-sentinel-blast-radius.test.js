'use strict';

// The sentinel decides whether to block by counting how many files an action
// touches. If that count comes from the wrong tree, the gate blocks work it
// never measured — and its advice ("split the change") cannot help, because
// splitting does not alter a number that was never about the work at hand.
//
// Both bugs here were found on 2026-08-06 when a 4-file commit inside a git
// worktree was scored "9 files across 6 surfaces" and hard-blocked.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { collectAffectedFiles } = require('../scripts/workflow-sentinel');

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function makeRepo(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tg-sentinel-${label}-`));
  git(['init', '--quiet'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
  git(['add', 'seed.txt'], dir);
  git(['commit', '--quiet', '-m', 'seed'], dir);
  return dir;
}

test('a cd into another repo is measured in THAT repo, not the session repo', () => {
  const sessionRepo = makeRepo('session');
  const otherRepo = makeRepo('other');

  // The session repo is noisy — the normal state of any working tree.
  for (const name of ['noise-a.txt', 'noise-b.txt', 'noise-c.txt', 'noise-d.txt']) {
    fs.writeFileSync(path.join(sessionRepo, name), 'noise\n');
  }
  // The other repo has exactly one staged file.
  fs.writeFileSync(path.join(otherRepo, 'real.txt'), 'real\n');
  git(['add', 'real.txt'], otherRepo);

  const files = collectAffectedFiles(
    'Bash',
    { command: `cd ${otherRepo} && git commit -m "one file"` },
    sessionRepo,
  );

  assert.deepEqual(files, ['real.txt'], 'must report the staged file in the cd target');
  assert.equal(
    files.some((f) => f.startsWith('noise-')),
    false,
    'session-repo dirt must never be attributed to work done in another repo',
  );
});

test('git add with explicit pathspecs reports only those paths', () => {
  const repo = makeRepo('pathspec');
  for (const name of ['wanted.txt', 'unrelated-a.txt', 'unrelated-b.txt']) {
    fs.writeFileSync(path.join(repo, name), 'x\n');
  }

  const files = collectAffectedFiles('Bash', { command: 'git add wanted.txt' }, repo);

  assert.deepEqual(files, ['wanted.txt']);
});

test('git add -A and git add . still scan the whole tree', () => {
  // The narrowing above must not blind the sentinel to a genuine whole-tree
  // stage, which is the case it exists to catch.
  const repo = makeRepo('whole-tree');
  for (const name of ['a.txt', 'b.txt', 'c.txt']) {
    fs.writeFileSync(path.join(repo, name), 'x\n');
  }

  for (const command of ['git add -A', 'git add .']) {
    const files = collectAffectedFiles('Bash', { command }, repo);
    assert.equal(files.length, 3, `${command} must see all three untracked files`);
  }
});

test('a command with no cd is still measured in the session repo', () => {
  const repo = makeRepo('no-cd');
  fs.writeFileSync(path.join(repo, 'local.txt'), 'x\n');
  git(['add', 'local.txt'], repo);

  const files = collectAffectedFiles('Bash', { command: 'git commit -m "local"' }, repo);

  assert.deepEqual(files, ['local.txt']);
});

test('an unresolvable cd target falls back to the session repo rather than reporting nothing', () => {
  // Reporting zero files would read as "harmless" and silently disarm the gate.
  const repo = makeRepo('bad-cd');
  fs.writeFileSync(path.join(repo, 'local.txt'), 'x\n');
  git(['add', 'local.txt'], repo);

  const files = collectAffectedFiles(
    'Bash',
    { command: 'cd /nonexistent-path-xyz && git commit -m "x"' },
    repo,
  );

  assert.deepEqual(files, ['local.txt']);
});
