'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  classifyFailureType,
  calculateTaskOutcomeMetrics,
  normalizeTaskOutcome,
} = require('../scripts/task-outcomes');
const {
  evaluateHarnessCeiling,
  partitionAcceptedEdits,
} = require('../scripts/rrsi-regularizer');
const {
  diagnoseFailureIntervention,
  buildOmpCoordinationHonestyReport,
} = require('../scripts/omp-coordination-honesty');
const {
  auditHarnessCeiling,
  PILLARS,
} = require('../scripts/harness-ceiling-doctor');

function sampleOutcome(overrides = {}) {
  return normalizeTaskOutcome({
    taskId: 'sample-task',
    taskType: 'feature',
    goal: 'Deliver verified feature',
    status: 'completed',
    verification: {
      performed: true,
      passed: true,
      evidence: ['verified test passed'],
      unsupportedClaims: 0,
    },
    toolCalls: [{
      name: 'bash',
      contractValid: true,
      allowed: true,
      succeeded: true,
      attempts: 1,
      latencyMs: 10,
      costUsd: 0,
      sideEffect: false,
      duplicateSideEffect: false,
    }],
    policy: {
      violations: 0,
      unsafeEscapes: 0,
      falseBlocks: 0,
    },
    efficiency: {
      latencyMs: 100,
      costUsd: 0.01,
      firstAttempt: true,
    },
    ...overrides,
  });
}

test('first-signal-fires failure classification distinguishes process vs content failures', () => {
  // 1. Clean completion -> none
  const working = sampleOutcome();
  const cWorking = classifyFailureType(working);
  assert.equal(cWorking.type, 'none');

  // 2. Tool call failed -> process failure
  const toolFail = sampleOutcome({
    status: 'failed',
    toolCalls: [{
      name: 'bash',
      contractValid: true,
      allowed: true,
      succeeded: false,
      attempts: 1,
    }],
  });
  const cTool = classifyFailureType(toolFail);
  assert.equal(cTool.type, 'process');
  assert.ok(cTool.firstSignal.includes('tool_call_failed'));

  // 3. Duplicate side-effect (loop) -> process failure
  const loopFail = sampleOutcome({
    status: 'failed',
    toolCalls: [{
      name: 'file_edit',
      contractValid: true,
      allowed: true,
      succeeded: true,
      attempts: 1,
      duplicateSideEffect: true,
    }],
  });
  const cLoop = classifyFailureType(loopFail);
  assert.equal(cLoop.type, 'process');
  assert.ok(cLoop.firstSignal.includes('duplicate_side_effect'));

  // 4. Policy denied -> process failure
  const policyFail = sampleOutcome({
    status: 'failed',
    toolCalls: [{
      name: 'bash',
      contractValid: true,
      allowed: false,
      succeeded: false,
      attempts: 1,
    }],
  });
  const cPolicy = classifyFailureType(policyFail);
  assert.equal(cPolicy.type, 'process');
  assert.ok(cPolicy.firstSignal.includes('tool_policy_denied'));

  // 5. Verification failed despite mechanical completion -> content failure
  const contentFail = sampleOutcome({
    status: 'completed',
    verification: {
      performed: true,
      passed: false,
      evidence: [],
      unsupportedClaims: 0,
    },
  });
  const cContent = classifyFailureType(contentFail);
  assert.equal(cContent.type, 'content');
  assert.equal(cContent.firstSignal, 'verification_failed');

  // 6. Unsupported claims -> content failure
  const claimFail = sampleOutcome({
    status: 'completed',
    verification: {
      performed: true,
      passed: true,
      evidence: ['something'],
      unsupportedClaims: 2,
    },
  });
  const cClaim = classifyFailureType(claimFail);
  assert.equal(cClaim.type, 'content');
  assert.equal(cClaim.firstSignal, 'unsupported_claim');

  // 7. Status failed with failed verification -> process failure (status_failed before verification)
  const statusFailedWithVerif = sampleOutcome({
    status: 'failed',
    verification: {
      performed: true,
      passed: false,
      evidence: [],
      unsupportedClaims: 0,
    },
  });
  const cStatusVerif = classifyFailureType(statusFailedWithVerif);
  assert.equal(cStatusVerif.type, 'process');
  assert.equal(cStatusVerif.firstSignal, 'status_failed');

  // 8. Completed with missing evidence -> content failure
  const missingEvidenceFail = sampleOutcome({
    status: 'completed',
    verification: {
      performed: true,
      passed: true,
      evidence: [],
      unsupportedClaims: 0,
    },
  });
  const cMissingEv = classifyFailureType(missingEvidenceFail);
  assert.equal(cMissingEv.type, 'content');
  assert.equal(cMissingEv.firstSignal, 'evidence_missing');

  // 9. Explicit failure type in input is preserved in receiptHash
  const explicitProcess = sampleOutcome({ failure: { type: 'process' } });
  const explicitContent = sampleOutcome({ failure: { type: 'content' } });
  assert.notEqual(explicitProcess.receiptHash, explicitContent.receiptHash);
});

