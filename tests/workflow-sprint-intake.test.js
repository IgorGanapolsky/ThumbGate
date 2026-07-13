'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-sprint-intake-test-'));
const previousFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const {
  appendWorkflowSprintLead,
  advanceWorkflowSprintLead,
  getWorkflowSprintIntakeLimitsPath,
  getWorkflowSprintLeadsPath,
  loadWorkflowSprintLeads,
  notifyWorkflowSprintLead,
  reserveWorkflowSprintIntake,
} = require('../scripts/workflow-sprint-intake');
const {
  getWorkflowRunsPath,
  loadWorkflowRuns,
  summarizeWorkflowRuns,
} = require('../scripts/workflow-runs');

test.beforeEach(() => {
  fs.rmSync(getWorkflowSprintLeadsPath(tmpDir), { force: true });
  fs.rmSync(getWorkflowSprintIntakeLimitsPath(tmpDir), { force: true });
  fs.rmSync(`${getWorkflowSprintIntakeLimitsPath(tmpDir)}.lock`, { recursive: true, force: true });
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

test('diagnostic-page fields satisfy the shared intake contract', () => {
  const lead = appendWorkflowSprintLead({
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    company: 'Analytical Engines',
    workflow: 'The release agent repeatedly deploys without approval evidence.',
    urgency: 'Repeated failure already cost us time',
    planId: 'diagnostic',
    ctaId: 'diagnostic_page_intake',
    utmSource: 'aiventyx',
  }, { feedbackDir: tmpDir });

  assert.equal(lead.contact.name, 'Ada Lovelace');
  assert.equal(lead.contact.email, 'ada@example.com');
  assert.equal(lead.offer, 'workflow_hardening_diagnostic');
  assert.equal(lead.qualification.owner, null);
  assert.equal(lead.qualification.blocker, null);
  assert.equal(lead.qualification.runtime, null);
  assert.equal(lead.qualification.urgency, 'Repeated failure already cost us time');
  assert.equal(lead.attribution.planId, 'diagnostic');
  assert.equal(lead.attribution.utmSource, 'aiventyx');
});

test('workflow intake alert is secret-safe and uses the operator recipient', async () => {
  const fakeStripeSecret = `sk_live_${'a'.repeat(24)}`;
  const lead = appendWorkflowSprintLead({
    ...buildLeadPayload(),
    blocker: `Review regressions expose ${fakeStripeSecret}`,
    utmSource: fakeStripeSecret,
  }, { feedbackDir: tmpDir });
  const calls = [];
  const result = await notifyWorkflowSprintLead(lead, {
    env: { THUMBGATE_OPERATOR_ALERT_EMAIL: 'owner@example.com' },
    sendEmailImpl: async (message) => {
      calls.push(message);
      return { sent: true, id: 'email_intake_1' };
    },
  });

  assert.equal(result.sent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, 'owner@example.com');
  assert.match(calls[0].subject, /North Star Systems/);
  assert.match(calls[0].text, /pilot@example\.com/);
  assert.match(calls[0].text, /PR review hardening/);
  assert.doesNotMatch(calls[0].text, new RegExp(fakeStripeSecret));
  assert.match(calls[0].text, /\[REDACTED:stripe_live_secret\]/);
  assert.equal(calls[0].idempotencyKey.length > 20, true);
  assert.doesNotMatch(JSON.stringify(lead), new RegExp(fakeStripeSecret));
  assert.match(lead.attribution.utmSource, /\[REDACTED:stripe_live_secret\]/);

  const duplicate = await notifyWorkflowSprintLead(lead, {
    env: { THUMBGATE_OPERATOR_ALERT_EMAIL: 'owner@example.com' },
    sendEmailImpl: async (message) => {
      calls.push(message);
      return { sent: true, id: 'email_intake_duplicate' };
    },
  });
  assert.equal(duplicate.sent, false);
  assert.equal(duplicate.reason, 'duplicate_intake_alert');
  assert.equal(calls.length, 1);
});

test('workflow intake alerts are rate limited independently from lead capture', async () => {
  const calls = [];
  const results = [];
  for (let index = 0; index < 6; index += 1) {
    const lead = appendWorkflowSprintLead({
      ...buildLeadPayload(),
      email: `pilot-${index}@example.com`,
      workflow: `PR review hardening ${index}`,
    }, { feedbackDir: tmpDir });
    results.push(await notifyWorkflowSprintLead(lead, {
      env: { THUMBGATE_OPERATOR_ALERT_EMAIL: 'owner@example.com' },
      rateLimitKey: 'hashed-client-1',
      now: Date.UTC(2026, 6, 12, 20, 0, 0),
      sendEmailImpl: async (message) => {
        calls.push(message);
        return { sent: true, id: `email_${index}` };
      },
    }));
  }

  assert.equal(calls.length, 5);
  assert.equal(results[5].sent, false);
  assert.equal(results[5].reason, 'intake_alert_rate_limited');
});

test('durable intake quota rejects duplicates and bounds persistence before lead capture', () => {
  const now = Date.UTC(2026, 6, 12, 21, 0, 0);
  const first = reserveWorkflowSprintIntake({
    ...buildLeadPayload(),
    email: 'bounded@example.com',
    workflow: 'Production deploy review',
  }, {
    feedbackDir: tmpDir,
    rateLimitKey: 'trusted-client-hash',
    now,
  });
  assert.equal(first.allowed, true);

  delete require.cache[require.resolve('../scripts/workflow-sprint-intake')];
  const reloaded = require('../scripts/workflow-sprint-intake');
  const duplicate = reloaded.reserveWorkflowSprintIntake({
    ...buildLeadPayload(),
    email: 'bounded@example.com',
    workflow: 'Production deploy review',
  }, {
    feedbackDir: tmpDir,
    rateLimitKey: 'trusted-client-hash',
    now: now + 1000,
  });
  assert.equal(duplicate.allowed, false);
  assert.equal(duplicate.reason, 'duplicate_intake');

  for (let index = 1; index < 10; index += 1) {
    assert.equal(reloaded.reserveWorkflowSprintIntake({
      ...buildLeadPayload(),
      email: `bounded-${index}@example.com`,
      workflow: `Production deploy review ${index}`,
    }, {
      feedbackDir: tmpDir,
      rateLimitKey: 'trusted-client-hash',
      now: now + index + 1000,
    }).allowed, true);
  }
  const blocked = reloaded.reserveWorkflowSprintIntake({
    ...buildLeadPayload(),
    email: 'bounded-11@example.com',
    workflow: 'Production deploy review 11',
  }, {
    feedbackDir: tmpDir,
    rateLimitKey: 'trusted-client-hash',
    now: now + 2000,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'client_intake_rate_limited');

  const stored = fs.readFileSync(getWorkflowSprintIntakeLimitsPath(tmpDir), 'utf8');
  assert.doesNotMatch(stored, /bounded@example\.com|Production deploy review|trusted-client-hash/);
});

test('distributed networks cannot exhaust intake for an unrelated source', () => {
  const now = Date.UTC(2026, 6, 12, 22, 0, 0);
  for (let networkIndex = 0; networkIndex < 20; networkIndex += 1) {
    for (let intakeIndex = 0; intakeIndex < 10; intakeIndex += 1) {
      const result = reserveWorkflowSprintIntake({
        ...buildLeadPayload(),
        email: `distributed-${networkIndex}-${intakeIndex}@example.com`,
        workflow: `Distributed workflow ${networkIndex}-${intakeIndex}`,
      }, {
        feedbackDir: tmpDir,
        rateLimitKey: `distributed-network-${networkIndex}`,
        now: now + networkIndex * 10 + intakeIndex,
      });
      assert.equal(result.allowed, true);
    }
  }

  const abusiveSource = reserveWorkflowSprintIntake({
    ...buildLeadPayload(),
    email: 'distributed-over-limit@example.com',
    workflow: 'Distributed workflow over limit',
  }, {
    feedbackDir: tmpDir,
    rateLimitKey: 'distributed-network-0',
    now: now + 1000,
  });
  assert.equal(abusiveSource.allowed, false);
  assert.equal(abusiveSource.reason, 'client_intake_rate_limited');

  const legitimateSource = reserveWorkflowSprintIntake({
    ...buildLeadPayload(),
    email: 'legitimate-buyer@example.com',
    workflow: 'Legitimate buyer workflow',
  }, {
    feedbackDir: tmpDir,
    rateLimitKey: 'unrelated-legitimate-network',
    now: now + 1001,
  });
  assert.equal(legitimateSource.allowed, true);

  const stored = JSON.parse(fs.readFileSync(getWorkflowSprintIntakeLimitsPath(tmpDir), 'utf8'));
  assert.equal(Object.hasOwn(stored, 'global'), false);
  assert.equal(Object.keys(stored.clients).length, 21);
  assert.equal(Object.keys(stored.dedupe).length, 201);
});

test('durable intake state bounds attacker-controlled key cardinality', () => {
  const now = Date.UTC(2026, 6, 12, 23, 0, 0);
  const clients = {};
  const dedupe = {};
  for (let index = 0; index <= 10000; index += 1) {
    clients[`stored-client-${index}`] = [now + index];
    dedupe[`stored-dedupe-${index}`] = now + index;
  }
  fs.writeFileSync(getWorkflowSprintIntakeLimitsPath(tmpDir), `${JSON.stringify({
    global: Array(200).fill(now),
    clients,
    dedupe,
  })}\n`, 'utf8');

  const rateLimitKey = 'new-legitimate-network';
  const email = 'state-bounded-buyer@example.com';
  const workflow = 'State-bounded legitimate workflow';
  const reservationNow = now + 20000;
  const result = reserveWorkflowSprintIntake({
    ...buildLeadPayload(),
    email,
    workflow,
  }, {
    feedbackDir: tmpDir,
    rateLimitKey,
    now: reservationNow,
  });
  assert.equal(result.allowed, true);

  const stored = JSON.parse(fs.readFileSync(getWorkflowSprintIntakeLimitsPath(tmpDir), 'utf8'));
  const clientKey = crypto.createHash('sha256').update(rateLimitKey).digest('hex');
  const duplicateKey = crypto.createHash('sha256').update(`${email}|${workflow}`).digest('hex');
  assert.equal(Object.hasOwn(stored, 'global'), false);
  assert.equal(Object.keys(stored.clients).length, 10000);
  assert.equal(Object.keys(stored.dedupe).length, 10000);
  assert.deepEqual(stored.clients[clientKey], [reservationNow]);
  assert.equal(stored.dedupe[duplicateKey], reservationNow);
});

test('invalid intake never consumes durable quota', () => {
  assert.throws(() => reserveWorkflowSprintIntake({
    email: 'not-an-email',
    workflow: 'Production deploy review',
  }, {
    feedbackDir: tmpDir,
    rateLimitKey: 'untrusted-client',
  }), /valid email/i);
  assert.equal(fs.existsSync(getWorkflowSprintIntakeLimitsPath(tmpDir)), false);
});

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
