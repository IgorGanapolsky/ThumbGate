'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-sprint-intake-test-'));
const previousFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const {
  appendWorkflowSprintLead,
  appendWorkflowSprintLeadSnapshot,
  advanceWorkflowSprintLead,
  auditWorkflowCommercialProof,
  buildCompletedPilotEvidence,
  getWorkflowSprintIntakeLimitsPath,
  getWorkflowSprintLeadsPath,
  isEvidenceBasedQualificationReview,
  loadWorkflowSprintLeadSnapshots,
  loadWorkflowSprintLeads,
  notifyWorkflowSprintLead,
  reserveWorkflowSprintIntake,
} = require('../scripts/workflow-sprint-intake');
const {
  getWorkflowRunsPath,
  loadWorkflowRuns,
  summarizeWorkflowRuns,
} = require('../scripts/workflow-runs');
const {
  addSalesLead,
  getSalesPipelinePath,
  loadSalesLeads,
} = require('../scripts/sales-pipeline');
const { reconcileProviderPayment } = require('../scripts/provider-payment-reconciler');
const { digestBuyerEmail } = require('../scripts/provider-revenue-evidence');

test.beforeEach(() => {
  fs.rmSync(getWorkflowSprintLeadsPath(tmpDir), { force: true });
  fs.rmSync(`${getWorkflowSprintLeadsPath(tmpDir)}.commercial.lock`, { recursive: true, force: true });
  fs.rmSync(getWorkflowSprintIntakeLimitsPath(tmpDir), { force: true });
  fs.rmSync(`${getWorkflowSprintIntakeLimitsPath(tmpDir)}.lock`, { recursive: true, force: true });
  fs.rmSync(getWorkflowRunsPath(tmpDir), { force: true });
  fs.rmSync(getSalesPipelinePath({ feedbackDir: tmpDir }), { force: true });
});

test.after(() => {
  if (previousFeedbackDir === undefined) {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
  } else {
    process.env.THUMBGATE_FEEDBACK_DIR = previousFeedbackDir;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function buildLeadPayload(overrides = {}) {
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
    ...overrides,
  };
}

const SCOPE_DIGEST = `sha256:${'b'.repeat(64)}`;
const SIGNED_AT = '2026-07-15T12:00:00.000Z';

function signedScope(overrides = {}) {
  return {
    agreementSource: 'docusign',
    agreementRef: 'envelope_signed_123',
    agreementSignedBy: 'buyer@example.com',
    agreementSignedAt: SIGNED_AT,
    agreementDigest: SCOPE_DIGEST,
    agreementOfferId: 'workflow_hardening_sprint',
    agreementAmountCents: 150000,
    agreementWorkflowCount: 1,
    ...overrides,
  };
}

function qualificationReview(overrides = {}) {
  return {
    severityAndFrequency: 'The approval failure has repeated in the current workflow.',
    measurableImpact: 'The team must re-review and repair unsafe retries.',
    urgencyAndTrigger: 'The failure recurred this week and blocks rollout.',
    decisionAuthority: 'The named workflow owner can approve the next scoped step.',
    budgetMechanism: 'The fixed price will be reviewed before any checkout or signed scope.',
    offerFit: 'One bounded workflow fits the Workflow Hardening Sprint.',
    proofRequired: 'The buyer requires local regression evidence and an approval runbook.',
    nextStep: 'Review one fixed workflow scope without sending or charging automatically.',
    evidenceReferences: ['intake:workflow-sprint-test'],
    zeroSpendStatus: 'proceed_zero_cost',
    priceUnderstandingConfirmed: true,
    workflowCount: 1,
    authorityConfirmed: true,
    urgencyDays: 14,
    budgetCents: 150000,
    readyToImplement: true,
    ...overrides,
  };
}

function qualifyPayload(overrides = {}) {
  return {
    reviewedBy: 'ops@example.com',
    qualificationReview: qualificationReview(),
    ...overrides,
  };
}

async function addVerifiedPaidSalesLead(leadId = 'sales_north_star', overrides = {}) {
  const paymentId = `capture_${leadId}`;
  const amountCents = overrides.amountCents || 150000;
  const offer = overrides.offer || 'workflow_hardening_sprint';
  const recurring = offer === 'workflow_reliability_operations' ||
    offer === 'enterprise_reliability_operations';
  addSalesLead({
    leadId,
    source: 'direct',
    email: overrides.email || 'pilot@example.com',
    offer,
  }, { feedbackDir: tmpDir });
  await reconcileProviderPayment({ leadId, paymentId, force: true }, {
    feedbackDir: tmpDir,
    auditPayPalLiveEvidence: async () => ({
      generatedAt: overrides.auditGeneratedAt || '2026-07-16T13:00:00.000Z',
      individualPayments: [{
        provider: 'paypal',
        id: paymentId,
        createdAt: overrides.createdAt || '2026-07-16T12:00:00.000Z',
        status: 'completed',
        grossCents: amountCents,
        refundedCents: 0,
        netCents: amountCents,
        currency: 'usd',
        customerClassification: 'external',
        ownerTest: false,
        buyerEmailDigest: digestBuyerEmail(overrides.email || 'pilot@example.com'),
        productAttribution: { verified: true, product: 'thumbgate' },
        evidenceVerified: true,
        evidenceSource: 'provider_api_live:test-paypal-reconciliation',
        evidenceDigest: `sha256:${crypto.createHash('sha256').update(leadId).digest('hex')}`,
        ...(recurring && overrides.includeInvoiceId !== false
          ? { invoiceId: overrides.invoiceId || `thumbgate-${leadId}-2026-07` }
          : {}),
      }],
    }),
  });
  return loadSalesLeads({ feedbackDir: tmpDir }).find((entry) => entry.leadId === leadId);
}

async function addVerifiedStripePaidSalesLead(leadId, {
  offer = 'workflow_reliability_operations',
  amountCents = 300000,
  invoiceId = `in_${leadId}`,
  email = 'pilot@example.com',
} = {}) {
  const paymentId = `ch_${leadId}`;
  addSalesLead({ leadId, source: 'direct', email, offer }, { feedbackDir: tmpDir });
  await reconcileProviderPayment({ leadId, paymentId, provider: 'stripe', force: true }, {
    feedbackDir: tmpDir,
    auditStripeLiveEvidence: async () => ({
      configured: true,
      generatedAt: '2026-07-16T13:00:00.000Z',
      productAttribution: {
        verified: true,
        thumbgate: {
          individualPaymentStates: [{
            provider: 'stripe',
            id: paymentId,
            createdAt: '2026-07-16T12:00:00.000Z',
            status: 'completed',
            grossCents: amountCents,
            refundedCents: 0,
            netCents: amountCents,
            currency: 'usd',
            customerId: 'sha256:private-stripe-customer',
            customerClassification: 'external',
            ownerTest: false,
            buyerEmailDigest: digestBuyerEmail(email),
            productAttribution: { verified: true, product: 'thumbgate' },
            evidenceVerified: true,
            evidenceSource: 'provider_api_live:stripe-checkout-product-reconciliation',
            evidenceDigest: `sha256:${crypto.createHash('sha256').update(leadId).digest('hex')}`,
            invoiceId,
            offerIds: [offer],
          }],
        },
      },
    }),
  });
  return loadSalesLeads({ feedbackDir: tmpDir }).find((entry) => entry.leadId === leadId);
}

async function createCompletedEnterprisePilot({
  email = 'pilot@example.com',
  workflowCount = 3,
  proofArtifacts = ['proof/enterprise-governance-pilot.json'],
  salesLeadId = 'sales_enterprise_pilot',
} = {}) {
  const pilot = appendWorkflowSprintLead(buildLeadPayload({
    email,
    submittedAt: '2026-07-14T08:00:00.000Z',
    workflow: 'Governed agent workflows',
  }), { feedbackDir: tmpDir });
  advanceWorkflowSprintLead({
    leadId: pilot.leadId,
    status: 'qualified',
    ...qualifyPayload({
      qualificationReview: qualificationReview({
        workflowCount,
        proofBackedSprint: true,
        budgetCents: 1500000,
        readyToImplement: false,
      }),
    }),
  }, { feedbackDir: tmpDir, now: '2026-07-14T08:30:00.000Z' });
  advanceWorkflowSprintLead({
    leadId: pilot.leadId,
    status: 'named_pilot',
    ...signedScope({
      agreementRef: `enterprise_pilot_scope_${pilot.leadId}`,
      agreementSignedAt: '2026-07-14T09:00:00.000Z',
      agreementOfferId: 'enterprise_governance_pilot',
      agreementAmountCents: 1500000,
      agreementWorkflowCount: workflowCount,
    }),
  }, { feedbackDir: tmpDir, now: '2026-07-14T09:00:00.000Z' });
  advanceWorkflowSprintLead({
    leadId: pilot.leadId,
    status: 'proof_backed_run',
    ...(proofArtifacts.length > 0 ? { proofArtifacts } : { reviewedBy: 'buyer@example.com' }),
  }, { feedbackDir: tmpDir, now: '2026-07-14T10:00:00.000Z' });
  const paid = await addVerifiedPaidSalesLead(salesLeadId, {
    email,
    offer: 'enterprise_governance_pilot',
    amountCents: 1500000,
    createdAt: '2026-07-14T10:01:00.000Z',
    auditGeneratedAt: '2026-07-14T10:01:30.000Z',
  });
  advanceWorkflowSprintLead({
    leadId: pilot.leadId,
    status: 'paid_team',
    salesLeadId: paid.leadId,
  }, { feedbackDir: tmpDir, now: '2026-07-14T10:02:00.000Z' });
  const completedLead = loadWorkflowSprintLeads(tmpDir)
    .find((entry) => entry.leadId === pilot.leadId);
  return {
    pilot: completedLead,
    paid,
    evidence: buildCompletedPilotEvidence(completedLead, loadSalesLeads({ feedbackDir: tmpDir }), {
      now: '2026-07-16T13:00:00.000Z',
    }),
  };
}

function createQualifiedEnterpriseRecurringLead({
  email = 'pilot@example.com',
  workflowCount = 3,
} = {}) {
  const lead = appendWorkflowSprintLead(buildLeadPayload({
    email,
    submittedAt: '2026-07-15T12:00:00.000Z',
  }), { feedbackDir: tmpDir });
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'qualified',
    ...qualifyPayload({
      qualificationReview: qualificationReview({
        workflowCount,
        proofBackedSprint: true,
        completedEnterprisePilot: true,
        budgetCents: 1000000,
        readyToImplement: false,
      }),
    }),
  }, { feedbackDir: tmpDir, now: '2026-07-15T12:01:00.000Z' });
  return lead;
}

