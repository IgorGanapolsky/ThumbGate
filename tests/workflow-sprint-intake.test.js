'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-sprint-intake-test-'));
const previousFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const {
  appendWorkflowSprintLead,
  advanceWorkflowSprintLead,
  getWorkflowSprintLeadsPath,
  loadWorkflowSprintLeads,
} = require('../scripts/workflow-sprint-intake');
const {
  getWorkflowRunsPath,
  loadWorkflowRuns,
  summarizeWorkflowRuns,
} = require('../scripts/workflow-runs');

test.beforeEach(() => {
  fs.rmSync(getWorkflowSprintLeadsPath(tmpDir), { force: true });
  fs.rmSync(getWorkflowRunsPath(tmpDir), { force: true });
});

test.after(() => {
  if (previousFeedbackDir === undefined) {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
  } else {
    process.env.THUMBGATE_FEEDBACK_DIR = previousFeedbackDir;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function buildLeadPayload() {
  return {
    email: 'pilot@example.com',
    company: 'North Star Systems',
    workflow: 'PR review hardening',
    owner: 'Platform lead',
    blocker: 'Review regressions keep repeating across agent rollouts.',
    runtime: 'Claude Code',
    note: 'Need proof before team rollout.',
    utmSource: 'linkedin',
    creator: 'reach_vb',
    ctaId: 'workflow_sprint_intake',
  };
}

test('advanceWorkflowSprintLead appends snapshots and workflow runs for the proof-backed pipeline', () => {
  const lead = appendWorkflowSprintLead(buildLeadPayload(), { feedbackDir: tmpDir });

  const qualified = advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'qualified',
    actor: 'ops',
    note: 'Qualified for pilot review.',
  }, { feedbackDir: tmpDir });
  assert.equal(qualified.workflowRun, null);

  const namedPilot = advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'named_pilot',
    actor: 'ops',
    workflowId: 'pr_review_hardening',
    teamId: 'north_star_systems',
  }, { feedbackDir: tmpDir });
  assert.equal(namedPilot.lead.status, 'named_pilot');
  assert.ok(namedPilot.workflowRun);
  assert.equal(namedPilot.workflowRun.customerType, 'named_pilot');
  assert.equal(namedPilot.workflowRun.proofBacked, false);

  const proofBacked = advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'proof_backed_run',
    actor: 'ops',
    reviewedBy: 'buyer@example.com',
    proofArtifacts: ['docs/VERIFICATION_EVIDENCE.md'],
  }, { feedbackDir: tmpDir });
  assert.equal(proofBacked.lead.status, 'proof_backed_run');
  assert.ok(proofBacked.workflowRun);
  assert.equal(proofBacked.workflowRun.proofBacked, true);

  const paidTeam = advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    actor: 'ops',
  }, { feedbackDir: tmpDir });
  assert.equal(paidTeam.lead.status, 'paid_team');
  assert.ok(paidTeam.workflowRun);
  assert.equal(paidTeam.workflowRun.customerType, 'paid_team');
  assert.equal(paidTeam.workflowRun.proofBacked, true);

  const leads = loadWorkflowSprintLeads(tmpDir);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].status, 'paid_team');
  assert.equal(leads[0].statusHistory.length, 5);
  assert.equal(leads[0].attribution.creator, 'reach_vb');
  assert.ok(leads[0].workflowProgress.qualifiedAt);
  assert.ok(leads[0].workflowProgress.namedPilotAt);
  assert.ok(leads[0].workflowProgress.proofBackedRunAt);
  assert.ok(leads[0].workflowProgress.paidTeamAt);
  assert.equal(leads[0].proof.reviewedBy, 'buyer@example.com');
  assert.deepEqual(leads[0].proof.artifacts, ['docs/VERIFICATION_EVIDENCE.md']);

  const runs = loadWorkflowRuns(tmpDir);
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map((entry) => entry.customerType), ['named_pilot', 'named_pilot', 'paid_team']);

  const summary = summarizeWorkflowRuns(tmpDir, new Date());
  assert.equal(summary.namedPilotAgreements, 1);
  assert.equal(summary.paidTeamRuns, 1);
  assert.equal(summary.weeklyActiveProofBackedWorkflowRuns, 1);
  assert.equal(summary.customerProofReached, true);
});

test('advanceWorkflowSprintLead enforces sequential transitions and proof evidence requirements', () => {
  const lead = appendWorkflowSprintLead(buildLeadPayload(), { feedbackDir: tmpDir });

  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'proof_backed_run',
    actor: 'ops',
  }, { feedbackDir: tmpDir }), /Invalid workflow sprint transition/);

  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'qualified',
    actor: 'ops',
  }, { feedbackDir: tmpDir });
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'named_pilot',
    actor: 'ops',
  }, { feedbackDir: tmpDir });

  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'proof_backed_run',
    actor: 'ops',
  }, { feedbackDir: tmpDir }), /requires reviewedBy or proofArtifacts/);
});
