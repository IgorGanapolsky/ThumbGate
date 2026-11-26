'use strict';

// AGENT-3667 (lead brief 25 Nov 2026, about 4:00 PM): measure, with no enforcement change, whether the Claude Code
// hook path denies (a) a `git commit` with a staged fake AWS key, (b) `rm -rf ~/`, (c) `rm -rf ./src`.
// The fake key is assembled at run time so this file holds no secret-shaped literal.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
const FAKE_KEY = ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('');

function world() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-commit-secret-')));
  const project = path.join(home, 'proj');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  cp.execFileSync('git', ['init', '-q'], { cwd: project });
  cp.execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: project });
  cp.execFileSync('git', ['config', 'user.name', 'test'], { cwd: project });
  const env = { ...process.env, HOME: home, USERPROFILE: home, THUMBGATE_FEEDBACK_DIR: path.join(project, '.thumbgate'), THUMBGATE_NO_RATE_LIMIT: '1', THUMBGATE_NO_TELEMETRY: '1' };
  for (const n of ['THUMBGATE_STRICT_ENFORCEMENT', 'THUMBGATE_GOVERNANCE_MODE', 'THUMBGATE_CLI', 'THUMBGATE_SHARED_TREE', 'THUMBGATE_CANARY']) delete env[n];
  return { home, project, env, done: () => fs.rmSync(home, { recursive: true, force: true }) };
}

function gate(w, command) {
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: w.project, session_id: 'commit-secret', hook_event_name: 'PreToolUse' });
  const res = cp.spawnSync(process.execPath, [CLI, 'gate-check'], { cwd: w.project, env: w.env, input, encoding: 'utf8', timeout: 90000 });
  const lines = String(res.stdout).trim().split('\n').filter(Boolean);
  let out = {};
  for (let i = lines.length - 1; i >= 0; i -= 1) { try { out = JSON.parse(lines[i]); break; } catch { /* next */ } }
  const h = out.hookSpecificOutput || {};
  return { decision: h.permissionDecision || 'none', reason: String(h.permissionDecisionReason || ''), extra: String(h.additionalContext || '') };
}

test('rm -rf ~/ is denied', () => {
  const w = world();
  try {
    const r = gate(w, 'rm -rf ~/');
    assert.equal(r.decision, 'deny', JSON.stringify(r));
    assert.match(r.reason, /\[GATE:rm-rf-home-or-root\]/);
  } finally { w.done(); }
});

test('rm -rf ./src (a project folder, not home or root) is not denied', () => {
  const w = world();
  try {
    const r = gate(w, 'rm -rf ./src');
    assert.notEqual(r.decision, 'deny', JSON.stringify(r));
  } finally { w.done(); }
});

function stage(w, rel, content) {
  fs.mkdirSync(path.dirname(path.join(w.project, rel)), { recursive: true });
  fs.writeFileSync(path.join(w.project, rel), content);
  cp.execFileSync('git', ['add', rel], { cwd: w.project });
}

test('git commit with a staged fake AWS key is denied by the secret guard, and the reason does not print the key', () => {
  const w = world();
  try {
    stage(w, 'src/config.js', `module.exports = { aws: '${FAKE_KEY}' };\n`);
    const r = gate(w, 'git commit -m "add config"');
    assert.equal(r.decision, 'deny', JSON.stringify(r));
    assert.match(r.reason, /AWS access key/);
    assert.match(r.reason, /src\/config\.js/);
    assert.ok(!r.reason.includes(FAKE_KEY), 'the key itself is never echoed');
  } finally { w.done(); }
});

test('git commit -am denies a key in a tracked file edited but not yet staged', () => {
  const w = world();
  try {
    stage(w, 'src/a.js', 'module.exports = 1;\n');
    cp.execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: w.project });
    fs.writeFileSync(path.join(w.project, 'src', 'a.js'), `module.exports = '${FAKE_KEY}';\n`);
    assert.equal(gate(w, 'git commit -am "tweak"').decision, 'deny');
    assert.notEqual(gate(w, 'git commit -m "tweak"').decision, 'deny', 'without -a nothing is staged, so nothing to block');
  } finally { w.done(); }
});