function prepareRecurringWorkflow({
  offerId = 'workflow_reliability_operations',
  amountCents = 300000,
  workflowCount = 1,
} = {}) {
  const lead = appendWorkflowSprintLead(buildLeadPayload({
    submittedAt: '2026-07-15T12:00:00.000Z',
  }), { feedbackDir: tmpDir });
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'qualified',
    ...qualifyPayload({
      qualificationReview: qualificationReview({
        workflowCount,
        proofBackedSprint: true,
        completedEnterprisePilot: offerId === 'enterprise_reliability_operations',
        budgetCents: amountCents,
        readyToImplement: false,
      }),
    }),
  }, {
    feedbackDir: tmpDir,
    now: '2026-07-15T12:01:00.000Z',
  });
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'named_pilot',
    ...signedScope({
      agreementRef: `recurring_scope_${lead.leadId}`,
      agreementOfferId: offerId,
      agreementAmountCents: amountCents,
      agreementWorkflowCount: workflowCount,
      ...(offerId === 'enterprise_reliability_operations' ? {
        agreementPriorPilotRef: 'completed_enterprise_pilot',
        agreementPriorPilotDigest: `sha256:${'d'.repeat(64)}`,
      } : {}),
    }),
  }, { feedbackDir: tmpDir, now: '2026-07-15T12:02:00.000Z' });
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'proof_backed_run',
    proofArtifacts: ['proof/recurring-operation.json'],
  }, { feedbackDir: tmpDir, now: '2026-07-15T12:03:00.000Z' });
  return lead;
}

function advanceInChild(payload) {
  const modulePath = path.resolve(__dirname, '../scripts/workflow-sprint-intake.js');
  const script = [
    `const { advanceWorkflowSprintLead } = require(${JSON.stringify(modulePath)});`,
    'try {',
    '  const result = advanceWorkflowSprintLead(JSON.parse(process.argv[1]), { feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR });',
    '  process.stdout.write(JSON.stringify({ ok: true, status: result.lead.status }));',
    '} catch (error) {',
    '  process.stderr.write(error.message);',
    '  process.exitCode = 1;',
    '}',
  ].join('\n');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script, JSON.stringify(payload)], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, THUMBGATE_FEEDBACK_DIR: tmpDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
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

test('evidence review can qualify a sparse diagnostic intake without silently upselling it', () => {
  const lead = appendWorkflowSprintLead({
    email: 'diagnostic-buyer@example.com',
    workflow: 'Release approval workflow',
    urgency: 'A repeated approval failure happened this week.',
    planId: 'diagnostic',
    ctaId: 'diagnostic_page_intake',
  }, { feedbackDir: tmpDir });

  const result = advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'qualified',
    ...qualifyPayload({
      qualificationReview: qualificationReview({
        decisionAuthority: 'The workflow owner can approve the diagnostic.',
        severityAndFrequency: 'An unapproved action repeated twice this week.',
        offerFit: 'The requested bounded diagnostic is the appropriate first step.',
        budgetCents: 49900,
        readyToImplement: false,
      }),
    }),
  }, { feedbackDir: tmpDir });

  assert.equal(result.lead.status, 'qualified');
  assert.equal(result.lead.offer, 'workflow_hardening_diagnostic');
  assert.equal(result.lead.qualification.owner, null);
  assert.equal(result.lead.qualification.blocker, null);
  assert.equal(result.lead.qualificationReview.evidenceBased, true);
  assert.equal(result.lead.qualificationReview.decision, 'start_diagnostic');
  assert.equal(
    result.lead.qualificationReview.recommendedOfferId,
    'workflow_hardening_diagnostic'
  );
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

