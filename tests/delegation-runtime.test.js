const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-delegation-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
process.env.THUMBGATE_NO_RATE_LIMIT = '1';

const { planIntent } = require('../scripts/intent-router');
const {
  assessOpenLoop,
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

function sourcedLoop(extra = {}) {
  return {
    task: 'Prepare the gate note before the review',
    source: 'https://example.invalid/message/1',
    next: 'Read the thread when it finishes.',
    status: 'waiting',
    ...extra,
  };
}

test('an open loop keeps its source and does not treat a role name as a boundary', () => {
  const result = assessOpenLoop(sourcedLoop({
    due: '2026-11-09',
    role: 'Inbox Manager',
    briefing: 'One item is waiting on the review.',
    action: 'record',
  }));

  assert.equal(result.allow, true);
  assert.equal(result.reason, 'open_loop');
  assert.equal(result.source, 'https://example.invalid/message/1');
  assert.equal(result.due, '2026-11-09');
  assert.equal(result.role, 'Inbox Manager');
  assert.equal(result.briefing, 'One item is waiting on the review.');
  assert.equal(result.boundary, false);
  assert.equal(result.sent, false);
  assert.equal(result.executed, false);
  assert.equal(result.networkCall, false);
});

test('a named role is not a security boundary, and a duplicate loop is refused', () => {
  const boundary = assessOpenLoop(sourcedLoop({ securityBoundary: true }));
  assert.equal(boundary.allow, false);
  assert.equal(boundary.reason, 'not_a_boundary');
  assert.equal(boundary.boundary, false);

  const separate = assessOpenLoop(sourcedLoop({ separateBoundary: true }));
  assert.equal(separate.reason, 'not_a_boundary');

  const duplicate = assessOpenLoop(sourcedLoop({ existing: true }));
  assert.equal(duplicate.reason, 'duplicate');
  assert.equal(duplicate.executed, false);
});

test('send, purchase, cancel, and account changes stay unexecuted', () => {
  const unapproved = assessOpenLoop(sourcedLoop({
    action: 'purchase',
    approved: false,
    message: 'buy-token-qa',
  }));
  assert.equal(unapproved.reason, 'needs_approval');
  assert.equal(unapproved.purchased, false);
  assert.equal(unapproved.executed, false);
  assert.equal(JSON.stringify(unapproved).includes('buy-token-qa'), false);

  for (const action of ['send', 'cancel', 'book', 'change_account', 'move_calendar']) {
    const held = assessOpenLoop(sourcedLoop({ action }));
    assert.equal(held.reason, 'needs_approval');
    assert.equal(held.sent, false);
    assert.equal(held.cancelled, false);
    assert.equal(held.booked, false);
    assert.equal(held.accountChanged, false);
  }

  const approved = assessOpenLoop(sourcedLoop({
    action: 'send',
    approved: true,
    message: 'outbound-token-qa',
  }));
  assert.equal(approved.allow, true);
  assert.equal(approved.reason, 'approved_not_executed');
  assert.equal(approved.sent, false);
  assert.equal(approved.executed, false);
  assert.equal(JSON.stringify(approved).includes('outbound-token-qa'), false);

  const handoff = assessOpenLoop(sourcedLoop({
    handoff: { send: true },
  }));
  assert.equal(handoff.reason, 'needs_approval');
  assert.equal(handoff.sent, false);
});

test('an open loop refuses a missing source, a second briefing, and another price', () => {
  assert.equal(assessOpenLoop(sourcedLoop({ source: '' })).reason, 'missing_source');
  assert.equal(assessOpenLoop(sourcedLoop({ source: 'memory' })).reason, 'missing_source');
  assert.equal(assessOpenLoop(null).reason, 'not_a_record');
  assert.equal(assessOpenLoop(sourcedLoop({ next: 'First.\nSecond.' })).reason, 'next_is_one_line');
  assert.equal(assessOpenLoop(sourcedLoop({ due: 'next week' })).reason, 'bad_due');

  const scorecard = assessOpenLoop(sourcedLoop({
    briefing: ['Reply to one message.', 'Also compare three quotes.'],
  }));
  assert.equal(scorecard.reason, 'one_briefing');
  assert.equal(JSON.stringify(scorecard).includes('three quotes'), false);

  const bundle = assessOpenLoop(sourcedLoop({ next: 'Sell the $49 bundle.' }));
  assert.equal(bundle.reason, 'forbidden_price');
  assert.ok(bundle.prices.includes(49));

  const both = assessOpenLoop(sourcedLoop({
    next: 'Setup Sprint is $499 once, or the $49 bundle.',
  }));
  assert.equal(both.reason, 'forbidden_price');
  assert.ok(both.prices.includes(499));
  assert.ok(both.prices.includes(49));

  const priced = assessOpenLoop(sourcedLoop({
    next: 'Pro stays $19/month or $149/year. Setup Sprint is $499 once.',
  }));
  assert.equal(priced.allow, true);
  assert.equal(priced.reason, 'open_loop');

  const secret = 'ghp_abcdefghij';
  const leaked = assessOpenLoop(sourcedLoop({ source: `https://example.invalid/${secret}` }));
  assert.equal(leaked.reason, 'secret_present');
  assert.equal(JSON.stringify(leaked).includes(secret), false);
});
