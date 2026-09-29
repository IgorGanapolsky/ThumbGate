const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-bgov-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const gov = require('../scripts/background-agent-governance');

test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// === Run Tracking ===
test('recordAgentRun creates run with ID', () => {
  const r = gov.recordAgentRun({ agentId: 'agent-1', runType: 'pr', branch: 'feat/x', status: 'started' });
  assert.ok(r.id.startsWith('run_'));
  assert.equal(r.agentId, 'agent-1');
  assert.equal(r.status, 'started');
});

test('recordAgentRun persists to disk', () => {
  gov.recordAgentRun({ agentId: 'agent-2', status: 'completed' });
  const raw = fs.readFileSync(gov.getRunsPath(), 'utf-8');
  assert.ok(raw.includes('agent-2'));
});

test('recordAgentRun defaults', () => {
  const r = gov.recordAgentRun({});
  assert.equal(r.agentId, 'unknown');
  assert.equal(r.status, 'started');
});

// === Governance Gate ===
test('checkRunGovernance allows clean agent', () => {
  const r = gov.checkRunGovernance({ agentId: 'clean-agent', runType: 'pr' });
  assert.equal(r.allowed, true);
  assert.equal(r.blockers.length, 0);
});

test('checkRunGovernance blocks high-failure agent', () => {
  for (let i = 0; i < 6; i++) gov.recordAgentRun({ agentId: 'bad-agent', status: 'failed' });
  for (let i = 0; i < 2; i++) gov.recordAgentRun({ agentId: 'bad-agent', status: 'completed' });
  const r = gov.checkRunGovernance({ agentId: 'bad-agent' });
  assert.equal(r.allowed, false);
  assert.ok(r.blockers.some((b) => b.rule === 'high_failure_rate'));
});

test('checkRunGovernance warns on protected branch', () => {
  const r = gov.checkRunGovernance({ agentId: 'any', branch: 'main' });
  assert.ok(r.warnings.some((w) => w.rule === 'protected_branch'));
});

test('checkRunGovernance warns on large blast radius', () => {
  const r = gov.checkRunGovernance({ agentId: 'any', filesChanged: 50 });
  assert.ok(r.warnings.some((w) => w.rule === 'large_blast_radius'));
});

test('checkRunGovernance warns on repeated gate blocks', () => {
  for (let i = 0; i < 4; i++) gov.recordAgentRun({ agentId: 'gated-agent', status: 'completed', gatesBlocked: 2 });
  const r = gov.checkRunGovernance({ agentId: 'gated-agent' });
  assert.ok(r.warnings.some((w) => w.rule === 'repeated_gate_blocks'));
});

test('checkRunGovernance returns governance score', () => {
  const clean = gov.checkRunGovernance({ agentId: 'new-agent' });
  assert.equal(clean.governanceScore, 100);
  const blocked = gov.checkRunGovernance({ agentId: 'bad-agent' });
  assert.ok(blocked.governanceScore < 100);
});

// === Post-Run Audit ===
test('auditCompletedRun records successful run', () => {
  const r = gov.auditCompletedRun({ agentId: 'builder-1', ciPassed: true, prNumber: 42, branch: 'feat/x', filesChanged: 5 });
  assert.equal(r.signal, 'positive');
  assert.ok(r.context.includes('successfully'));
  assert.ok(r.run.id);
});

test('auditCompletedRun records failed run', () => {
  const r = gov.auditCompletedRun({ agentId: 'builder-2', ciPassed: false, prNumber: 43, ciOutput: 'TypeError: x is not a function' });
  assert.equal(r.signal, 'negative');
  assert.ok(r.context.includes('failed'));
});

test('auditCompletedRun handles missing fields', () => {
  const r = gov.auditCompletedRun({});
  assert.ok(r.run.id);
  assert.equal(r.signal, 'negative');
});

// === Governance Report ===
test('generateGovernanceReport computes metrics', () => {
  const report = gov.generateGovernanceReport({ periodHours: 24 });
  assert.ok(report.total >= 5);
  assert.ok(typeof report.passRate === 'number');
  assert.ok(report.agents.length >= 1);
  assert.ok(report.generatedAt);
});

test('generateGovernanceReport includes per-agent breakdown', () => {
  const report = gov.generateGovernanceReport({ periodHours: 24 });
  const badAgent = report.agents.find((a) => a.agentId === 'bad-agent');
  assert.ok(badAgent);
  assert.ok(badAgent.failed >= 5);
  assert.ok(badAgent.passRate < 50);
});

test('generateGovernanceReport identifies top failing agent', () => {
  const report = gov.generateGovernanceReport({ periodHours: 24 });
  if (report.topFailingAgent) {
    assert.ok(report.topFailingAgent.passRate < 80);
  }
});

