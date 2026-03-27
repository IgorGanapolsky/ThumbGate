'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-runs-test-'));
const previousFeedbackDir = process.env.RLHF_FEEDBACK_DIR;
process.env.RLHF_FEEDBACK_DIR = tmpDir;

const {
  appendWorkflowRun,
  getWorkflowRunsPath,
  loadWorkflowRuns,
  summarizeWorkflowRuns,
} = require('../scripts/workflow-runs');

test.beforeEach(() => {
  fs.rmSync(getWorkflowRunsPath(tmpDir), { force: true });
});

test.after(() => {
  if (previousFeedbackDir === undefined) {
    delete process.env.RLHF_FEEDBACK_DIR;
  } else {
    process.env.RLHF_FEEDBACK_DIR = previousFeedbackDir;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('appendWorkflowRun persists sanitized proof-backed runs', () => {
  const entry = appendWorkflowRun({
    workflowId: 'sales_handoff',
    workflowName: 'Sales handoff',
    owner: 'ops',
    runtime: 'claude+mcp',
    proofBacked: true,
    reviewedBy: 'buyer',
    proofArtifacts: ['proof/compatibility/report.json', null],
  }, tmpDir);

  assert.equal(entry.workflowId, 'sales_handoff');
  assert.equal(entry.reviewed, true);
  assert.deepEqual(entry.proofArtifacts, ['proof/compatibility/report.json']);

  const loaded = loadWorkflowRuns(tmpDir);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].workflowName, 'Sales handoff');
});

test('summarizeWorkflowRuns reports weekly proof-backed workflow activity', () => {
  appendWorkflowRun({
    timestamp: new Date('2026-03-18T12:00:00.000Z').toISOString(),
    workflowId: 'repo_self_dogfood_full_verify',
    workflowName: 'Repo self dogfood verification',
    owner: 'cto',
    runtime: 'node',
    proofBacked: true,
    reviewed: true,
    customerType: 'internal_dogfood',
    teamId: 'internal_repo',
  }, tmpDir);

  appendWorkflowRun({
    timestamp: new Date('2026-03-01T12:00:00.000Z').toISOString(),
    workflowId: 'pilot_customer_run',
    workflowName: 'Pilot customer run',
    owner: 'ops',
    runtime: 'hosted',
    proofBacked: true,
    reviewedBy: 'buyer',
    customerType: 'named_pilot',
    teamId: 'pilot_team',
  }, tmpDir);

  const summary = summarizeWorkflowRuns(tmpDir, new Date('2026-03-18T18:00:00.000Z'));
  assert.equal(summary.totalRuns, 2);
  assert.equal(summary.proofBackedRuns, 2);
  assert.equal(summary.reviewedRuns, 2);
  assert.equal(summary.weeklyActiveProofBackedWorkflowRuns, 1);
  assert.equal(summary.weeklyTeamsRunningProofBackedWorkflows, 1);
  assert.equal(summary.namedPilotAgreements, 1);
  assert.equal(summary.customerProofReached, true);
  assert.equal(summary.northStarReached, true);
  assert.equal(summary.latestRun.workflowId, 'repo_self_dogfood_full_verify');
});

test('summarizeWorkflowRuns deduplicates named pilots and paid teams across append-only state transitions', () => {
  appendWorkflowRun({
    timestamp: new Date().toISOString(),
    workflowId: 'pilot_transition_workflow',
    workflowName: 'Pilot transition workflow',
    owner: 'ops',
    runtime: 'hosted',
    proofBacked: false,
    reviewed: false,
    customerType: 'named_pilot',
    teamId: 'pilot_team',
    metadata: {
      leadId: 'lead_transition',
      pipelineStatus: 'named_pilot',
    },
  }, tmpDir);

  appendWorkflowRun({
    timestamp: new Date().toISOString(),
    workflowId: 'pilot_transition_workflow',
    workflowName: 'Pilot transition workflow',
    owner: 'ops',
    runtime: 'hosted',
    proofBacked: true,
    reviewedBy: 'buyer@example.com',
    customerType: 'named_pilot',
    teamId: 'pilot_team',
    metadata: {
      leadId: 'lead_transition',
      pipelineStatus: 'proof_backed_run',
    },
  }, tmpDir);

  appendWorkflowRun({
    timestamp: new Date().toISOString(),
    workflowId: 'pilot_transition_workflow',
    workflowName: 'Pilot transition workflow',
    owner: 'ops',
    runtime: 'hosted',
    proofBacked: true,
    reviewedBy: 'buyer@example.com',
    customerType: 'paid_team',
    teamId: 'pilot_team',
    metadata: {
      leadId: 'lead_transition',
      pipelineStatus: 'paid_team',
    },
  }, tmpDir);

  const summary = summarizeWorkflowRuns(tmpDir, new Date());
  assert.equal(summary.namedPilotAgreements, 1);
  assert.equal(summary.paidTeamRuns, 1);
  assert.equal(summary.weeklyActiveProofBackedWorkflowRuns, 1);
});
