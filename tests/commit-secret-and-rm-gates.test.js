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
    cp.execFileSync('git', ['rm', '-q', '-f', 'src/old.js'], { cwd: w.project });
    assert.notEqual(gate(w, 'git commit -m "remove it"').decision, 'deny', 'a deletion adds no line');
  } finally { w.done(); }
});