test('generateGovernanceReport includes run type breakdown', () => {
  const report = gov.generateGovernanceReport({ periodHours: 24 });
  assert.ok(typeof report.byType === 'object');
});

test('generateGovernanceReport returns zero for empty period', () => {
  const report = gov.generateGovernanceReport({ periodHours: 0 });
  assert.equal(report.total, 0);
  assert.equal(report.passRate, 0);
});

// === Format Report ===
test('formatGovernanceReport produces readable text', () => {
  const report = gov.generateGovernanceReport({ periodHours: 24 });
  const text = gov.formatGovernanceReport(report);
  assert.ok(text.includes('Background Agent Governance Report'));
  assert.ok(text.includes('Pass rate:'));
  assert.ok(text.includes('Gates'));
});

// === getRunsPath ===
test('getRunsPath returns correct path', () => {
  assert.ok(gov.getRunsPath().endsWith('agent-runs.jsonl'));
});

// === Unattended wake (DevDay 2026 compare-not-clone) ===
const WAKE_SECRET = 'SECRET-WAKE-TEXT';
const AUDIO_SECRET = 'SECRET-AUDIO-BYTES';

test('evaluateUnattendedWake leaves an attended merge alone', () => {
  assert.equal(gov.evaluateUnattendedWake({
    toolName: 'Bash',
    command: 'gh pr merge 12',
  }), null);
});

test('evaluateUnattendedWake keeps an unattended mutation off until an admin enables it', () => {
  const denied = gov.evaluateUnattendedWake({
    toolName: 'Bash',
    command: 'git commit -m "wip"',
    unattended: true,
  });
  assert.equal(denied.code, 'UNATTENDED_DEFAULT_OFF');
  assert.equal(denied.decision, 'deny');
  const allowed = gov.evaluateUnattendedWake({
    toolName: 'Bash',
    command: 'git commit -m "wip"',
    unattended: true,
    enabled: true,
  });
  assert.equal(allowed, null);
});

test('evaluateUnattendedWake lets an unattended read through', () => {
  assert.equal(gov.evaluateUnattendedWake({
    toolName: 'Bash',
    command: 'gh pr view 12',
    unattended: true,
  }), null);
  assert.equal(gov.evaluateUnattendedWake({
    toolName: 'Bash',
    command: 'echo x 2>&1',
    unattended: true,
  }), null);
});

test('evaluateUnattendedWake treats a write redirect as a mutation', () => {
  const denied = gov.evaluateUnattendedWake({
    toolName: 'Bash',
    command: 'echo x > file',
    unattended: true,
  });
  assert.equal(denied.code, 'UNATTENDED_DEFAULT_OFF');
});

test('evaluateUnattendedWake refuses an automatic approve or merge', () => {
  const away = gov.evaluateUnattendedWake({
    toolName: 'Bash',
    command: 'gh pr merge 12',
    unattended: true,
    enabled: true,
  });
  assert.equal(away.code, 'AUTOMATIC_REVIEW_CANNOT_LAND');
  const review = gov.evaluateUnattendedWake({
    toolName: 'Bash',
    command: 'gh pr review 12 --approve',
    automaticReview: true,
  });
  assert.equal(review.code, 'AUTOMATIC_REVIEW_CANNOT_LAND');
});

test('evaluateUnattendedWake treats an inbound mention as data', () => {
  const denied = gov.evaluateUnattendedWake({
    toolName: 'Write',
    wake: { kind: 'mention', text: WAKE_SECRET },
  });
  assert.equal(denied.code, 'MENTION_IS_NOT_A_GRANT');
  assert.equal(JSON.stringify(denied).includes(WAKE_SECRET), false);
  assert.equal(gov.evaluateUnattendedWake({
    toolName: 'Bash',
    command: 'gh pr view 12',
    wake: 'slack',
  }), null);
  assert.equal(gov.evaluateUnattendedWake({
    toolName: 'Write',
    wake: 'email',
    unattended: true,
    enabled: true,
    operatorGrant: true,
  }), null);
});

test('evaluateUnattendedWake does not transfer a permission across identities', () => {
  const denied = gov.evaluateUnattendedWake({
    toolName: 'Read',
    grantIdentity: 'owner-a',
    actorId: 'actor-b',
  });
  assert.equal(denied.code, 'GRANT_NOT_INHERITED');
  assert.equal(gov.evaluateUnattendedWake({
    toolName: 'Read',
    grantIdentity: 'same',
    actorId: ' same ',
  }), null);
});

test('evaluateUnattendedWake drops a raw capture once a durable note exists', () => {
  const denied = gov.evaluateUnattendedWake({
    toolName: 'Read',
    durableNote: 'action items only',
    rawAudio: AUDIO_SECRET,
  });
  assert.equal(denied.code, 'RAW_CAPTURE_RETAINED');
  assert.equal(JSON.stringify(denied).includes(AUDIO_SECRET), false);
});

