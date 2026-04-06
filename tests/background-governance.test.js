const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-bgov-'));
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