test('qualified transition requires a complete evidence-based zero-spend review', () => {
  const lead = appendWorkflowSprintLead(buildLeadPayload(), { feedbackDir: tmpDir });
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'qualified',
  }, { feedbackDir: tmpDir }), /complete qualification review/i);
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'qualified',
    ...qualifyPayload({
      qualificationReview: qualificationReview({ zeroSpendStatus: 'hold_unverified_cost' }),
    }),
  }, { feedbackDir: tmpDir }), /zeroSpendStatus=proceed_zero_cost/i);
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'qualified',
    ...qualifyPayload({
      qualificationReview: qualificationReview({ evidenceReferences: ['REPLACE_WITH_THREAD'] }),
    }),
  }, { feedbackDir: tmpDir }), /actual qualification evidence/i);
  assert.equal(loadWorkflowSprintLeads(tmpDir)[0].status, 'new');
});

test('qualification integrity rejects a hand-edited evidenceBased flag and redacts evidence secrets', () => {
  assert.equal(isEvidenceBasedQualificationReview({ evidenceBased: true }), false);

  const lead = appendWorkflowSprintLead(buildLeadPayload(), { feedbackDir: tmpDir });
  const qualified = advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'qualified',
    ...qualifyPayload({
      qualificationReview: qualificationReview({
        // Assemble the synthetic token at runtime so secret scanners never see a
        // credential-shaped literal in source control.
        evidenceReferences: [`stripe ${['sk', 'live', 'synthetic', 'fixture'].join('_')}`],
      }),
    }),
  }, { feedbackDir: tmpDir });
  assert.equal(isEvidenceBasedQualificationReview(qualified.lead.qualificationReview), true);
  assert.equal(isEvidenceBasedQualificationReview({
    ...qualified.lead.qualificationReview,
    recommendedOfferId: 'enterprise_reliability_operations',
  }), false);
  assert.equal(qualified.lead.qualificationReview.evidenceReferences[0].includes('sk_live_'), false);
  assert.match(qualified.lead.qualificationReview.evidenceReferences[0], /REDACTED/);
});

test('later workflow states reject a legacy qualified label without inherited qualification evidence', () => {
  const lead = appendWorkflowSprintLead(buildLeadPayload(), { feedbackDir: tmpDir });
  appendWorkflowSprintLeadSnapshot({
    ...lead,
    status: 'qualified',
    workflowProgress: { ...lead.workflowProgress, qualifiedAt: new Date().toISOString() },
  }, tmpDir);
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'named_pilot',
    ...signedScope(),
  }, { feedbackDir: tmpDir }), /inherited evidence-based buyer qualification review/i);
});

test('workflow transitions ignore invalid injected clock values and persist a server timestamp', () => {
  const lead = appendWorkflowSprintLead(buildLeadPayload(), { feedbackDir: tmpDir });
  const result = advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'qualified',
    ...qualifyPayload(),
  }, { feedbackDir: tmpDir, now: 'not-a-timestamp' });

  assert.notEqual(result.lead.updatedAt, 'not-a-timestamp');
  assert.equal(Number.isNaN(new Date(result.lead.updatedAt).getTime()), false);
  assert.equal(result.lead.workflowProgress.qualifiedAt, result.lead.updatedAt);
});

test('advanceWorkflowSprintLead appends snapshots and workflow runs for the proof-backed pipeline', async () => {
  const lead = appendWorkflowSprintLead(buildLeadPayload(), { feedbackDir: tmpDir });

  const qualified = advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'qualified',
    actor: 'ops',
    note: 'Qualified for pilot review.',
    ...qualifyPayload(),
  }, { feedbackDir: tmpDir });
  assert.equal(qualified.workflowRun, null);

  const namedPilot = advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'named_pilot',
    actor: 'ops',
    workflowId: 'pr_review_hardening',
    teamId: 'north_star_systems',
    ...signedScope(),
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

  const paidSalesLead = await addVerifiedPaidSalesLead();
  const paidTeam = advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    actor: 'ops',
    salesLeadId: paidSalesLead.leadId,
  }, { feedbackDir: tmpDir });
  assert.equal(paidTeam.lead.status, 'paid_team');
  assert.ok(paidTeam.workflowRun);
  assert.equal(paidTeam.workflowRun.customerType, 'paid_team');
  assert.equal(paidTeam.workflowRun.proofBacked, true);

  const leads = loadWorkflowSprintLeads(tmpDir);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].status, 'paid_team');
  assert.equal(leads[0].statusHistory.length, 5);
  assert.equal(leads[0].qualificationReview.evidenceBased, true);
  assert.equal(leads[0].qualificationReview.decision, 'scope_sprint');
  assert.equal(leads[0].qualificationReview.recommendedOfferId, 'workflow_hardening_sprint');
  assert.deepEqual(leads[0].qualificationReview.evidenceReferences, ['intake:workflow-sprint-test']);
  assert.equal(leads[0].attribution.creator, 'reach_vb');
  assert.ok(leads[0].workflowProgress.qualifiedAt);
  assert.ok(leads[0].workflowProgress.namedPilotAt);
  assert.ok(leads[0].workflowProgress.proofBackedRunAt);
  assert.ok(leads[0].workflowProgress.paidTeamAt);
  assert.equal(leads[0].proof.reviewedBy, 'buyer@example.com');
  assert.deepEqual(leads[0].proof.artifacts, ['docs/VERIFICATION_EVIDENCE.md']);
  assert.equal(leads[0].commercialProof.scope.reference, 'envelope_signed_123');
  assert.equal(leads[0].commercialProof.scope.offerId, 'workflow_hardening_sprint');
  assert.equal(leads[0].commercialProof.scope.amountCents, 150000);
  assert.equal(leads[0].commercialProof.scope.digest, SCOPE_DIGEST);
  assert.equal(leads[0].commercialProof.payment.salesLeadId, paidSalesLead.leadId);
  assert.equal(leads[0].commercialProof.payment.amountCents, 150000);
  assert.equal(leads[0].commercialProof.payment.provider, 'paypal');
  assert.equal(leads[0].commercialProof.payment.verified, true);
  assert.equal(leads[0].commercialProof.payment.buyerEmailMatch, true);

  const commercialAudit = auditWorkflowCommercialProof(leads, loadSalesLeads({ feedbackDir: tmpDir }));
  assert.equal(commercialAudit.ok, true);
  assert.equal(
    commercialAudit.scopeEvidenceMode,
    'local_reference_and_sha256_digest_not_remote_contract_platform_verification',
  );
  assert.equal(commercialAudit.verifiedPaidTeamCount, 1);
  assert.equal(commercialAudit.byOffer.workflow_hardening_sprint, 1);
  assert.equal(commercialAudit.verifiedRecurringCount, 0);
  assert.equal(commercialAudit.verifiedEnterpriseCount, 0);
  assert.equal(
    commercialAudit.results[0].scopeEvidenceMode,
    'local_reference_and_sha256_digest_not_remote_contract_platform_verification',
  );

  const missingQualificationReview = structuredClone(leads[0]);
  missingQualificationReview.qualificationReview = {};
  const missingReviewAudit = auditWorkflowCommercialProof(
    [missingQualificationReview],
    loadSalesLeads({ feedbackDir: tmpDir })
  );
  assert.equal(missingReviewAudit.ok, false);
  assert.match(missingReviewAudit.results[0].reason, /qualification review/i);

  const forgedQualificationReview = structuredClone(leads[0]);
  forgedQualificationReview.qualificationReview = { evidenceBased: true };
  const forgedReviewAudit = auditWorkflowCommercialProof(
    [forgedQualificationReview],
    loadSalesLeads({ feedbackDir: tmpDir })
  );
  assert.equal(forgedReviewAudit.ok, false);
  assert.match(forgedReviewAudit.results[0].reason, /qualification review/i);

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
    ...qualifyPayload(),
  }, { feedbackDir: tmpDir });
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'named_pilot',
    actor: 'ops',
    ...signedScope({
      agreementSource: 'buyer_email',
      agreementRef: 'message_accepted_scope_123',
    }),
  }, { feedbackDir: tmpDir });

  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'proof_backed_run',
    actor: 'ops',
  }, { feedbackDir: tmpDir }), /requires reviewedBy or proofArtifacts/);
});