test('checkRunGovernance records an unattended mutation as a blocker', () => {
  const denied = gov.checkRunGovernance({
    agentId: 'wake-off',
    unattended: true,
    command: 'git commit -m "wip"',
    toolName: 'Bash',
  });
  assert.equal(denied.allowed, false);
  assert.ok(denied.blockers.some((blocker) => blocker.rule === 'UNATTENDED_DEFAULT_OFF'));
  const enabled = gov.checkRunGovernance({
    agentId: 'wake-on',
    unattended: true,
    enabled: true,
    command: 'git commit -m "wip"',
    toolName: 'Bash',
  });
  assert.equal(enabled.allowed, true);
});

function runWakeHook(input, env = {}) {
  const budget = path.join(os.tmpdir(), `tg-wake-budget-${Math.random().toString(36).slice(2)}.json`);
  const childEnv = { ...process.env, THUMBGATE_BUDGET_STATE_PATH: budget };
  delete childEnv.THUMBGATE_SESSION_AGENT;
  delete childEnv.THUMBGATE_UNATTENDED;
  delete childEnv.THUMBGATE_UNATTENDED_ENABLED;
  delete childEnv.THUMBGATE_HOOKS_ENFORCE;
  delete childEnv.THUMBGATE_AUTOGATE_PR_COMMITS;
  Object.assign(childEnv, env);
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'hook-pre-tool-use.js')], {
    input: JSON.stringify(input),
    env: childEnv,
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
  });
  try { fs.rmSync(budget, { force: true }); } catch { /* already gone */ }
  let parsed = null;
  try { parsed = JSON.parse(result.stdout || '{}'); } catch { /* not json */ }
  return { status: result.status, stdout: result.stdout || '', parsed };
}

test('hook allows an attended commit and blocks an unattended one', () => {
  const attended = runWakeHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "wip"' },
  });
  assert.equal(attended.status, 0);
  assert.notEqual(attended.parsed && attended.parsed.decision, 'block');

  const off = runWakeHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "wip"' },
  }, { THUMBGATE_UNATTENDED: '1' });
  assert.equal(off.status, 0);
  assert.equal(off.parsed.decision, 'block');
  assert.match(off.parsed.reason, /UNATTENDED_DEFAULT_OFF/);

  const on = runWakeHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "wip"' },
  }, { THUMBGATE_UNATTENDED: '1', THUMBGATE_UNATTENDED_ENABLED: '1' });
  assert.equal(on.status, 0);
  assert.equal((on.stdout.includes('UNATTENDED_DEFAULT_OFF')), false);
});

test('hook still refuses an unattended merge after the admin enables wakes', () => {
  const res = runWakeHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'gh pr merge 12' },
  }, { THUMBGATE_UNATTENDED: '1', THUMBGATE_UNATTENDED_ENABLED: '1' });
  assert.equal(res.parsed.decision, 'block');
  assert.match(res.parsed.reason, /AUTOMATIC_REVIEW_CANNOT_LAND/);
});

test('hook blocks a mention write and omits the wake text', () => {
  const res = runWakeHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { wake: { kind: 'mention', text: WAKE_SECRET }, file_path: 'notes.md' },
  });
  assert.equal(res.parsed.decision, 'block');
  assert.match(res.parsed.reason, /MENTION_IS_NOT_A_GRANT/);
  assert.equal(res.stdout.includes(WAKE_SECRET), false);
});

test('hook drops raw audio once a durable note exists and omits the bytes', () => {
  const res = runWakeHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { durableNote: 'decisions only', rawAudio: AUDIO_SECRET, file_path: 'notes.md' },
  });
  assert.equal(res.parsed.decision, 'block');
  assert.match(res.parsed.reason, /RAW_CAPTURE_RETAINED/);
  assert.equal(res.stdout.includes(AUDIO_SECRET), false);
});

test('cli check forwards the unattended flag and stores no raw bytes', () => {
  const cli = path.join(__dirname, '..', 'bin', 'cli.js');
  const result = spawnSync(process.execPath, [
    cli,
    'background-agent-governance',
    '--check',
    '--json',
    '--feedback-dir', tmpDir,
    '--agent-id', 'cli-wake',
    '--unattended',
    '--command', 'git commit -m wip',
    '--raw-capture', AUDIO_SECRET,
    '--durable-note', 'note only',
  ], {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, THUMBGATE_FEEDBACK_DIR: tmpDir },
  });
  assert.equal(result.status, 2);
  assert.equal((result.stdout || '').includes(AUDIO_SECRET), false);
  const body = JSON.parse(result.stdout);
  assert.equal(body.allowed, false);
  assert.ok(body.blockers.some((blocker) => blocker.rule === 'RAW_CAPTURE_RETAINED'));
});
