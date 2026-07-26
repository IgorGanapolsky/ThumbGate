'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { extractAffectedFiles, parseGitPathspec } = require('../scripts/gates-engine.js');

function git(repo, args) {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
}

// A repo with a large dirty tree, mirroring a checkout shared by several agents.
function makeDirtyRepo(noiseCount) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-pathspec-'));
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
  git(repo, ['add', 'seed.txt']);
  git(repo, ['commit', '-m', 'init']);

  for (let i = 0; i < noiseCount; i++) {
    fs.writeFileSync(path.join(repo, `noise${i}.txt`), `dirty${i}\n`);
  }
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'a\n');
  fs.writeFileSync(path.join(repo, 'src', 'b.js'), 'b\n');
  return repo;
}

test('git add with an explicit pathspec reports only the declared paths', () => {
  const repo = makeDirtyRepo(200);
  const { files } = extractAffectedFiles('Bash', {
    command: 'git add -- src/a.js src/b.js',
    cwd: repo,
  });
  assert.deepEqual(files.sort(), ['src/a.js', 'src/b.js']);
});

test('git add pathspec scope is unaffected by unrelated dirty files', () => {
  const small = extractAffectedFiles('Bash', {
    command: 'git add src/a.js',
    cwd: makeDirtyRepo(10),
  });
  const large = extractAffectedFiles('Bash', {
    command: 'git add src/a.js',
    cwd: makeDirtyRepo(500),
  });
  assert.deepEqual(small.files, ['src/a.js']);
  assert.deepEqual(large.files, ['src/a.js'], 'working-tree size must not change the declared scope');
});

test('git add with a directory pathspec reports files under that directory only', () => {
  const repo = makeDirtyRepo(50);
  const { files } = extractAffectedFiles('Bash', { command: 'git add src/', cwd: repo });
  assert.deepEqual(files.sort(), ['src/a.js', 'src/b.js']);
});

test('broad git add still reports the whole working tree', () => {
  const repo = makeDirtyRepo(20);
  for (const command of ['git add .', 'git add -A', 'git add -u']) {
    const { files } = extractAffectedFiles('Bash', { command, cwd: repo });
    assert.ok(files.length > 20, `${command} must keep full-tree scope (got ${files.length})`);
  }
});

test('compound commands only contribute the add pathspec', () => {
  const repo = makeDirtyRepo(30);
  const { files } = extractAffectedFiles('Bash', {
    command: 'git add src/a.js && echo done',
    cwd: repo,
  });
  assert.deepEqual(files, ['src/a.js']);
});

test('unresolvable pathspecs stay conservative', () => {
  for (const command of ['git add "$FILES"', 'git add src/*.js', 'git add -p src/a.js']) {
    assert.equal(parseGitPathspec(command, 'add').broad, true, `${command} must be treated as broad`);
  }
});

test('flag values and prefixes do not leak into the pathspec', () => {
  const repo = makeDirtyRepo(30);
  for (const command of [
    `cd ${repo} && git add src/a.js`,
    'git add --chmod=+x src/a.js',
    'git add "src/a.js"',
  ]) {
    const { files } = extractAffectedFiles('Bash', { command, cwd: repo });
    assert.deepEqual(files, ['src/a.js'], command);
  }
});

test('multiple explicit paths are all reported', () => {
  const repo = makeDirtyRepo(30);
  const { files } = extractAffectedFiles('Bash', {
    command: 'git add src/a.js noise0.txt',
    cwd: repo,
  });
  assert.deepEqual(files.sort(), ['noise0.txt', 'src/a.js']);
});

// This previously returned [] — global options between `git` and the subcommand defeated the
// detection regex, so the scope gates saw no files and raised no violation. Now canonicalized.
// Full bypass coverage lives in tests/git-global-option-bypass.test.js.
test('git -C form is detected and scoped', () => {
  const repo = makeDirtyRepo(10);
  const { files } = extractAffectedFiles('Bash', {
    command: `git -C ${repo} add src/a.js`,
    cwd: repo,
  });
  assert.deepEqual(files, ['src/a.js']);
});

// js/polynomial-redos: stripping trailing slashes with /\/+$/ backtracks polynomially on a
// long run of slashes. The pathspec comes straight off the pending command, so stalling the
// gate is itself a way to defeat it.
test('a pathological pathspec does not stall the gate', () => {
  const repo = makeDirtyRepo(5);
  const evil = `a${'/'.repeat(200000)}x`;
  const started = Date.now();
  extractAffectedFiles('Bash', { command: `git add -- ${evil}`, cwd: repo });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5000, `pathspec scoping took ${elapsed}ms — expected linear-time handling`);
});

test('trailing slashes are stripped from directory pathspecs', () => {
  const repo = makeDirtyRepo(20);
  const { files } = extractAffectedFiles('Bash', { command: 'git add src///', cwd: repo });
  assert.deepEqual(files.sort(), ['src/a.js', 'src/b.js']);
});

test('quoted paths with spaces are parsed as a single pathspec', () => {
  const parsed = parseGitPathspec('git add -- "my dir/file.js"', 'add');
  assert.equal(parsed.broad, false);
  assert.deepEqual(parsed.paths, ['my dir/file.js']);
});

test('git commit narrows to an explicit pathspec after --', () => {
  const repo = makeDirtyRepo(40);
  git(repo, ['add', 'src/a.js', 'src/b.js']);
  const scoped = extractAffectedFiles('Bash', {
    command: 'git commit -m "msg" -- src/a.js',
    cwd: repo,
  });
  assert.deepEqual(scoped.files, ['src/a.js']);

  // Without a pathspec the staged set still defines the scope.
  const staged = extractAffectedFiles('Bash', { command: 'git commit -m "msg"', cwd: repo });
  assert.deepEqual(staged.files.sort(), ['src/a.js', 'src/b.js']);
});

test('a commit message containing a path is not treated as a pathspec', () => {
  const repo = makeDirtyRepo(10);
  git(repo, ['add', 'src/a.js']);
  const { files } = extractAffectedFiles('Bash', {
    command: 'git commit -m "refactor src/b.js handling"',
    cwd: repo,
  });
  assert.deepEqual(files, ['src/a.js']);
});