test('named pilot requires accepted-scope evidence instead of an operator label', () => {
  const lead = appendWorkflowSprintLead(buildLeadPayload(), { feedbackDir: tmpDir });
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'qualified',
    actor: 'ops',
    ...qualifyPayload(),
  }, { feedbackDir: tmpDir });

  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'named_pilot',
    actor: 'ops',
  }, { feedbackDir: tmpDir }), /requires an offer-attributed accepted scope/);

  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'named_pilot',
    actor: 'ops',
    ...signedScope({ agreementRef: 'REPLACE_WITH_ENVELOPE' }),
  }, { feedbackDir: tmpDir }), /Replace agreement evidence placeholders/);
});

test('signed scope rejects unsupported offers, price drift, missing digests, and invalid enterprise bounds', () => {
  const cases = [
    [signedScope({ agreementDigest: null }), /digest/i],
    [signedScope({ agreementOfferId: 'pro', agreementAmountCents: 1900 }), /supported fixed-scope service offer/i],
    [signedScope({ agreementAmountCents: 149999 }), /full catalog price or the documented diagnostic-credit balance/i],
    [signedScope({
      agreementOfferId: 'enterprise_governance_pilot',
      agreementAmountCents: 1500000,
      agreementWorkflowCount: 1,
    }), /two or three workflows/i],
    [signedScope({
      agreementOfferId: 'enterprise_reliability_operations',
      agreementAmountCents: 1000000,
      agreementWorkflowCount: 3,
    }), /completed-pilot reference/i],
  ];

  for (const [scope, expected] of cases) {
    const lead = appendWorkflowSprintLead(buildLeadPayload(), { feedbackDir: tmpDir });
    advanceWorkflowSprintLead({ leadId: lead.leadId, status: 'qualified', ...qualifyPayload() }, { feedbackDir: tmpDir });
    assert.throws(() => advanceWorkflowSprintLead({
      leadId: lead.leadId,
      status: 'named_pilot',
      ...scope,
    }, { feedbackDir: tmpDir }), expected);
  }
});

test('paid team requires a reconciled paid sales lead and inherits signed scope', async () => {
  const lead = appendWorkflowSprintLead(buildLeadPayload(), { feedbackDir: tmpDir });
  advanceWorkflowSprintLead({ leadId: lead.leadId, status: 'qualified', ...qualifyPayload() }, { feedbackDir: tmpDir });
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'named_pilot',
    ...signedScope({ agreementRef: 'envelope_paid_gate' }),
  }, { feedbackDir: tmpDir });
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'proof_backed_run',
    proofArtifacts: ['proof/pilot.json'],
  }, { feedbackDir: tmpDir });

  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
  }, { feedbackDir: tmpDir }), /requires salesLeadId/);

  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: 'missing_sales_lead',
  }, { feedbackDir: tmpDir }), /unknown sales lead/);

  const targeted = addSalesLead({
    leadId: 'sales_not_paid',
    source: 'direct',
  }, { feedbackDir: tmpDir });
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: targeted.leadId,
  }, { feedbackDir: tmpDir }), /requires a sales lead at paid/);

  const wrongBuyer = await addVerifiedPaidSalesLead('sales_wrong_buyer', { email: 'other@example.com' });
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: wrongBuyer.leadId,
  }, { feedbackDir: tmpDir }), /buyer email to match/);

  const wrongOffer = await addVerifiedPaidSalesLead('sales_wrong_offer', { offer: 'pro', amountCents: 1900 });
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: wrongOffer.leadId,
  }, { feedbackDir: tmpDir }), /offer to match/);

  await assert.rejects(
    addVerifiedPaidSalesLead('sales_wrong_amount', { amountCents: 149999 }),
    /amount has no exact ThumbGate offer/
  );

  const paid = await addVerifiedPaidSalesLead('sales_verified_paid');
  const result = advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: paid.leadId,
  }, { feedbackDir: tmpDir });
  assert.equal(result.lead.status, 'paid_team');
  assert.equal(result.lead.commercialProof.payment.reference, 'capture_sales_verified_paid');
  assert.equal(result.workflowRun.metadata.paymentEvidenceSource, 'provider_api_live:test-paypal-reconciliation');

  const secondLead = appendWorkflowSprintLead(buildLeadPayload(), { feedbackDir: tmpDir });
  advanceWorkflowSprintLead({ leadId: secondLead.leadId, status: 'qualified', ...qualifyPayload() }, { feedbackDir: tmpDir });
  advanceWorkflowSprintLead({
    leadId: secondLead.leadId,
    status: 'named_pilot',
    ...signedScope({ agreementRef: 'second_scope_same_payment' }),
  }, { feedbackDir: tmpDir });
  advanceWorkflowSprintLead({
    leadId: secondLead.leadId,
    status: 'proof_backed_run',
    proofArtifacts: ['proof/second-scope.json'],
  }, { feedbackDir: tmpDir });
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: secondLead.leadId,
    status: 'paid_team',
    salesLeadId: paid.leadId,
  }, { feedbackDir: tmpDir }), /already assigned to another workflow contract/);

  const duplicatePayment = structuredClone(result.lead);
  duplicatePayment.leadId = 'tampered_duplicate_payment_contract';
  const duplicateAudit = auditWorkflowCommercialProof(
    [result.lead, duplicatePayment],
    loadSalesLeads({ feedbackDir: tmpDir })
  );
  assert.equal(duplicateAudit.ok, false);
  assert.equal(duplicateAudit.unverifiedPaidTeamCount, 2);
  assert.match(duplicateAudit.results[0].reason, /multiple workflow contracts/);

  const tampered = structuredClone(result.lead);
  tampered.commercialProof.payment.amountCents = 1900;
  const tamperedAudit = auditWorkflowCommercialProof([tampered], loadSalesLeads({ feedbackDir: tmpDir }));
  assert.equal(tamperedAudit.ok, false);
  assert.equal(tamperedAudit.unverifiedPaidTeamCount, 1);
  assert.match(tamperedAudit.results[0].reason, /do not reconcile exactly/);
});

