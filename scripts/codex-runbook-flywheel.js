'use strict';

/**
 * Codex Runbook Flywheel — ThumbGate steal of OpenAI's "Automating repetitive
 * work at OpenAI with Codex" workflow (developers.openai.com blog).
 *
 * The episode's loop, verbatim in spirit:
 *   run the workflow -> document it (commands, results, dead ends,
 *   decisions) -> the next run reuses what earlier runs learned.
 *
 * Four enforcement primitives, all deterministic:
 *
 *   1. Plan-before-act. Codex writes the plan into the notebook and WAITS
 *      for approval before executing. -> newRunbook() starts at 'plan';
 *      execute() refuses to run without an approved plan.
 *
 *   2. Consequential choices need human judgment. Automatic approval review
 *      handles eligible actions WITHOUT changing permission boundaries.
 *      -> autoReview() marks only bounded, reversible actions eligible;
 *      consequential ones stay on the human queue.
 *
 *   3. Capture decisions that would otherwise vanish into chat history:
 *      which option was chosen, why, what to do differently next time.
 *      -> captureDecision() appends to a per-workflow decision log.
 *
 *   4. Cheap discovery for the next run: a companion index over past
 *      runbooks (the *.index.md analog), searchable by workflow name.
 *      -> buildIndex() / discoverContext().
 */

const RUN_STATES = Object.freeze(['plan', 'approved', 'running', 'done', 'blocked']);

const CONSEQUENTIAL = Object.freeze([
  'payment', 'external-email', 'production-deploy', 'delete', 'permission-change', 'publish',
]);

/**
 * Create a runbook. Starts at the plan stage — execution is impossible until
 * a human approves. Mirrors "wait for me to review and approve the plan."
 */
function newRunbook(workflow, goal) {
  if (!workflow || !goal) {
    throw new Error('runbook needs a workflow name and a goal');
  }
  return {
    id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    workflow,
    goal,
    state: 'plan',
    plan: [],
    decisions: [],
    steps: [],
    deadEnds: [],
    createdAt: new Date().toISOString(),
  };
}

/**
 * Record the plan and approve it. Approval is an explicit human act.
 */
function approvePlan(runbook, plan, approver) {
  if (runbook.state !== 'plan') {
    return { ok: false, reason: `cannot approve from state "${runbook.state}"` };
  }
  if (!Array.isArray(plan) || plan.length === 0) {
    return { ok: false, reason: 'an empty plan cannot be approved' };
  }
  if (!approver) {
    return { ok: false, reason: 'approval requires a named human approver' };
  }
  runbook.plan = plan;
  runbook.state = 'approved';
  runbook.approvedBy = approver;
  runbook.approvedAt = new Date().toISOString();
  return { ok: true, state: runbook.state };
}

/**
 * Automatic approval review for individual actions. Only bounded, reversible
 * actions are eligible; consequential ones stay on the human queue. This
 * reviews WITHOUT widening permission boundaries.
 */
function autoReview(action) {
  if (CONSEQUENTIAL.includes(action.type)) {
    return { eligible: false, reason: `"${action.type}" is consequential — human approval required` };
  }
  if (action.irreversible) {
    return { eligible: false, reason: 'irreversible actions are never auto-approved' };
  }
  return { eligible: true, reason: 'bounded and reversible — auto-review passes' };
}

/**
 * Execute one step. Refuses unless the plan was approved.
 */
function executeStep(runbook, step, outcome) {
  if (runbook.state !== 'approved' && runbook.state !== 'running') {
    return { ok: false, reason: `execution refused — runbook state is "${runbook.state}", not approved` };
  }
  runbook.state = 'running';
  runbook.steps.push({ step, outcome: outcome || 'ok', at: new Date().toISOString() });
  return { ok: true, executed: runbook.steps.length };
}

/**
 * Capture a decision that would otherwise disappear into chat history.
 */
function captureDecision(runbook, decision) {
  if (!decision || !decision.choice || !decision.reason) {
    return { ok: false, reason: 'a decision needs both a choice and a reason' };
  }
  runbook.decisions.push({
    choice: decision.choice,
    reason: decision.reason,
    nextTime: decision.nextTime || null,
    at: new Date().toISOString(),
  });
  return { ok: true, decisions: runbook.decisions.length };
}

/**
 * Mark a dead end — the article documents these on purpose so the next run
 * doesn't repeat them.
 */
function recordDeadEnd(runbook, deadEnd) {
  runbook.deadEnds.push({ deadEnd, at: new Date().toISOString() });
  return { deadEnds: runbook.deadEnds.length };
}

/**
 * Close the runbook. Only a running/approved runbook can close, and only
 * with at least one recorded step.
 */
function closeRunbook(runbook) {
  if (runbook.steps.length === 0) {
    return { ok: false, reason: 'cannot close a runbook with no recorded steps' };
  }
  runbook.state = 'done';
  runbook.completedAt = new Date().toISOString();
  return { ok: true, state: 'done' };
}

/**
 * Build the companion index over completed runbooks (the *.index.md analog).
 */
function buildIndex(runbooks) {
  return (runbooks || [])
    .filter((r) => r.state === 'done')
    .map((r) => ({
      workflow: r.workflow,
      goal: r.goal,
      steps: r.steps.length,
      decisions: r.decisions.length,
      deadEnds: r.deadEnds.length,
      completedAt: r.completedAt,
    }));
}

/**
 * Discover prior context for a workflow — what earlier runs learned.
 */
function discoverContext(index, workflow) {
  const prior = (index || []).filter((e) => e.workflow === workflow);
  return {
    workflow,
    priorRuns: prior.length,
    totalDecisions: prior.reduce((n, e) => n + e.decisions, 0),
    totalDeadEnds: prior.reduce((n, e) => n + e.deadEnds, 0),
    reusable: prior.length > 0,
  };
}

function isCliEntrypoint() {
  return require.main === module;
}

function main() {
  const rb = newRunbook('model-eval', 'Run the evaluation against the current model');

  const premature = executeStep(rb, 'run eval'); // must refuse
  approvePlan(rb, ['review previous run', 'write plan', 'run eval', 'document'], 'igor');
  const review = { auto: autoReview({ type: 'read-file' }), blocked: autoReview({ type: 'production-deploy' }) };

  executeStep(rb, 'review previous run', 'ok');
  executeStep(rb, 'run eval', 'ok');
  captureDecision(rb, {
    choice: 'reuse existing eval cluster',
    reason: 'quota exhausted on new provisioning',
    nextTime: 'check quota before provisioning',
  });
  recordDeadEnd(rb, 'new cluster provisioning — quota exhausted');
  closeRunbook(rb);

  const index = buildIndex([rb]);
  const context = discoverContext(index, 'model-eval');

  process.stdout.write(JSON.stringify({
    honesty: 'deterministic model of the OpenAI Codex+Runme runbook flywheel',
    source: 'https://developers.openai.com/blog/automating-repetitive-work-at-openai-with-codex',
    prematureExecution: premature, // proves plan-before-act
    autoReview: review,
    finalState: rb.state,
    decisions: rb.decisions.length,
    deadEnds: rb.deadEnds.length,
    index, context,
  }, null, 2) + '\n');
}

if (isCliEntrypoint()) main();

module.exports = {
  RUN_STATES,
  CONSEQUENTIAL,
  newRunbook,
  approvePlan,
  autoReview,
  executeStep,
  captureDecision,
  recordDeadEnd,
  closeRunbook,
  buildIndex,
  discoverContext,
  isCliEntrypoint,
};