test('calculateTaskOutcomeMetrics computes failureComposition and recommends correct intervention', () => {
  // Scenario A: Process-heavy failures
  const processHeavy = [
    sampleOutcome({ taskId: 't1' }),
    sampleOutcome({
      taskId: 't2',
      status: 'failed',
      toolCalls: [{ name: 'bash', contractValid: false, allowed: true, succeeded: false, attempts: 1 }],
    }),
    sampleOutcome({
      taskId: 't3',
      status: 'failed',
      toolCalls: [{ name: 'git', contractValid: true, allowed: true, succeeded: false, attempts: 1 }],
    }),
  ];
  const mProcess = calculateTaskOutcomeMetrics(processHeavy);
  assert.equal(mProcess.failureComposition.totalFailures, 2);
  assert.equal(mProcess.failureComposition.processFailures, 2);
  assert.equal(mProcess.failureComposition.contentFailures, 0);
  assert.equal(mProcess.failureComposition.processFailureRate, 1.0);
  assert.equal(mProcess.failureComposition.contentFailureRate, 0.0);
  assert.equal(mProcess.failureComposition.harnessCeiling, false);
  assert.equal(mProcess.failureComposition.recommendedIntervention, 'harness_evolution');

  // Scenario B: Content-heavy failures (harness ceiling hit)
  const contentHeavy = [
    sampleOutcome({ taskId: 'c1' }),
    sampleOutcome({
      taskId: 'c2',
      status: 'completed',
      verification: { performed: true, passed: false, evidence: [], unsupportedClaims: 0 },
    }),
    sampleOutcome({
      taskId: 'c3',
      status: 'completed',
      verification: { performed: true, passed: false, evidence: [], unsupportedClaims: 0 },
    }),
    sampleOutcome({
      taskId: 'c4',
      status: 'completed',
      verification: { performed: true, passed: false, evidence: [], unsupportedClaims: 1 },
    }),
  ];
  const mContent = calculateTaskOutcomeMetrics(contentHeavy);
  assert.equal(mContent.failureComposition.totalFailures, 3);
  assert.equal(mContent.failureComposition.processFailures, 0);
  assert.equal(mContent.failureComposition.contentFailures, 3);
  assert.equal(mContent.failureComposition.processFailureRate, 0.0);
  assert.equal(mContent.failureComposition.contentFailureRate, 1.0);
  assert.equal(mContent.failureComposition.harnessCeiling, true);
  assert.equal(mContent.failureComposition.recommendedIntervention, 'weight_training_or_model_escalation');
});

test('evaluateHarnessCeiling identifies asymptotic limit and switches lever', () => {
  // 1. Process failures active: harness evolution recommended
  const activeProcess = evaluateHarnessCeiling({
    failureComposition: {
      totalFailures: 10,
      processFailures: 5,
      contentFailures: 5,
      processFailureRate: 0.5,
      contentFailureRate: 0.5,
    },
  });
  assert.equal(activeProcess.ceilingDetected, false);
  assert.equal(activeProcess.recommendation, 'harness_evolution');

  // 2. Content failures dominate (arXiv:2610.11655 ceiling): weight training / model escalation recommended
  const ceiling = evaluateHarnessCeiling({
    failureComposition: {
      totalFailures: 10,
      processFailures: 1,
      contentFailures: 9,
      processFailureRate: 0.1,
      contentFailureRate: 0.9,
    },
  });
  assert.equal(ceiling.ceilingDetected, true);
  assert.equal(ceiling.recommendation, 'weight_training_or_model_escalation');
  assert.ok(ceiling.rationale.includes('Harness evolution ceiling hit'));

  // 3. Stagnant evolution with low process failure also triggers ceiling
  const stagnantCeiling = evaluateHarnessCeiling({
    failureComposition: {
      totalFailures: 4,
      processFailures: 0,
      contentFailures: 4,
      processFailureRate: 0.0,
      contentFailureRate: 1.0,
    },
    stagnationResult: { isStagnant: true },
  });
  assert.equal(stagnantCeiling.ceilingDetected, true);
  assert.equal(stagnantCeiling.recommendation, 'weight_training_or_model_escalation');
});