test('completed enterprise recurring scope is counted only after exact signed-scope and payment reconciliation', async () => {
  const completedPilot = await createCompletedEnterprisePilot();
  assert.equal(completedPilot.evidence.verified, true);
  assert.equal(completedPilot.evidence.reference, completedPilot.pilot.leadId);
  assert.match(completedPilot.evidence.digest, /^sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(completedPilot.evidence.evidence), /pilot@example\.com/);
  assert.doesNotMatch(JSON.stringify(completedPilot.evidence.evidence), /enterprise-governance-pilot\.json/);
  assert.equal(completedPilot.evidence.evidence.proofArtifactCount, 1);
  assert.match(completedPilot.evidence.evidence.proofArtifactDigests[0], /^sha256:[a-f0-9]{64}$/);

  const lead = createQualifiedEnterpriseRecurringLead();
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'named_pilot',
    ...signedScope({
      agreementRef: 'enterprise_ops_signed_1',
      agreementOfferId: 'enterprise_reliability_operations',
      agreementAmountCents: 1000000,
      agreementWorkflowCount: 3,
      agreementPriorPilotRef: completedPilot.evidence.reference,
      agreementPriorPilotDigest: completedPilot.evidence.digest,
    }),
  }, { feedbackDir: tmpDir, now: '2026-07-15T12:02:00.000Z' });
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'proof_backed_run',
    proofArtifacts: ['proof/enterprise-pilot-completed.json'],
  }, { feedbackDir: tmpDir, now: '2026-07-15T12:03:00.000Z' });
  const paid = await addVerifiedPaidSalesLead('sales_enterprise_ops', {
    offer: 'enterprise_reliability_operations',
    amountCents: 1000000,
  });
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: paid.leadId,
    billingPeriodStart: '2026-07-16T00:00:00.000Z',
    billingPeriodEnd: '2026-08-15T00:00:00.000Z',
  }, { feedbackDir: tmpDir, now: '2026-07-16T13:00:00.000Z' });

  const audit = auditWorkflowCommercialProof(
    loadWorkflowSprintLeads(tmpDir),
    loadSalesLeads({ feedbackDir: tmpDir }),
    { now: '2026-07-16T13:00:00.000Z' }
  );
  assert.equal(audit.ok, true);
  assert.equal(audit.verifiedRecurringCount, 1);
  assert.equal(audit.verifiedEnterpriseCount, 2);
  assert.equal(audit.byOffer.enterprise_governance_pilot, 1);
  assert.equal(audit.byOffer.enterprise_reliability_operations, 1);
  assert.equal(audit.verifiedRevenueCents, 2500000);

  const tampered = structuredClone(loadWorkflowSprintLeads(tmpDir)
    .find((entry) => entry.leadId === lead.leadId));
  tampered.commercialProof.scope.priorPilotDigest = `sha256:${'f'.repeat(64)}`;
  const rejected = auditWorkflowCommercialProof(
    [completedPilot.pilot, tampered],
    loadSalesLeads({ feedbackDir: tmpDir }),
    { now: '2026-07-16T13:00:00.000Z' }
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.unverifiedPaidTeamCount, 1);
  assert.match(rejected.results.find((entry) => entry.leadId === lead.leadId).reason, /digest does not match/);
});

test('enterprise recurring scope rejects fabricated, wrong-buyer, unproven, oversized, and late pilot lineage', async () => {
  const validPilot = await createCompletedEnterprisePilot();

  const fabricated = createQualifiedEnterpriseRecurringLead();
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: fabricated.leadId,
    status: 'named_pilot',
    ...signedScope({
      agreementOfferId: 'enterprise_reliability_operations',
      agreementAmountCents: 1000000,
      agreementWorkflowCount: 3,
      agreementPriorPilotRef: 'fabricated_enterprise_pilot',
      agreementPriorPilotDigest: `sha256:${'d'.repeat(64)}`,
    }),
  }, { feedbackDir: tmpDir, now: '2026-07-15T12:02:00.000Z' }), /workflow fabricated_enterprise_pilot is missing/);

  const wrongBuyer = createQualifiedEnterpriseRecurringLead({ email: 'other@example.com' });
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: wrongBuyer.leadId,
    status: 'named_pilot',
    ...signedScope({
      agreementOfferId: 'enterprise_reliability_operations',
      agreementAmountCents: 1000000,
      agreementWorkflowCount: 3,
      agreementPriorPilotRef: validPilot.evidence.reference,
      agreementPriorPilotDigest: validPilot.evidence.digest,
    }),
  }, { feedbackDir: tmpDir, now: '2026-07-15T12:02:00.000Z' }), /same normalized buyer email/);

  const unprovenPilot = await createCompletedEnterprisePilot({
    proofArtifacts: [],
    salesLeadId: 'sales_enterprise_pilot_unproven',
  });
  assert.equal(unprovenPilot.evidence.verified, false);
  const unproven = createQualifiedEnterpriseRecurringLead();
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: unproven.leadId,
    status: 'named_pilot',
    ...signedScope({
      agreementOfferId: 'enterprise_reliability_operations',
      agreementAmountCents: 1000000,
      agreementWorkflowCount: 3,
      agreementPriorPilotRef: unprovenPilot.pilot.leadId,
      agreementPriorPilotDigest: `sha256:${'e'.repeat(64)}`,
    }),
  }, { feedbackDir: tmpDir, now: '2026-07-15T12:02:00.000Z' }), /lacks a proof artifact/);

  const twoWorkflowPilot = await createCompletedEnterprisePilot({
    workflowCount: 2,
    salesLeadId: 'sales_enterprise_pilot_two_workflows',
  });
  const oversized = createQualifiedEnterpriseRecurringLead({ workflowCount: 3 });
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: oversized.leadId,
    status: 'named_pilot',
    ...signedScope({
      agreementOfferId: 'enterprise_reliability_operations',
      agreementAmountCents: 1000000,
      agreementWorkflowCount: 3,
      agreementPriorPilotRef: twoWorkflowPilot.evidence.reference,
      agreementPriorPilotDigest: twoWorkflowPilot.evidence.digest,
    }),
  }, { feedbackDir: tmpDir, now: '2026-07-15T12:02:00.000Z' }), /cannot cover more workflows/);

  const earlyScope = createQualifiedEnterpriseRecurringLead();
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: earlyScope.leadId,
    status: 'named_pilot',
    ...signedScope({
      agreementSignedAt: '2026-07-14T10:01:30.000Z',
      agreementOfferId: 'enterprise_reliability_operations',
      agreementAmountCents: 1000000,
      agreementWorkflowCount: 3,
      agreementPriorPilotRef: validPilot.evidence.reference,
      agreementPriorPilotDigest: validPilot.evidence.digest,
    }),
  }, { feedbackDir: tmpDir, now: '2026-07-15T12:02:00.000Z' }), /must be completed before the recurring scope is signed/);
});

