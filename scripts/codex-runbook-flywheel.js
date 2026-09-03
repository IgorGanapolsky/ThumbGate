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

const ALLOWED_ACTIONS = Object.freeze([
  'read-file', 'list-files', 'grep', 'search', 'read-notes',
  'list-models', 'estimate-cost', 'check-quota',
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
    id: require('crypto').randomUUID(),
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
 * Normalize a step to its stable identifier. String steps are used directly.
 * Object steps must have an `id` property; otherwise approval is rejected.
 * This prevents the approved-snapshot and executeStep from disagreeing due
 * to object reference identity.
 */
function stepId(step) {
  if (typeof step === 'string') return step.trim() || null;
  if (step && typeof step === 'object' && typeof step.id === 'string' && step.id.trim()) {
    return step.id.trim();
  }
  return null;
}

/**
 * Record the plan and approve it. Approval is an explicit human act.
 * Steps are normalized to immutable identifiers so that executeStep can
 * match against the approved plan without relying on object reference identity.
 */
function approvePlan(runbook, plan, approver) {
  if (runbook.state !== 'plan') {
    return { ok: false, reason: `cannot approve from state "${runbook.state}"` };
  }
  if (!Array.isArray(plan) || plan.length === 0) {
    return { ok: false, reason: 'an empty plan cannot be approved' };
  }
  if (!approver || typeof approver !== 'string' || !approver.trim()) {
    return { ok: false, reason: 'approval requires a non-empty, trimmed string approver' };
  }
  // Normalize each step to a stable identifier. Object entries without a
  // usable `id` are rejected rather than silently cloned by reference.
  const normalized = [];
  for (const s of plan) {
    const id = stepId(s);
    if (id === null) {
      return { ok: false, reason: `step ${JSON.stringify(s)} has no stable id — reject or assign one` };
    }
    normalized.push(id);
  }
  runbook.approvedBy = approver.trim();
  runbook.approvedPlan = Object.freeze(normalized);
  runbook.state = 'approved';
  runbook.approvedAt = new Date().toISOString();
  return { ok: true, state: runbook.state };
}

/**
 * Automatic approval review for individual actions. Uses an explicit
 * allowlist of safe action types — fail closed for anything unlisted.
 */
function autoReview(action) {
  if (!action || !action.type || typeof action.type !== 'string') {
    return { eligible: false, reason: 'missing or invalid action type — human approval required' };
  }
  if (!ALLOWED_ACTIONS.includes(action.type)) {
    return { eligible: false, reason: `"${action.type}" is unlisted — human approval required` };
  }
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
  if (!Array.isArray(runbook.approvedPlan)) {
    return { ok: false, reason: 'execution refused — no approved plan snapshot on record' };
  }
  if (!runbook.approvedPlan.includes(stepId(step))) {
    return { ok: false, reason: `execution refused — "${step}" is not in the approved plan` };
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
  if (runbook.state !== 'approved' && runbook.state !== 'running') {
    return { ok: false, reason: `cannot close from state "${runbook.state}"` };
  }
  if (runbook.steps.length === 0) {
    return { ok: false, reason: 'cannot close a runbook with no recorded steps' };
  }
  runbook.state = 'done';
  runbook.completedAt = new Date().toISOString();
  return { ok: true, state: 'done' };
}

/**
 * Build the companion index over completed runbooks (the *.index.md analog).
 * Full decision and dead-end records are stored alongside counts so later
 * runs can reuse the captured guidance.
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
      decisionsLog: r.decisions.map((d) => ({ ...d })),
      deadEndsLog: r.deadEnds.map((d) => ({ ...d })),
      completedAt: r.completedAt,
    }));
}

/**
 * Discover prior context for a workflow — what earlier runs learned.
 * Returns the full decision and dead-end records so callers can act on
 * the captured guidance, not just counts.
 */
function discoverContext(index, workflow) {
  const prior = (index || []).filter((e) => e.workflow === workflow);
  return {
    workflow,
    priorRuns: prior.length,
    totalDecisions: prior.reduce((n, e) => n + e.decisions, 0),
    totalDeadEnds: prior.reduce((n, e) => n + e.deadEnds, 0),
    decisions: prior.flatMap((e) => (e.decisionsLog || []).map((d) => ({ ...d }))),
    deadEnds: prior.flatMap((e) => (e.deadEndsLog || []).map((d) => ({ ...d }))),
    reusable: prior.length > 0,
  };
}

function isCliEntrypoint() {
  return require.main === module;
}

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const mode = { dryRun: false, solve: false };
  for (const arg of args) {
    if (arg === '--dry-run') mode.dryRun = true;
    else if (arg === '--solve') mode.solve = true;
  }
  return mode;
}

function main() {
  const { dryRun, solve } = parseCliArgs(process.argv);
  const rb = newRunbook('model-eval', 'Run the evaluation against the current model');

  const premature = executeStep(rb, 'run eval'); // must refuse
  approvePlan(rb, ['review previous run', 'write plan', 'run eval', 'document'], 'igor');
  const review = { auto: autoReview({ type: 'read-file' }), blocked: autoReview({ type: 'production-deploy' }) };

  if (dryRun) {
    // Dry-run mode: do not record execution steps or complete the runbook.
    // Surface the plan and auto-review decisions only.
    process.stdout.write(JSON.stringify({
      mode: 'dry-run',
      honesty: 'deterministic model of the OpenAI Codex+Runme runbook flywheel',
      source: 'https://developers.openai.com/blog/automating-repetitive-work-at-openai-with-codex',
      prematureExecution: premature,
      autoReview: review,
      approvedPlan: rb.approvedPlan,
      state: rb.state,
    }, null, 2) + '\n');
    return;
  }

  if (solve) {
    // Solve mode: execute the approved plan end-to-end.
    return runSolve(rb, review, premature);
  }

  // Default mode: execute the approved plan end-to-end.
  runSolve(rb, review, premature);
}

function runSolve(rb, review, premature) {
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
    mode: 'solve',
    honesty: 'deterministic model of the OpenAI Codex+Runme runbook flywheel',
    source: 'https://developers.openai.com/blog/automating-repetitive-work-at-openai-with-codex',
    prematureExecution: premature,
    autoReview: review,
    finalState: rb.state,
    decisions: rb.decisions.length,
    deadEnds: rb.deadEnds.length,
    decisionsLog: rb.decisions,
    deadEndsLog: rb.deadEnds,
    index, context,
  }, null, 2) + '\n');
}

if (isCliEntrypoint()) main();

module.exports = {
  RUN_STATES,
  CONSEQUENTIAL,
  ALLOWED_ACTIONS,
  stepId,
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