test('partitionAcceptedEdits separates trainable behaviors from runtime security controls', () => {
  const edits = [
    { name: 'gate-deny-force-push', rule: 'security firewall block git push --force' },
    { name: 'single-writer-lease', rule: 'lease check .git/thumbgate-session-lease.json' },
    { name: 'response-cot-template', rule: 'format thinking reasoning_step template' },
    { name: 'brief-executive-tone', rule: 'style concise executive tone convention' },
    { name: 'sandbox-fence-bounds', rule: 'sandbox fence tool execution to project tree' },
  ];

  const { trainableIntoWeights, keepInRuntimeHarness } = partitionAcceptedEdits(edits);

  assert.equal(trainableIntoWeights.length, 2);
  assert.equal(keepInRuntimeHarness.length, 3);

  // Trainable
  assert.ok(trainableIntoWeights.some((e) => e.name === 'response-cot-template'));
  assert.ok(trainableIntoWeights.some((e) => e.name === 'brief-executive-tone'));

  // Runtime
  assert.ok(keepInRuntimeHarness.some((e) => e.name === 'gate-deny-force-push'));
  assert.ok(keepInRuntimeHarness.some((e) => e.name === 'single-writer-lease'));
  assert.ok(keepInRuntimeHarness.some((e) => e.name === 'sandbox-fence-bounds'));

  // Edge case: trainable name but security rule -> stays in runtime harness
  const mixedEdit = [{ name: 'response-template', rule: 'verify signature before deploy' }];
  const mixedResult = partitionAcceptedEdits(mixedEdit);
  assert.equal(mixedResult.keepInRuntimeHarness.length, 1);
  assert.equal(mixedResult.trainableIntoWeights.length, 0);
});

test('omp.sh coordination prevents prompt bloat when content ceiling is reached', () => {
  // When ceiling is hit, adding prompt rules is rejected
  const handoffAtCeiling = {
    model: 'grok-4.7',
    route: 'named',
    fast: false,
    session: 'new',
    think: 'off',
    agents: 1,
    install: 'none',
    host: 'local',
    share: 'view-only',
    state: 'Verified working baseline',
    next: 'Run tests and verify',
    action: 'add_prompt_rule',
    failureComposition: {
      totalFailures: 5,
      processFailureRate: 0.0,
      contentFailureRate: 1.0,
    },
  };
  const report = buildOmpCoordinationHonestyReport({ handoff: handoffAtCeiling });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'harness_ceiling_prompt_bloat'));

  // Text scanning for prompt rule creation during content ceiling
  const textReport = buildOmpCoordinationHonestyReport({
    claim: 'We hit a content-failure ceiling, so let us add-rule to the prompt to fix reasoning',
  });
  assert.ok(textReport.findings.some((f) => f.id === 'harness_ceiling_prompt_bloat'));

  // Diagnosing intervention
  const diagCeiling = diagnoseFailureIntervention({ processFailures: 0, contentFailures: 6 });
  assert.equal(diagCeiling.ceilingHit, true);
  assert.equal(diagCeiling.intervention, 'model_tier_escalation_or_weight_training');

  const diagProcess = diagnoseFailureIntervention({ processFailures: 5, contentFailures: 0 });
  assert.equal(diagProcess.ceilingHit, false);
  assert.equal(diagProcess.intervention, 'harness_evolution');
});

test('harness-ceiling-doctor audits all 5 pillars and returns PASS', () => {
  const audit = auditHarnessCeiling();
  assert.equal(audit.status, 'PASS');
  assert.equal(audit.checks.length, 4);
  assert.ok(audit.checks.every((c) => c.ok));
  assert.equal(audit.pillars.length, 5);
});

test('CLI harness-ceiling supports --json, --map-only, and --evaluate', () => {
  const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');

  // 1. --json
  const runJson = spawnSync(process.execPath, [cliPath, 'harness-ceiling', '--json'], { encoding: 'utf8' });
  assert.equal(runJson.status, 0);
  const outJson = JSON.parse(runJson.stdout);
  assert.equal(outJson.status, 'PASS');

  // 2. --map-only --json
  const runMap = spawnSync(process.execPath, [cliPath, 'harness-ceiling', '--map-only', '--json'], { encoding: 'utf8' });
  assert.equal(runMap.status, 0);
  const outMap = JSON.parse(runMap.stdout);
  assert.equal(outMap.mapOnly, true);
  assert.equal(outMap.pillars.length, 5);

  // 3. --evaluate --process=0 --content=8 --json
  const runEval = spawnSync(process.execPath, [cliPath, 'harness-ceiling', '--evaluate', '--process=0', '--content=8', '--json'], { encoding: 'utf8' });
  assert.equal(runEval.status, 0);
  const outEval = JSON.parse(runEval.stdout);
  assert.equal(outEval.ceilingHit, true);
  assert.equal(outEval.intervention, 'model_tier_escalation_or_weight_training');
});