test('paid team revalidates completed Enterprise pilot lineage after durable pilot tampering', async () => {
  const completedPilot = await createCompletedEnterprisePilot();
  const lead = createQualifiedEnterpriseRecurringLead();
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'named_pilot',
    ...signedScope({
      agreementOfferId: 'enterprise_reliability_operations',
      agreementAmountCents: 1000000,
      agreementWorkflowCount: 3,
      agreementPriorPilotRef: completedPilot.evidence.reference,
      agreementPriorPilotDigest: completedPilot.evidence.digest,
    }),
  }, { feedbackDir: tmpDir, now: '2026-07-15T12:02:00.000Z' });
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'proof_backed_run',
    proofArtifacts: ['proof/enterprise-recurring.json'],
  }, { feedbackDir: tmpDir, now: '2026-07-15T12:03:00.000Z' });

  appendWorkflowSprintLeadSnapshot({
    ...completedPilot.pilot,
    updatedAt: '2026-07-15T12:03:30.000Z',
    proof: {
      ...completedPilot.pilot.proof,
      artifacts: completedPilot.pilot.proof.artifacts.concat('proof/unreviewed-state-edit.json'),
    },
  }, tmpDir);
  const paid = await addVerifiedPaidSalesLead('sales_enterprise_ops_after_pilot_tamper', {
    offer: 'enterprise_reliability_operations',
    amountCents: 1000000,
  });
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: paid.leadId,
    billingPeriodStart: '2026-07-16T00:00:00.000Z',
    billingPeriodEnd: '2026-08-15T00:00:00.000Z',
  }, { feedbackDir: tmpDir, now: '2026-07-16T13:00:00.000Z' }), /digest does not match the canonical paid pilot record/);
  assert.equal(loadWorkflowSprintLeads(tmpDir)
    .find((entry) => entry.leadId === lead.leadId).status, 'proof_backed_run');
});

test('Stripe invoice evidence can satisfy the exact recurring commercial-proof gate', async () => {
  const lead = prepareRecurringWorkflow();
  const paid = await addVerifiedStripePaidSalesLead('sales_stripe_recurring', {
    invoiceId: 'in_thumbgate_recurring_2026_07',
  });
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: paid.leadId,
    billingPeriodStart: '2026-07-16T00:00:00.000Z',
    billingPeriodEnd: '2026-08-15T00:00:00.000Z',
  }, { feedbackDir: tmpDir, now: '2026-07-16T13:00:00.000Z' });

  const audit = auditWorkflowCommercialProof(
    loadWorkflowSprintLeads(tmpDir),
    loadSalesLeads({ feedbackDir: tmpDir }),
    { now: '2026-07-16T13:00:00.000Z' }
  );

  assert.equal(audit.ok, true);
  assert.equal(audit.verifiedRecurringCount, 1);
  assert.equal(audit.results[0].providerInvoiceId, 'in_thumbgate_recurring_2026_07');
  assert.equal(audit.results[0].paymentDigest, paid.history.at(-1).evidence.digest);
});

test('recurring paid-team proof rejects missing provider invoice IDs and implausible billing periods', async () => {
  const lead = prepareRecurringWorkflow();
  const missingInvoice = await addVerifiedPaidSalesLead('sales_recurring_missing_invoice', {
    offer: 'workflow_reliability_operations',
    amountCents: 300000,
    includeInvoiceId: false,
  });
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: missingInvoice.leadId,
    billingPeriodStart: '2026-07-16T00:00:00.000Z',
    billingPeriodEnd: '2026-08-15T00:00:00.000Z',
  }, { feedbackDir: tmpDir, now: '2026-07-16T13:00:00.000Z' }), /provider-authenticated invoice ID/);

  const shortPeriod = await addVerifiedPaidSalesLead('sales_recurring_short_period', {
    offer: 'workflow_reliability_operations',
    amountCents: 300000,
  });
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: shortPeriod.leadId,
    billingPeriodStart: '2026-07-16T00:00:00.000Z',
    billingPeriodEnd: '2026-08-05T00:00:00.000Z',
  }, { feedbackDir: tmpDir, now: '2026-07-16T13:00:00.000Z' }), /between 27 and 32 days/);

  const unrelatedPeriod = await addVerifiedPaidSalesLead('sales_recurring_unrelated_period', {
    offer: 'workflow_reliability_operations',
    amountCents: 300000,
  });
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: unrelatedPeriod.leadId,
    billingPeriodStart: '2026-08-01T00:00:00.000Z',
    billingPeriodEnd: '2026-08-31T00:00:00.000Z',
  }, { feedbackDir: tmpDir, now: '2026-08-01T12:00:00.000Z' }), /payment must fall within the billing period or its seven-day prepayment window/);

  const futurePayment = await addVerifiedPaidSalesLead('sales_recurring_future_payment', {
    offer: 'workflow_reliability_operations',
    amountCents: 300000,
    createdAt: '2026-07-20T00:00:00.000Z',
    auditGeneratedAt: '2026-07-20T01:00:00.000Z',
  });
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: futurePayment.leadId,
    billingPeriodStart: '2026-07-20T00:00:00.000Z',
    billingPeriodEnd: '2026-08-19T00:00:00.000Z',
    now: '2099-01-01T00:00:00.000Z',
    timestamp: '2099-01-01T00:00:00.000Z',
  }, { feedbackDir: tmpDir, now: '2026-07-19T23:59:59.000Z' }), /cannot be later than the recurring-proof evaluation time/);
  assert.equal(loadWorkflowSprintLeads(tmpDir)[0].status, 'proof_backed_run');
});

