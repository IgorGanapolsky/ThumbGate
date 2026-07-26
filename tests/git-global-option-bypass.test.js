'use strict';

// Git accepts global options between `git` and the subcommand (`git -C <dir> push`,
// `git -c k=v clean`, `git --git-dir=<p> reset`). Every command-pattern gate is written
// against the plain `git <subcommand>` form, so inserting one option walked straight past
// force-push, git-reset-hard, git-clean-force and the local-only gates — and made
// extractAffectedFiles report nothing, silently disarming the task-scope and protected-file
// gates as well. Verified against unmodified origin/main before the fix.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  canonicalizeGitCommand,
  canonicalizeCommandPositions,
  extractAffectedFiles,
  evaluateGatesAsync,
} = require('../scripts/gates-engine.js');

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-bypass-'));
  const git = (args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  git(['init']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
  git(['add', 'seed.txt']);
  git(['commit', '-m', 'init']);
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), 'protected\n');
  fs.writeFileSync(path.join(repo, 'app.js'), 'code\n');
  return repo;
}

// ---------------------------------------------------------------------------
// canonicalizeGitCommand
// ---------------------------------------------------------------------------

test('canonicalization strips git global options', () => {
  const cases = [
    ['git -C /some/dir push --force', 'git push --force'],
    ['git -c core.pager=cat clean -fd', 'git clean -fd'],
    ['git --git-dir=/p/.git reset --hard', 'git reset --hard'],
    ['git --work-tree /w add .', 'git add .'],
    ['git --no-pager log', 'git log'],
    ['git -C /a -c k=v --no-pager reset --hard', 'git reset --hard'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(canonicalizeGitCommand(input), expected, input);
  }
});

test('canonicalization leaves plain commands untouched', () => {
  for (const command of ['git push --force', 'git add -p src/a.js', 'git commit -m "msg"', 'ls -la']) {
    assert.equal(canonicalizeGitCommand(command), command, command);
  }
});

test('canonicalization does not eat subcommand options', () => {
  // `-p` after a subcommand is `--patch`, not the global `--paginate`.
  assert.equal(canonicalizeGitCommand('git add -p src/a.js'), 'git add -p src/a.js');
  assert.equal(canonicalizeGitCommand('git log -p'), 'git log -p');
});

test('canonicalization terminates on stacked options', () => {
  const stacked = `git ${'-c k=v '.repeat(40)}reset --hard`;
  const started = Date.now();
  const out = canonicalizeGitCommand(stacked);
  assert.ok(Date.now() - started < 2000, 'canonicalization must not stall');
  assert.equal(typeof out, 'string');
});

test('canonicalization handles empty and non-string input', () => {
  assert.equal(canonicalizeGitCommand(''), '');
  assert.equal(canonicalizeGitCommand(null), '');
  assert.equal(canonicalizeGitCommand(undefined), '');
});

// ---------------------------------------------------------------------------
// Affected-file computation must survive the global-option form
// ---------------------------------------------------------------------------

test('git -C form reports affected files', () => {
  const repo = makeRepo();
  const plain = extractAffectedFiles('Bash', { command: 'git add .', cwd: repo });
  const evaded = extractAffectedFiles('Bash', { command: `git -C ${repo} add .`, cwd: repo });
  assert.ok(plain.files.length > 0, 'baseline sanity');
  assert.deepEqual(evaded.files.sort(), plain.files.sort(), 'global options must not empty the file list');
});

test('git -c form reports affected files', () => {
  const repo = makeRepo();
  const plain = extractAffectedFiles('Bash', { command: 'git add .', cwd: repo });
  const evaded = extractAffectedFiles('Bash', { command: 'git -c core.editor=vi add .', cwd: repo });
  assert.deepEqual(evaded.files.sort(), plain.files.sort());
});

test('pathspec scoping still applies through a global option', () => {
  const repo = makeRepo();
  const { files } = extractAffectedFiles('Bash', {
    command: `git -C ${repo} add -- app.js`,
    cwd: repo,
  });
  assert.deepEqual(files, ['app.js'], 'scoping must survive canonicalization');
});

// ---------------------------------------------------------------------------
// End-to-end: the catastrophic gates must not be evadable
// ---------------------------------------------------------------------------

const EVASIONS = [
  ['git push --force origin main', 'push --force'],
  ['git reset --hard HEAD~5', 'reset --hard'],
  ['git clean -fd', 'clean -fd'],
];

for (const [plain, label] of EVASIONS) {
  test(`${label} is denied in both plain and global-option form`, async () => {
    const repo = makeRepo();
    const evaded = plain.replace(/^git /, `git -C ${repo} `);

    const plainVerdict = await evaluateGatesAsync('Bash', { command: plain, cwd: repo });
    assert.ok(plainVerdict, `${plain} must match a gate`);
    assert.equal(plainVerdict.decision, 'deny', plain);

    const evadedVerdict = await evaluateGatesAsync('Bash', { command: evaded, cwd: repo });
    assert.ok(evadedVerdict, `${evaded} must match a gate — this was the bypass`);
    assert.equal(evadedVerdict.decision, 'deny', evaded);
  });
}

test('stacked global options do not evade', async () => {
  const repo = makeRepo();
  const verdict = await evaluateGatesAsync('Bash', {
    command: `git --git-dir=${repo}/.git -C ${repo} reset --hard HEAD`,
    cwd: repo,
  });
  assert.ok(verdict, 'stacked options must still match a gate');
  assert.equal(verdict.decision, 'deny');
});

// ---------------------------------------------------------------------------
// Command-position canonicalization
//
// The catastrophic patterns anchor as (?:^|[;&|]\s*) — start of string or right after
// ; & |. That anchor missed a command on a NEW LINE and every ordinary way a binary is
// invoked. All of the forms below matched NO gate on unmodified origin/main.
// ---------------------------------------------------------------------------

const POSITION_EVASIONS = [
  ['sudo', 'sudo git reset --hard HEAD~5'],
  ['env assignment prefix', 'GIT_DIR=/x/.git git reset --hard HEAD~5'],
  ['absolute binary path', '/usr/bin/git reset --hard HEAD~5'],
  ['relative binary path', './bin/git reset --hard HEAD~5'],
  ['command builtin', 'command git reset --hard HEAD~5'],
  ['quoted binary', '"git" reset --hard HEAD~5'],
  ['backslash-escaped binary', '\\git reset --hard HEAD~5'],
  ['newline separator', 'echo hi\ngit reset --hard HEAD~5'],
  ['stacked wrappers', 'sudo GIT_DIR=/x/.git /usr/bin/git reset --hard HEAD~5'],
  ['nohup + time', 'nohup time git clean -fd'],
];

for (const [label, command] of POSITION_EVASIONS) {
  test(`command-position evasion is blocked: ${label}`, async () => {
    const repo = makeRepo();
    const verdict = await evaluateGatesAsync('Bash', { command, cwd: repo });
    assert.ok(verdict, `${command} must match a gate`);
    assert.equal(verdict.decision, 'deny', command);
  });
}

// The same anchor guards rm-rf-home-or-root, the fourth catastrophic gate. Every form below
// matched NO gate on unmodified origin/main — including `sudo rm -rf /`.
const RM_EVASIONS = [
  ['sudo', 'sudo rm -rf ~'],
  ['sudo, root target', 'sudo rm -rf /'],
  ['absolute binary path', '/bin/rm -rf ~'],
  ['newline separator', 'echo hi\nrm -rf ~'],
  ['env wrapper', 'env FOO=1 rm -rf $HOME'],
];

for (const [label, command] of RM_EVASIONS) {
  test(`rm -rf evasion is blocked: ${label}`, async () => {
    const repo = makeRepo();
    const verdict = await evaluateGatesAsync('Bash', { command, cwd: repo });
    assert.ok(verdict, `${command} must match a gate`);
    assert.equal(verdict.decision, 'deny', command);
  });
}

test('plain rm -rf ~ still denies (baseline sanity)', async () => {
  const repo = makeRepo();
  const verdict = await evaluateGatesAsync('Bash', { command: 'rm -rf ~', cwd: repo });
  assert.ok(verdict);
  assert.equal(verdict.decision, 'deny');
});

// Guards the other direction: canonicalization must not start denying ordinary work.
const BENIGN = [
  'ls -la',
  'npm test',
  'git status',
  'git log --oneline -5',
  'git diff',
  'echo "git reset --hard is dangerous"',
  'grep -r "git clean -fd" docs/',
  'sudo ls /var/log',
  'time npm run build',
  'command -v node',
];

for (const command of BENIGN) {
  test(`benign command is not denied: ${command}`, async () => {
    const repo = makeRepo();
    const verdict = await evaluateGatesAsync('Bash', { command, cwd: repo });
    if (verdict) assert.notEqual(verdict.decision, 'deny', `${command} must not be denied`);
  });
}

test('a command merely mentioned inside a quoted string is not treated as executed', () => {
  const canonical = canonicalizeCommandPositions('echo "git reset --hard is dangerous"');
  assert.ok(!/(?:^|[;&|]\s*)git\s+reset\s+--hard/.test(canonical),
    `quoted mention must not reach command position: ${canonical}`);
});

test('command-position canonicalization terminates on stacked wrappers', () => {
  const stacked = `${'sudo '.repeat(50)}git reset --hard`;
  const started = Date.now();
  canonicalizeCommandPositions(stacked);
  assert.ok(Date.now() - started < 2000, 'canonicalization must not stall');
});

// KNOWN RESIDUAL, recorded deliberately. Resolving the binary through a subshell still
// evades: canonicalization is static, and `$(which git)` cannot be resolved without
// executing it. Documented so this is a known limit rather than a silent gap, and so
// closing it later is a deliberate change. Covering it properly needs a different
// mechanism than pattern matching (e.g. gating at exec time).
test('KNOWN GAP: subshell-resolved binary still evades', async () => {
  const repo = makeRepo();
  const verdict = await evaluateGatesAsync('Bash', {
    command: '$(which git) reset --hard HEAD~5',
    cwd: repo,
  });
  const denied = Boolean(verdict && verdict.decision === 'deny');
  assert.equal(denied, false,
    'If this now passes, the subshell gap was closed — update this test and the changeset.');
});

test('command-position canonicalization handles empty input', () => {
  assert.equal(canonicalizeCommandPositions(''), '');
  assert.equal(canonicalizeCommandPositions(null), '');
});

test('canonicalization does not manufacture matches for non-git commands', async () => {
  const repo = makeRepo();
  // A benign read-only command must stay unmatched by the git gates.
  const verdict = await evaluateGatesAsync('Bash', { command: 'echo git push --force', cwd: repo });
  if (verdict) {
    assert.notEqual(verdict.gate, 'git-reset-hard');
    assert.notEqual(verdict.gate, 'git-clean-force');
  }
});
