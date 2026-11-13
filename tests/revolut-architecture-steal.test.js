'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isRevolutRoutingActive,
  requiresVisionCapability,
  classifyTask,
  recommendExecutionPlan,
} = require('../scripts/model-tier-router');

const {
  calculateRevolutInferenceSavings,
} = require('../scripts/token-tco');

const {
  evaluateBankingCodeConfinement,
  BANKING_PATTERNS,
} = require('../scripts/banking-code-confinement-diode');

const {
  verifyApprovalExecutionBoundary,
  claim,
  removeLease,
} = require('../scripts/session-lease');

test('Revolut "Frontier is the Exception": activation detection', () => {
  assert.equal(isRevolutRoutingActive({}), false);
  assert.equal(isRevolutRoutingActive({}, { THUMBGATE_ROUTING_PROFILE: 'revolut' }), true);
  assert.equal(isRevolutRoutingActive({ routingProfile: 'revolut' }), true);
  assert.equal(isRevolutRoutingActive({ enterprisePolicy: 'frontier_is_exception' }), true);
  assert.equal(isRevolutRoutingActive({ tags: ['revolut', 'banking'] }), true);
});

test('Revolut routing: multimodal / vision queries route to commercial frontier', () => {
  const visionTask = {
    prompt: 'Inspect this screenshot of the payment page and find the broken checkout button',
    routingProfile: 'revolut',
  };
  assert.equal(requiresVisionCapability(visionTask), true);

  const plan = classifyTask(visionTask, { THUMBGATE_ROUTING_PROFILE: 'revolut' });
  assert.equal(plan.tier, 'frontier');
  assert.match(plan.reason, /vision query routed to commercial frontier/i);
});

test('Revolut routing: text, code, tickets, and debugging default to localFrontier ($0.30/M)', () => {
  const codeTask = {
    prompt: 'Refactor the ledger reconciliation worker and fix the race condition in transfer batching',
    routingProfile: 'revolut',
  };
  assert.equal(requiresVisionCapability(codeTask), false);

  const plan = classifyTask(codeTask, { THUMBGATE_ROUTING_PROFILE: 'revolut' });
  assert.equal(plan.tier, 'localFrontier');
  assert.equal(plan.frontierIsException, true);
  assert.equal(plan.tokenBudgetExempt, true);
  assert.equal(plan.estimatedCostPerMillion, 0.3);
  assert.match(plan.reason, /Frontier is the exception/i);
});

test('Revolut execution plan: telemetry includes 90% cost cut and lead time gains', () => {
  const task = {
    prompt: 'Write comprehensive unit tests for our currency conversion API',
    routingProfile: 'revolut',
  };
  const executionPlan = recommendExecutionPlan(task, { THUMBGATE_ROUTING_PROFILE: 'revolut' });
  assert.ok(executionPlan.revolutEconomics);
  assert.equal(executionPlan.revolutEconomics.costCutPct, 90);
  assert.equal(executionPlan.revolutEconomics.leadTimeProductivityGainPct, 70);
  assert.equal(executionPlan.revolutEconomics.codingProductivityGainPct, 60);
});

test('Revolut Enterprise Economics: models 2,000 developers on 56 B200 GPUs', () => {
  const model = calculateRevolutInferenceSavings({ developerCount: 2000 });
  assert.equal(model.organization, 'Revolut Benchmark');
  assert.equal(model.developerCount, 2000);
  assert.equal(model.totalMonthlyTokensM, 600000);
  assert.equal(model.economics.monthlyCommercialCost, 2000000);
  assert.equal(model.economics.monthlySelfHostedCost, 300000);
  assert.equal(model.economics.rawInferenceReductionPct, 91);
  assert.equal(model.economics.netCostReductionPct, 85);
  assert.equal(model.economics.annualCostSavings, 20400000);
  assert.equal(model.economics.paybackMonths, 0.8);
  assert.equal(model.productivity.codingTimeImprovementPct, 60);
  assert.equal(model.productivity.leadTimeImprovementPct, 70);
});

test('Banking Code Confinement Diode: blocks cloud egress for sensitive banking data', () => {
  // Test IBAN
  const ibanCheck = evaluateBankingCodeConfinement({
    payload: 'Transfer funds to beneficiary IBAN GB33BUKB20201555555555 immediately',
    provider: 'anthropic',
    tier: 'frontier',
  });
  assert.equal(ibanCheck.verdict, 'block');
  assert.match(ibanCheck.reason, /BLOCKED_CLOUD_EGRESS/);
  assert.ok(ibanCheck.findings.includes('financial_account_identifier'));

  // Test Core Ledger mutation
  const ledgerCheck = evaluateBankingCodeConfinement({
    payload: 'Execute settlement_batch across all pending accounts and commit ledger_entry',
    provider: 'openai',
    tier: 'frontier',
  });
  assert.equal(ledgerCheck.verdict, 'block');
  assert.match(ledgerCheck.reason, /BLOCKED_CLOUD_EGRESS/);
  assert.ok(ledgerCheck.findings.includes('core_ledger_transaction'));

  // Test Live fintech key
  const keyCheck = evaluateBankingCodeConfinement({
    payload: 'Use sk_live_FIXTURE_REDACTED_FOR_ARCHIVE to process payouts',
    provider: 'gemini',
    tier: 'frontier',
  });
  assert.equal(keyCheck.verdict, 'block');
  assert.match(keyCheck.reason, /BLOCKED_CLOUD_EGRESS/);
  assert.ok(keyCheck.findings.includes('fintech_live_credentials'));
});

test('Banking Code Confinement Diode: permits on-prem self-hosted localFrontier execution', () => {
  const localCheck = evaluateBankingCodeConfinement({
    payload: 'Execute settlement_batch across pending accounts and commit ledger_entry',
    provider: 'openai-compatible',
    tier: 'localFrontier',
  });
  assert.equal(localCheck.verdict, 'allow');
  assert.equal(localCheck.confined, true);
  assert.match(localCheck.reason, /ALLOWED_CONFINED_ON_PREM/);
});

test('Execution check at reviewer disconnect boundary: rejects stale approval generation (Tim Urista steal)', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-urista-test-'));
  const fakeGit = path.join(tempDir, '.git');
  fs.mkdirSync(fakeGit, { recursive: true });

  try {
    // 1. Worker A claims generation 1
    const claim1 = claim(tempDir, { agent: 'worker-session-A', fencingToken: 1 });
    assert.equal(claim1.ok, true);

    // 2. Reviewer approves command during generation 1
    const approvalPayload = {
      generationToken: 1,
      workerSessionId: 'worker-session-A',
      commandHash: 'sha256:abc1234',
    };

    // Immediate check passes
    const validCheck = verifyApprovalExecutionBoundary(tempDir, approvalPayload);
    assert.equal(validCheck.allowed, true);
    assert.equal(validCheck.code, 'APPROVAL_GENERATION_VALID');

    // 3. Worker A disconnects / loses lease. Worker B claims generation 2!
    removeLease(tempDir);
    const claim2 = claim(tempDir, { agent: 'worker-session-B', fencingToken: 2 });
    assert.equal(claim2.ok, true);

    // 4. Worker A wakes up and tries to execute its stale generation 1 approval
    const staleCheck = verifyApprovalExecutionBoundary(tempDir, approvalPayload);
    assert.equal(staleCheck.allowed, false);
    assert.equal(staleCheck.code, 'STALE_APPROVAL_GENERATION');
    assert.match(staleCheck.reason, /Stale approval rejected: approval generation 1 < active lease generation 2/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