test('current recurring proof expires from the active milestone without erasing verified history', async () => {
  const lead = prepareRecurringWorkflow();
  const paid = await addVerifiedPaidSalesLead('sales_recurring_active', {
    offer: 'workflow_reliability_operations',
    amountCents: 300000,
    invoiceId: 'thumbgate-recurring-active-2026-07',
  });
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: paid.leadId,
    billingPeriodStart: '2026-07-16T00:00:00.000Z',
    billingPeriodEnd: '2026-08-15T00:00:00.000Z',
  }, { feedbackDir: tmpDir, now: '2026-07-20T12:00:00.000Z' });
  const active = auditWorkflowCommercialProof(
    loadWorkflowSprintLeads(tmpDir),
    loadSalesLeads({ feedbackDir: tmpDir }),
    { now: '2026-07-20T12:00:00.000Z' }
  );
  const expired = auditWorkflowCommercialProof(
    loadWorkflowSprintLeads(tmpDir),
    loadSalesLeads({ feedbackDir: tmpDir }),
    { now: '2026-08-15T00:00:00.000Z' }
  );

  assert.equal(active.verifiedRecurringCount, 1);
  assert.equal(active.historicalRecurringCount, 0);
  assert.equal(active.verifiedRecurringRevenueCents, 300000);
  assert.equal(active.results[0].providerInvoiceId, 'thumbgate-recurring-active-2026-07');
  assert.equal(expired.ok, true);
  assert.equal(expired.verifiedPaidTeamCount, 1);
  assert.equal(expired.verifiedRecurringCount, 0);
  assert.equal(expired.historicalRecurringCount, 1);
  assert.equal(expired.verifiedRecurringRevenueCents, 0);
  assert.match(expired.results[0].recurringReason, /outside its active billing period/);
});

test('provider-paid prepayments remain scheduled until the recurring billing period starts', async () => {
  const lead = prepareRecurringWorkflow();
  const paid = await addVerifiedPaidSalesLead('sales_recurring_scheduled', {
    offer: 'workflow_reliability_operations',
    amountCents: 300000,
    invoiceId: 'thumbgate-recurring-scheduled-2026-07',
    createdAt: '2026-07-16T12:00:00.000Z',
    auditGeneratedAt: '2026-07-17T12:00:00.000Z',
  });
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: paid.leadId,
    billingPeriodStart: '2026-07-20T00:00:00.000Z',
    billingPeriodEnd: '2026-08-19T00:00:00.000Z',
  }, { feedbackDir: tmpDir, now: '2026-07-17T12:00:00.000Z' });

  const scheduled = auditWorkflowCommercialProof(
    loadWorkflowSprintLeads(tmpDir),
    loadSalesLeads({ feedbackDir: tmpDir }),
    { now: '2026-07-17T12:00:00.000Z' }
  );
  const active = auditWorkflowCommercialProof(
    loadWorkflowSprintLeads(tmpDir),
    loadSalesLeads({ feedbackDir: tmpDir }),
    { now: '2026-07-20T00:00:00.000Z' }
  );

  assert.equal(scheduled.ok, true);
  assert.equal(scheduled.verifiedRecurringCount, 0);
  assert.equal(scheduled.historicalRecurringCount, 0);
  assert.equal(scheduled.scheduledRecurringCount, 1);
  assert.match(scheduled.results[0].recurringReason, /has not started/);
  assert.equal(active.verifiedRecurringCount, 1);
  assert.equal(active.scheduledRecurringCount, 0);
});

test('recurring renewal requires a new provider-paid sales lead and preserves every billing-period receipt', async () => {
  const lead = prepareRecurringWorkflow();
  const firstPayment = await addVerifiedPaidSalesLead('sales_recurring_2026_07', {
    offer: 'workflow_reliability_operations',
    amountCents: 300000,
    invoiceId: 'thumbgate-recurring-2026-07',
  });
  const first = advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: firstPayment.leadId,
    billingPeriodStart: '2026-07-16T00:00:00.000Z',
    billingPeriodEnd: '2026-08-15T00:00:00.000Z',
  }, { feedbackDir: tmpDir, now: '2026-07-16T13:00:00.000Z' });
  const secondPayment = await addVerifiedPaidSalesLead('sales_recurring_2026_08', {
    offer: 'workflow_reliability_operations',
    amountCents: 300000,
    invoiceId: 'thumbgate-recurring-2026-08',
    createdAt: '2026-08-15T12:00:00.000Z',
    auditGeneratedAt: '2026-08-15T13:00:00.000Z',
  });
  const renewed = advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: secondPayment.leadId,
    billingPeriodStart: '2026-08-15T00:00:00.000Z',
    billingPeriodEnd: '2026-09-14T00:00:00.000Z',
  }, { feedbackDir: tmpDir, now: '2026-08-15T13:00:00.000Z' });
  const snapshots = loadWorkflowSprintLeadSnapshots(tmpDir);
  const audit = auditWorkflowCommercialProof(
    loadWorkflowSprintLeads(tmpDir),
    loadSalesLeads({ feedbackDir: tmpDir }),
    { now: '2026-08-15T13:00:00.000Z', workflowSnapshots: snapshots }
  );

  assert.equal(first.lead.workflowProgress.paidTeamAt, '2026-07-16T13:00:00.000Z');
  assert.equal(renewed.lead.workflowProgress.paidTeamAt, first.lead.workflowProgress.paidTeamAt);
  assert.equal(renewed.lead.workflowProgress.lastRecurringPaymentAt, '2026-08-15T13:00:00.000Z');
  assert.equal(renewed.lead.commercialProof.payment.salesLeadId, secondPayment.leadId);
  assert.equal(renewed.lead.commercialProof.payment.invoiceId, 'thumbgate-recurring-2026-08');
  assert.equal(renewed.workflowRun.reviewed, true);
  assert.deepEqual(renewed.workflowRun.proofArtifacts, ['proof/recurring-operation.json']);
  assert.equal(snapshots.filter((snapshot) => snapshot.commercialProof.payment.salesLeadId).length, 2);
  assert.equal(audit.ok, true);
  assert.equal(audit.verifiedRecurringCount, 1);
  assert.equal(audit.replayedPaymentCount, 0);
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: firstPayment.leadId,
    billingPeriodStart: '2026-09-14T00:00:00.000Z',
    billingPeriodEnd: '2026-10-14T00:00:00.000Z',
  }, { feedbackDir: tmpDir, now: '2026-09-14T12:00:00.000Z' }), /already assigned to a prior billing period/);
});