test('git commit of clean staged files, a removed key, --dry-run and a non-repo are not denied', () => {
  const w = world();
  try {
    stage(w, 'src/clean.js', 'module.exports = 42;\n');
    assert.notEqual(gate(w, 'git commit -m "clean"').decision, 'deny');
    cp.execFileSync('git', ['commit', '-q', '-m', 'clean'], { cwd: w.project });
    stage(w, 'src/old.js', `x = '${FAKE_KEY}'\n`);
    assert.notEqual(gate(w, 'git commit --dry-run').decision, 'deny', '--dry-run writes nothing');
    // Commit the key first so removing it is a real deletion in the cached diff (CodeRabbit review on #5258).
    cp.execFileSync('git', ['commit', '-q', '-m', 'old key'], { cwd: w.project });
    cp.execFileSync('git', ['rm', '-q', 'src/old.js'], { cwd: w.project });
    const cached = cp.execFileSync('git', ['diff', '--cached', '-U0'], { cwd: w.project, encoding: 'utf8' });
    assert.ok(cached.includes(`-x = '${FAKE_KEY}'`), 'the cached diff holds the deletion of the key line');
    assert.notEqual(gate(w, 'git commit -m "remove it"').decision, 'deny', 'a deletion adds no line');
  } finally { w.done(); }
});

test('git -C <dir> commit and cd <dir> && git commit scan <dir>, not the hook cwd (Codex review on #5258)', () => {
  const w = world();
  try {
    const other = path.join(w.home, 'other');
    fs.mkdirSync(other);
    cp.execFileSync('git', ['init', '-q'], { cwd: other });
    fs.writeFileSync(path.join(other, 'k.js'), `k = '${FAKE_KEY}'\n`);
    cp.execFileSync('git', ['add', 'k.js'], { cwd: other });
    assert.equal(gate(w, `git -C ${other} commit -m test`).decision, 'deny');
    assert.equal(gate(w, 'git -C ../other commit -m test').decision, 'deny', 'a relative -C resolves from the hook cwd');
    assert.equal(gate(w, `cd ${other} && git commit -m test`).decision, 'deny');
    assert.notEqual(gate(w, 'git commit -m test').decision, 'deny', 'the hook cwd itself has nothing staged');
  } finally { w.done(); }
});

test('git commit with explicit paths scans those paths as they are in the working tree (Codex review on #5258)', () => {
  const w = world();
  try {
    stage(w, 'config.txt', 'a = 1\n');
    stage(w, 'clean.txt', 'b = 1\n');
    cp.execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: w.project });
    fs.writeFileSync(path.join(w.project, 'config.txt'), `a = '${FAKE_KEY}'\n`);
    assert.equal(gate(w, 'git commit -m test -- config.txt').decision, 'deny', 'an unstaged key in a named path is committed');
    assert.equal(gate(w, 'git commit -m "x y" config.txt').decision, 'deny');
    cp.execFileSync('git', ['add', 'config.txt'], { cwd: w.project });
    fs.writeFileSync(path.join(w.project, 'clean.txt'), 'b = 2\n');
    assert.notEqual(gate(w, 'git commit -m test -- clean.txt').decision, 'deny', 'a path-only commit leaves the staged key out');
    assert.equal(gate(w, 'git commit -i -m test clean.txt').decision, 'deny', '--include also commits the whole index');
  } finally { w.done(); }
});

test('parseCommitFlags keeps option values out of the pathspecs', () => {
  const { parseCommitFlags } = require('../scripts/staged-secret-gate');
  assert.deepEqual(parseCommitFlags(' -am "fix it" ').pathspecs, []);
  assert.equal(parseCommitFlags(' -am "fix it" ').all, true);
  assert.deepEqual(parseCommitFlags(' -m msg --author "A <a@b.c>" -- x y').pathspecs, ['x', 'y']);
  assert.deepEqual(parseCommitFlags(' -F msg.txt src/a.js').pathspecs, ['src/a.js']);
  assert.deepEqual(parseCommitFlags(' --message=hi a.js').pathspecs, ['a.js']);
  assert.deepEqual(parseCommitFlags(' -m"fix config"').pathspecs, [], 'an attached quoted message is one argument');
  assert.equal(parseCommitFlags(' --pathspec-from-file=paths.txt').pathspecFromFile, 'paths.txt');
});

