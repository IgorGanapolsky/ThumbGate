const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-delegation-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
process.env.THUMBGATE_NO_RATE_LIMIT = '1';

const { planIntent } = require('../scripts/intent-router');
const {
  evaluateDelegation,
  startHandoff,
  completeHandoff,
  readDelegationEvents,
  deriveActiveHandoffs,
  summarizeDelegation,
} = require('../scripts/delegation-runtime');

function emptyDir(dirPath) {
  if (!fs.existsSync(dirPath)) return;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    fs.rmSync(path.join(dirPath, entry.name), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
}
function removeDirWithRetry(targetPath, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      emptyDir(targetPath);
      fs.rmSync(targetPath, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      });
      return;
    } catch (error) {
      if (attempt === attempts - 1 || error.code !== 'ENOTEMPTY') {
        throw error;
      }
    }
  }
}
function resetFeedbackDir() {
  removeDirWithRetry(tmpFeedbackDir);
  fs.mkdirSync(tmpFeedbackDir, { recursive: true });
  emptyDir(tmpFeedbackDir);
}

function buildEligiblePlan() {
  return planIntent({
    intentId: 'improve_response_quality',
    mcpProfile: 'default',
    context: 'Improve the response with evidence and prevention rules',
    delegationMode: 'auto',
  });
}

test.beforeEach(() => {
  resetFeedbackDir();
});

test.after(() => {
  try {
    removeDirWithRetry(tmpFeedbackDir);
  } catch {
    // Best-effort cleanup for temp coverage directories.
  }
});

test('planIntent returns deterministic delegation defaults when feature is off', () => {
  const plan = planIntent({
    intentId: 'improve_response_quality',
    mcpProfile: 'default',
    context: 'Improve the response with evidence and prevention rules',
  });

  assert.equal(plan.executionMode, 'single_agent');
  assert.equal(plan.delegationEligible, false);
  assert.equal(plan.delegationScore, 0);
  assert.equal(plan.delegateProfile, null);
  assert.equal(plan.handoffContract, null);
});

test('planIntent selects sequential delegation for eligible multi-phase work', () => {
  const plan = buildEligiblePlan();

  assert.equal(plan.executionMode, 'sequential_delegate');
  assert.equal(plan.delegationEligible, true);
  assert.ok(plan.delegationScore >= 0.6);
  assert.equal(plan.delegateProfile, 'pr_workflow');
  assert.ok(plan.handoffContract);
  assert.ok(Array.isArray(plan.handoffContract.requiredChecks));
});

test('evaluateDelegation never escalates readonly callers into write-capable profiles', () => {
  const evaluation = evaluateDelegation({
    delegationMode: 'auto',
    mcpProfile: 'readonly',
    context: 'Review provenance and stats with explicit verification hints',
    plan: {
      mcpProfile: 'readonly',
      status: 'ready',
      intent: {
        id: 'synthetic_readonly_review',
        description: 'Review evidence and verification outputs',
        risk: 'low',
      },
      context: 'Review provenance and stats with explicit verification hints',
      actions: [
        { kind: 'mcp_tool', name: 'context_provenance' },
        { kind: 'mcp_tool', name: 'feedback_summary' },
        { kind: 'mcp_tool', name: 'feedback_stats' },
      ],
      partnerStrategy: {
        recommendedChecks: ['Inspect evidence before accepting the handoff'],
      },
      codegraphImpact: {
        enabled: true,
        verificationHints: ['Verify the evidence trail before approval'],
      },
    },
  });

  assert.equal(evaluation.executionMode, 'sequential_delegate');
  assert.equal(evaluation.delegationEligible, true);
  assert.equal(evaluation.delegateProfile, 'review_workflow');
});

test('evaluateDelegation keeps dispatch sessions single-agent and blocks handoffs', () => {
  const evaluation = evaluateDelegation({
    delegationMode: 'auto',
    mcpProfile: 'dispatch',
    context: 'Review metrics and plan the next hardening sprint from the phone',
    plan: {
      mcpProfile: 'dispatch',
      status: 'ready',
      intent: {
        id: 'improve_response_quality',
        description: 'Improve the response with evidence and prevention rules',
        risk: 'low',
      },
      context: 'Review metrics and plan the next hardening sprint from the phone',
      actions: [
        { kind: 'mcp_tool', name: 'dashboard' },
        { kind: 'mcp_tool', name: 'gate_stats' },
        { kind: 'mcp_tool', name: 'plan_intent' },
      ],
      partnerStrategy: {
        recommendedChecks: ['Keep this remote review read-only'],
      },
      codegraphImpact: {
        enabled: true,
        verificationHints: ['Do not mutate the repo from Dispatch'],
      },
    },
  });

  assert.equal(evaluation.executionMode, 'single_agent');
  assert.equal(evaluation.delegationEligible, false);
  assert.equal(evaluation.reasonCode, 'dispatch_profile');
  assert.match(evaluation.delegationReason, /remote handoffs stay disabled/i);
});

test('startHandoff blocks unresolved handoffs and active state is derived from log replay', () => {
  const plan = buildEligiblePlan();
  const started = startHandoff({
    plan,
    context: plan.context,
    mcpProfile: plan.mcpProfile,
    partnerProfile: plan.partnerProfile,
  });

  assert.ok(started.handoffId);

  assert.throws(() => startHandoff({
    plan,
    context: plan.context,
    mcpProfile: plan.mcpProfile,
    partnerProfile: plan.partnerProfile,
  }), /unresolved handoff/i);

  const beforeCompletion = deriveActiveHandoffs(readDelegationEvents());
  assert.equal(beforeCompletion.byHandoffId.size, 1);

  completeHandoff({
    handoffId: started.handoffId,
    outcome: 'aborted',
    attempts: 1,
    violationCount: 0,
    summary: 'Aborted before delegate execution.',
  });

  const afterCompletion = deriveActiveHandoffs(readDelegationEvents());
  assert.equal(afterCompletion.byHandoffId.size, 0);

  const summary = summarizeDelegation(tmpFeedbackDir);
  assert.equal(summary.attemptCount, 1);
  assert.equal(summary.abortedCount, 1);
  assert.equal(summary.avoidedDelegationCount, 1);
});

test('completeHandoff updates delegation model and summary metrics', () => {
  const plan = buildEligiblePlan();
  const started = startHandoff({
    plan,
    context: plan.context,
    mcpProfile: plan.mcpProfile,
    partnerProfile: plan.partnerProfile,
  });

  const completed = completeHandoff({
    handoffId: started.handoffId,
    outcome: 'accepted',
    resultContext: 'Returned a verified result context with explicit evidence and clean checks.',
    attempts: 2,
    violationCount: 0,
    tokenEstimate: 1250,
    latencyMs: 450,
    summary: 'Accepted after evidence review.',
  });

  assert.equal(completed.status, 'completed');
  assert.equal(completed.outcome, 'accepted');
  assert.equal(completed.verificationAccepted, true);

  const summary = summarizeDelegation(tmpFeedbackDir);
  assert.equal(summary.acceptedCount, 1);
  assert.equal(summary.averageAttemptsPerTask, 2);
  assert.equal(summary.averageTokenEstimate, 1250);
  assert.ok(summary.reliability.global);

  const modelPath = path.join(tmpFeedbackDir, 'delegation-model.json');
  const model = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
  assert.ok(model.categories.delegation_global.alpha > 1);
});
