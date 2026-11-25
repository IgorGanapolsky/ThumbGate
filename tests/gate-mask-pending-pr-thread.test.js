'use strict';

// A pending PR-thread action from repo A used to apply in a cwd outside any git repo. The posture demoted it to warn
// and its early return hid the later hard-block gates (terraform destroy). Both hosts must still deny.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
const DESTROY = 'terraform destroy -auto-approve';

function world() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-gate-mask-')));
  const stateDir = path.join(home, 'state');
  const repoA = path.join(home, 'repoA');
  const nonRepo = path.join(home, 'plain');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(nonRepo, { recursive: true });
  fs.mkdirSync(repoA, { recursive: true });
  cp.execFileSync('git', ['init', '-q'], { cwd: repoA });
  fs.writeFileSync(path.join(stateDir, 'session-actions.json'), JSON.stringify({
    pr_thread_resolution_verified_after_commit: { timestamp: Date.now(), metadata: { repoRoot: repoA } },
  }));
  const env = { ...process.env, HOME: home, USERPROFILE: home, THUMBGATE_STATE_DIR: stateDir, THUMBGATE_FEEDBACK_DIR: path.join(home, 'fb'), THUMBGATE_NO_RATE_LIMIT: '1', THUMBGATE_NO_TELEMETRY: '1' };
  for (const n of ['THUMBGATE_STRICT_ENFORCEMENT', 'THUMBGATE_GOVERNANCE_MODE', 'THUMBGATE_CLI', 'THUMBGATE_SHARED_TREE', 'THUMBGATE_CANARY', 'XDG_STATE_HOME', 'CODEX_SANDBOX']) delete env[n];
  return { home, repoA, nonRepo, env, done: () => fs.rmSync(home, { recursive: true, force: true }) };
}

function claude(w, cwd, command) {
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd, session_id: 'gate-mask', hook_event_name: 'PreToolUse' });
  const res = cp.spawnSync(process.execPath, [CLI, 'gate-check'], { cwd, env: w.env, input, encoding: 'utf8', timeout: 90000 });
  const lines = String(res.stdout).trim().split('\n').filter(Boolean);
  let out = {};
  for (let i = lines.length - 1; i >= 0; i -= 1) { try { out = JSON.parse(lines[i]); break; } catch { /* next */ } }
  const h = out.hookSpecificOutput || {};
  return { decision: h.permissionDecision || 'none', text: `${h.permissionDecisionReason || ''} ${h.additionalContext || ''}` };
}

function cursor(w, cwd, command) {
  const res = cp.spawnSync(process.execPath, [CLI, 'cursor-gate'], { cwd, env: w.env, input: JSON.stringify({ command, cwd }), encoding: 'utf8', timeout: 90000 });
  let out = {};
  try { out = JSON.parse(String(res.stdout).trim().split('\n').filter(Boolean).pop()); } catch { /* none */ }
  return { permission: out.permission || 'none', text: `${out.agent_message || ''}`, status: res.status };
}

test('Claude gate-check: terraform destroy from a non-repo cwd is denied while another repo has a pending PR-thread action', () => {
  const w = world();
  try {
    const r = claude(w, w.nonRepo, DESTROY);
    assert.equal(r.decision, 'deny', JSON.stringify(r));
    assert.match(r.text, /terraform-destroy/);
  } finally { w.done(); }
});

test('Cursor cursor-gate: terraform destroy from a non-repo cwd is denied while another repo has a pending PR-thread action', () => {
  const w = world();
  try {
    const r = cursor(w, w.nonRepo, DESTROY);
    assert.equal(r.permission, 'deny', JSON.stringify(r));
    assert.equal(r.status, 2);
  } finally { w.done(); }
});

test('the pending PR-thread gate does not apply from a non-repo cwd (a harmless command is not flagged by it)', () => {
  const w = world();
  try {
    const r = claude(w, w.nonRepo, 'ls');
    assert.notEqual(r.decision, 'deny', JSON.stringify(r));
    assert.doesNotMatch(r.text, /pr-thread-resolution-verified-required/);
  } finally { w.done(); }
});

test('terraform destroy inside the tracked repo is still denied (the PR-thread gate still applies there)', () => {
  const w = world();
  try {
    const r = claude(w, w.repoA, DESTROY);
    assert.equal(r.decision, 'deny', JSON.stringify(r));
  } finally { w.done(); }
});
