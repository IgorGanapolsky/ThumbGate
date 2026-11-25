'use strict';

// AGENT-3667 item Q: every gate decision is one JSON Lines row an auditor can use. A deny carries the session id,
// the host, the gate id and the gate catalog hash; a read or search that only mentions a dangerous word still logs
// "allow"; the export prints one row per decision with the verdict spelled the way an auditor reads it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { exportAuditLines } = require('../scripts/audit-trail');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const CURSOR_SCRIPT = path.join(ROOT, 'plugins', 'cursor-marketplace', 'scripts', 'gate-check.sh');

function world() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-audit-line-')));
  const project = path.join(home, 'proj');
  fs.mkdirSync(project);
  cp.execFileSync('git', ['init', '-q'], { cwd: project });
  const feedback = path.join(project, '.thumbgate');
  const env = { ...process.env, HOME: home, USERPROFILE: home, THUMBGATE_FEEDBACK_DIR: feedback, THUMBGATE_NO_RATE_LIMIT: '1', THUMBGATE_NO_TELEMETRY: '1', PWD: project };
  for (const n of ['THUMBGATE_STRICT_ENFORCEMENT', 'THUMBGATE_GOVERNANCE_MODE', 'THUMBGATE_CLI', 'THUMBGATE_HOST', 'THUMBGATE_SESSION_ID', 'CLAUDE_SESSION_ID', 'THUMBGATE_SESSION_AGENT', 'THUMBGATE_SANDBOX_EVAL']) delete env[n];
  return { home, project, env, log: path.join(feedback, 'audit-trail.jsonl'), done: () => fs.rmSync(home, { recursive: true, force: true }) };
}

function claude(w, toolName, toolInput, sessionId) {
  const input = JSON.stringify({ tool_name: toolName, tool_input: toolInput, cwd: w.project, session_id: sessionId, permission_mode: 'default', hook_event_name: 'PreToolUse' });
  return cp.spawnSync(process.execPath, [CLI, 'gate-check'], { cwd: w.project, env: w.env, input, encoding: 'utf8', timeout: 90000 });
}

function cursor(w, command, conversationId) {
  const input = JSON.stringify({ command, cwd: w.project, conversation_id: conversationId, hook_event_name: 'beforeShellExecution' });
  return cp.spawnSync('bash', [CURSOR_SCRIPT], { cwd: w.project, env: { ...w.env, THUMBGATE_CLI: `${process.execPath} ${CLI}` }, input, encoding: 'utf8', timeout: 90000 });
}

function rows(w) {
  if (!fs.existsSync(w.log)) return [];
  return fs.readFileSync(w.log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('REQ-01 (b): a deny through the Claude Code hook path logs session id, host, gate id, reason and catalog hash', () => {
  const w = world();
  try {
    claude(w, 'Bash', { command: 'terraform destroy -auto-approve' }, 'sess-claude-1');
    const deny = rows(w).find((r) => r.decision === 'deny');
    assert.ok(deny, `no deny row in ${JSON.stringify(rows(w))}`);
    assert.equal(deny.gateId, 'terraform-destroy');
    assert.equal(deny.toolName, 'Bash');
    assert.equal(deny.toolInput.command, 'terraform destroy -auto-approve');
    assert.equal(deny.sessionId, 'sess-claude-1');
    assert.equal(deny.host, 'claude-code');
    assert.match(deny.catalogHash, /^[0-9a-f]{12}$/);
    assert.ok(deny.message && deny.message.length > 5, 'reason text');
    assert.ok(!Number.isNaN(Date.parse(deny.timestamp)), 'ISO timestamp');
  } finally {
    w.done();
  }
});

test('REQ-02 (b): a deny through the Cursor hook path logs host "cursor" and the conversation id as the session', () => {
  const w = world();
  try {
    cursor(w, 'kubectl delete namespace prod', 'conv-cursor-1');
    const deny = rows(w).find((r) => r.decision === 'deny');
    assert.ok(deny, `no deny row in ${JSON.stringify(rows(w))}`);
    assert.equal(deny.gateId, 'kubectl-bulk-delete');
    assert.equal(deny.host, 'cursor');
    assert.equal(deny.sessionId, 'conv-cursor-1');
    assert.match(deny.catalogHash, /^[0-9a-f]{12}$/);
  } finally {
    w.done();
  }
});

test('REQ-03: a secret typed into a command is redacted in the logged row', () => {
  const w = world();
  try {
    const fakeKey = ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join('');
    claude(w, 'Bash', { command: `echo ${fakeKey} && terraform destroy -auto-approve` }, 'sess-claude-2');
    const text = fs.existsSync(w.log) ? fs.readFileSync(w.log, 'utf8') : '';
    assert.ok(text.length > 0, 'a row was written');
    assert.ok(!text.includes(fakeKey), 'the key is not in the audit file');
  } finally {
    w.done();
  }
});

test('REQ-04 (c): a read or a search that only mentions a dangerous word logs allow', () => {
  const w = world();
  try {
    const calls = [
      ['Bash', { command: 'grep -rn "terraform destroy" docs/' }],
      ['Bash', { command: 'sed -n 1,5p notes-about-git-reset-hard.md' }],
      ['Grep', { pattern: 'git push --force', path: '.' }],
      ['Read', { file_path: path.join(w.project, 'docs', 'rm-rf-lessons.md') }],
    ];
    for (const [name, input] of calls) claude(w, name, input, 'sess-claude-3');
    const logged = rows(w);
    assert.ok(logged.length >= calls.length, `rows: ${logged.length}`);
    for (const r of logged) assert.equal(r.decision, 'allow', `${r.toolName} ${JSON.stringify(r.toolInput)} -> ${r.decision} ${r.gateId}`);
  } finally {
    w.done();
  }
});

test('REQ-05: the export prints one JSON row per decision, shows approve as "ask", and filters by verdict', () => {
  const entries = [
    { timestamp: '2026-11-25T10:00:00.000Z', toolName: 'Bash', decision: 'allow', gateId: null },
    { timestamp: '2026-11-25T10:01:00.000Z', toolName: 'Bash', decision: 'deny', gateId: 'force-push', message: 'blocked' },
    { timestamp: '2026-11-25T10:02:00.000Z', toolName: 'Bash', decision: 'approve', gateId: 'production-deploy-approval', message: 'needs approval' },
  ];
  const all = exportAuditLines(entries).map((l) => JSON.parse(l));
  assert.deepEqual(all.map((r) => r.verdict), ['allow', 'deny', 'ask']);
  assert.equal(all[1].reason, 'blocked');
  assert.deepEqual(exportAuditLines(entries, { verdict: 'ask' }).map((l) => JSON.parse(l).gateId), ['production-deploy-approval']);
  assert.equal(exportAuditLines(entries, { since: '2026-11-25T10:01:30.000Z' }).length, 1);
  assert.equal(exportAuditLines(entries, { limit: 2 }).length, 2);
});

test('REQ-06: the export command prints the rows written by a real deny', () => {
  const w = world();
  try {
    claude(w, 'Bash', { command: 'git push --force origin main' }, 'sess-claude-4');
    const out = cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'audit-trail.js'), '--export', '--verdict', 'deny'], { cwd: w.project, env: w.env, encoding: 'utf8' });
    const lines = out.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(lines.length >= 1, out.stdout + out.stderr);
    assert.equal(lines[0].verdict, 'deny');
    assert.equal(lines[0].sessionId, 'sess-claude-4');
  } finally {
    w.done();
  }
});