test('concurrent workflow updates cannot assign one paid sales record to two contracts', async () => {
  const paid = await addVerifiedPaidSalesLead('sales_concurrent_contract');
  const workflowLeads = [];
  for (const suffix of ['one', 'two']) {
    const lead = appendWorkflowSprintLead(buildLeadPayload(), { feedbackDir: tmpDir });
    advanceWorkflowSprintLead({ leadId: lead.leadId, status: 'qualified', ...qualifyPayload() }, { feedbackDir: tmpDir });
    advanceWorkflowSprintLead({
      leadId: lead.leadId,
      status: 'named_pilot',
      ...signedScope({ agreementRef: `concurrent_scope_${suffix}` }),
    }, { feedbackDir: tmpDir });
    advanceWorkflowSprintLead({
      leadId: lead.leadId,
      status: 'proof_backed_run',
      proofArtifacts: [`proof/concurrent-${suffix}.json`],
    }, { feedbackDir: tmpDir });
    workflowLeads.push(lead);
  }

  const results = await Promise.all(workflowLeads.map((lead) => advanceInChild({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: paid.leadId,
  })));
  assert.equal(results.filter((result) => result.code === 0).length, 1);
  assert.equal(results.filter((result) => result.code === 1).length, 1);
  assert.match(results.find((result) => result.code === 1).stderr, /already assigned to another workflow contract/);
  assert.equal(loadWorkflowSprintLeads(tmpDir).filter((lead) => lead.status === 'paid_team').length, 1);
  assert.equal(fs.existsSync(`${getWorkflowSprintLeadsPath(tmpDir)}.commercial.lock`), false);
});

test('documented diagnostic credit requires the same buyer and a separate verified $499 payment', async () => {
  const lead = appendWorkflowSprintLead(buildLeadPayload(), { feedbackDir: tmpDir });
  const diagnostic = await addVerifiedPaidSalesLead('sales_diagnostic_credit', {
    offer: 'workflow_hardening_diagnostic',
    amountCents: 49900,
  });
  advanceWorkflowSprintLead({ leadId: lead.leadId, status: 'qualified', ...qualifyPayload() }, { feedbackDir: tmpDir });
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'named_pilot',
    ...signedScope({
      agreementRef: 'credited_sprint_scope',
      agreementAmountCents: 100100,
      agreementCreditCents: 49900,
      agreementCreditSalesLeadId: diagnostic.leadId,
    }),
  }, { feedbackDir: tmpDir });
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'proof_backed_run',
    proofArtifacts: ['proof/credited-sprint.json'],
  }, { feedbackDir: tmpDir });
  const balance = await addVerifiedPaidSalesLead('sales_sprint_balance', { amountCents: 100100 });
  const paid = advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: balance.leadId,
  }, { feedbackDir: tmpDir });

  assert.equal(paid.lead.commercialProof.scope.creditCents, 49900);
  assert.equal(paid.lead.commercialProof.payment.creditSalesLeadId, diagnostic.leadId);
  assert.equal(paid.lead.commercialProof.payment.creditPaymentReference, 'capture_sales_diagnostic_credit');
  const audit = auditWorkflowCommercialProof(
    [paid.lead],
    loadSalesLeads({ feedbackDir: tmpDir })
  );
  assert.equal(audit.ok, true);
  assert.equal(audit.verifiedPaidTeamCount, 1);

  const wrongBuyerCredit = await addVerifiedPaidSalesLead('sales_wrong_buyer_credit', {
    email: 'other@example.com',
    offer: 'workflow_hardening_diagnostic',
    amountCents: 49900,
  });
  const tampered = structuredClone(paid.lead);
  tampered.commercialProof.scope.creditSalesLeadId = wrongBuyerCredit.leadId;
  tampered.commercialProof.payment.creditSalesLeadId = wrongBuyerCredit.leadId;
  const rejected = auditWorkflowCommercialProof(
    [tampered],
    loadSalesLeads({ feedbackDir: tmpDir })
  );
  assert.equal(rejected.ok, false);
  assert.match(rejected.results[0].reason, /do not reconcile exactly/);

  const secondLead = appendWorkflowSprintLead(buildLeadPayload(), { feedbackDir: tmpDir });
  advanceWorkflowSprintLead({ leadId: secondLead.leadId, status: 'qualified', ...qualifyPayload() }, { feedbackDir: tmpDir });
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: secondLead.leadId,
    status: 'named_pilot',
    ...signedScope({
      agreementRef: 'reused_credit_scope',
      agreementAmountCents: 100100,
      agreementCreditCents: 49900,
      agreementCreditSalesLeadId: diagnostic.leadId,
    }),
  }, { feedbackDir: tmpDir }), /already assigned to another workflow scope/);

  const duplicateCredit = structuredClone(paid.lead);
  duplicateCredit.leadId = 'tampered_duplicate_credit_contract';
  duplicateCredit.commercialProof.payment.salesLeadId = 'sales_duplicate_sprint_balance';
  duplicateCredit.commercialProof.payment.reference = 'capture_sales_duplicate_sprint_balance';
  const duplicateBalance = await addVerifiedPaidSalesLead('sales_duplicate_sprint_balance', { amountCents: 100100 });
  duplicateCredit.commercialProof.payment.digest = duplicateBalance.history.at(-1).evidence.digest;
  duplicateCredit.commercialProof.payment.source = duplicateBalance.history.at(-1).evidence.source;
  const duplicateCreditAudit = auditWorkflowCommercialProof(
    [paid.lead, duplicateCredit],
    loadSalesLeads({ feedbackDir: tmpDir })
  );
  assert.equal(duplicateCreditAudit.ok, false);
  assert.equal(duplicateCreditAudit.unverifiedPaidTeamCount, 2);
  assert.match(duplicateCreditAudit.results[0].reason, /diagnostic credit.*multiple workflow contracts/i);
});

test('paid team revalidates inherited signed scope after durable-state tampering', async () => {
  const lead = appendWorkflowSprintLead(buildLeadPayload(), { feedbackDir: tmpDir });
  advanceWorkflowSprintLead({ leadId: lead.leadId, status: 'qualified', ...qualifyPayload() }, { feedbackDir: tmpDir });
  advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'named_pilot',
    ...signedScope({ agreementRef: 'tamper_test_scope' }),
  }, { feedbackDir: tmpDir });
  const proofBacked = advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'proof_backed_run',
    proofArtifacts: ['proof/before-tamper.json'],
  }, { feedbackDir: tmpDir });
  appendWorkflowSprintLeadSnapshot({
    ...proofBacked.lead,
    updatedAt: '2099-01-01T00:00:00.000Z',
    commercialProof: {
      ...proofBacked.lead.commercialProof,
      scope: {
        ...proofBacked.lead.commercialProof.scope,
        digest: 'sha256:tampered',
      },
    },
  }, tmpDir);
  const paid = await addVerifiedPaidSalesLead('sales_tamper_test');
  assert.throws(() => advanceWorkflowSprintLead({
    leadId: lead.leadId,
    status: 'paid_team',
    salesLeadId: paid.leadId,
  }, { feedbackDir: tmpDir }), /re-verifiable signed-scope evidence/);
});
