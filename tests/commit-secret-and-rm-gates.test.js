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

test('git commit with a staged fake AWS key is NOT denied: it only gets the task-scope warning', () => {
  const w = world();
  try {
    fs.writeFileSync(path.join(w.project, 'src', 'config.js'), `module.exports = { aws: '${FAKE_KEY}' };\n`);
    cp.execFileSync('git', ['add', 'src/config.js'], { cwd: w.project });
    const staged = cp.execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: w.project, encoding: 'utf8' }).trim();
    assert.equal(staged, 'src/config.js', 'the fake secret is staged');
    const r = gate(w, 'git commit -m "add config"');
    // Measured 25 Nov 2026, default mode: the commit is NOT denied. The only flag is the task-scope warning, and no gate
    // looks at the staged content. If someone adds a staged-secret gate this test fails, and its title should change.
    assert.notEqual(r.decision, 'deny', JSON.stringify(r));
    assert.match(r.extra, /\[GATE:task-scope-required\] WARNING/);
    assert.doesNotMatch(`${r.reason} ${r.extra}`, /secret|credential|AWS/i, 'no gate names the staged secret');
  } finally { w.done(); }
});