// CodeRabbit review on #5258: command shapes the first parser missed.
test('a staged key is denied after a newline, with leading spaces, with -m"..." and outside a closed subshell cd', () => {
  const w = world();
  try {
    stage(w, 'src/k.js', `k = '${FAKE_KEY}'\n`);
    assert.equal(gate(w, 'true\ngit commit -m test').decision, 'deny', 'a commit on its own line');
    assert.equal(gate(w, '   git commit -m test').decision, 'deny', 'leading whitespace');
    assert.equal(gate(w, 'git commit -m"fix config"').decision, 'deny', 'attached quoted message is not a pathspec');
    const other = path.join(w.home, 'other');
    fs.mkdirSync(other);
    cp.execFileSync('git', ['init', '-q'], { cwd: other });
    assert.equal(gate(w, '(cd ../other && true); git commit -m test').decision, 'deny', 'the subshell cd does not move the commit');
    assert.notEqual(gate(w, 'cd ../other && git commit -m test').decision, 'deny', 'a real cd still selects the other repo');
  } finally { w.done(); }
});

test('pathspec-from-file, -diff attributes and "+++" added lines do not hide a key', () => {
  const w = world();
  try {
    stage(w, 'config.txt', 'a = 1\n');
    stage(w, 'paths.txt', 'config.txt\n');
    cp.execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: w.project });
    fs.writeFileSync(path.join(w.project, 'config.txt'), `a = '${FAKE_KEY}'\n`);
    assert.equal(gate(w, 'git commit -m test --pathspec-from-file=paths.txt').decision, 'deny');
    cp.execFileSync('git', ['checkout', '-q', '--', 'config.txt'], { cwd: w.project });

    stage(w, '.gitattributes', 'secret.txt -diff\n');
    stage(w, 'secret.txt', `k = '${FAKE_KEY}'\n`);
    assert.equal(gate(w, 'git commit -m test').decision, 'deny', 'a -diff attribute does not turn the file into binary');
    cp.execFileSync('git', ['rm', '-q', '--cached', 'secret.txt'], { cwd: w.project });

    stage(w, 'src/c.js', `++counter; // ${FAKE_KEY}\n`);
    assert.equal(gate(w, 'git commit -m test').decision, 'deny', 'an added line starting with ++ is still scanned');
  } finally { w.done(); }
});

test('git add X && git commit in one command reads X from disk; a key only in the index stays out of a path commit', () => {
  const w = world();
  try {
    stage(w, 'clean.txt', 'b = 1\n');
    cp.execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: w.project });
    fs.writeFileSync(path.join(w.project, 'config.txt'), `a = '${FAKE_KEY}'\n`);
    assert.equal(gate(w, 'git add config.txt && git commit -m test').decision, 'deny', 'staged by the same command');
    assert.equal(gate(w, 'git add . && git commit -m test').decision, 'deny', 'git add . reads untracked files too');
    assert.notEqual(gate(w, 'git add clean.txt && git commit -m test').decision, 'deny', 'adding only a clean file');
    fs.rmSync(path.join(w.project, 'config.txt'));

    stage(w, 'clean.txt', `b = '${FAKE_KEY}'\n`);
    fs.writeFileSync(path.join(w.project, 'clean.txt'), 'b = 2\n');
    assert.notEqual(gate(w, 'git commit -m test -- clean.txt').decision, 'deny', 'the working tree no longer has the key');
    assert.equal(gate(w, 'git commit -m test').decision, 'deny', 'a plain commit takes the index, which has it');
  } finally { w.done(); }
});
