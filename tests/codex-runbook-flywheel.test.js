'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
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
} = require('../scripts/codex-runbook-flywheel');

function plannedRunbook() {
  const rb = newRunbook('model-eval', 'Run the evaluation against the current model');
  approvePlan(rb, ['review previous run', 'run eval', 'document'], 'igor');
  return rb;
}

test('runbook starts at plan — execution is impossible before approval', () => {
  const rb = newRunbook('model-eval', 'goal');
  assert.equal(rb.state, 'plan');
  const attempt = executeStep(rb, 'run eval');
  assert.equal(attempt.ok, false);
  assert.ok(attempt.reason.includes('not approved'));
  assert.ok(RUN_STATES.includes('plan'));
});

test('newRunbook requires workflow and goal', () => {
  assert.throws(() => newRunbook('', 'goal'));
  assert.throws(() => newRunbook('wf', ''));
});

test('approval is an explicit named human act', () => {
  const rb = newRunbook('model-eval', 'goal');
  assert.equal(approvePlan(rb, ['step'], null).ok, false);
  assert.equal(approvePlan(rb, [], 'igor').ok, false);
  const ok = approvePlan(rb, ['step'], 'igor');
  assert.equal(ok.ok, true);
  assert.equal(rb.approvedBy, 'igor');
  assert.equal(approvePlan(rb, ['again'], 'igor').ok, false); // cannot re-approve
});

test('approval rejects non-string and whitespace-only approvers', () => {
  const rb = newRunbook('model-eval', 'goal');
  // non-string values
  assert.equal(approvePlan(rb, ['step'], 123).ok, false);
  assert.equal(approvePlan(rb, ['step'], {}).ok, false);
  assert.equal(approvePlan(rb, ['step'], ['igor']).ok, false);
  // truthy but whitespace-only
  assert.equal(approvePlan(rb, ['step'], '   ').ok, false);
  assert.equal(approvePlan(rb, ['step'], '\t\n').ok, false);
});

test('approval trims approver string before storing', () => {
  const rb = newRunbook('model-eval', 'goal');
  const ok = approvePlan(rb, ['step'], '  igor  ');
  assert.equal(ok.ok, true);
  assert.equal(rb.approvedBy, 'igor');
});

test('auto-review approves only bounded reversible actions', () => {
  assert.equal(autoReview({ type: 'read-file' }).eligible, true);
  assert.equal(autoReview({ type: 'grep' }).eligible, true);
  assert.equal(autoReview({ type: 'production-deploy' }).eligible, false);
  assert.equal(autoReview({ type: 'payment' }).eligible, false);
  assert.equal(autoReview({ type: 'read-file', irreversible: true }).eligible, false);
  // fail closed for unlisted actions
  assert.equal(autoReview({ type: 'random-arbitrary-action' }).eligible, false);
  assert.equal(autoReview({ type: '' }).eligible, false);
  assert.equal(autoReview({}).eligible, false);
  assert.equal(autoReview(null).eligible, false);
  for (const c of ['external-email', 'delete', 'permission-change', 'publish']) {
    assert.ok(CONSEQUENTIAL.includes(c), `missing consequential type ${c}`);
  }
  assert.ok(ALLOWED_ACTIONS.includes('read-file'), 'read-file must remain allowlisted');
});

test('steps only execute on approved/running runbooks', () => {
  const rb = plannedRunbook();
  assert.equal(executeStep(rb, 'review previous run').ok, true);
  assert.equal(executeStep(rb, 'run eval').ok, true);
  assert.equal(rb.steps.length, 2);
  assert.equal(rb.state, 'running');
});

test('executeStep rejects unplanned steps after approval', () => {
  const rb = plannedRunbook();
  const attempt = executeStep(rb, 'unplanned step');
  assert.equal(attempt.ok, false);
  assert.ok(attempt.reason.includes('not in the approved plan'));
  assert.equal(rb.steps.length, 0);
});

test('executeStep rejects steps after post-approval plan mutation', () => {
  const rb = plannedRunbook();
  // mutate the original plan array after approval — should not grant new steps
  rb.plan.push('injected step');
  const attempt = executeStep(rb, 'injected step');
  assert.equal(attempt.ok, false);
  assert.ok(attempt.reason.includes('not in the approved plan'));
});

test('approvedPlan is a frozen deep copy separate from the original plan', () => {
  const plan = ['step a', 'step b'];
  const rb = newRunbook('model-eval', 'goal');
  approvePlan(rb, plan, 'igor');
  // Mutating the original plan after approval must not affect the snapshot
  plan.push('injected');
  plan[0] = 'tampered';
  assert.equal(rb.approvedPlan[0], 'step a');
  assert.equal(rb.approvedPlan.length, 2);
  // The snapshot itself is frozen
  assert.throws(() => { rb.approvedPlan.push('x'); }, TypeError);
});

test('approved plan snapshot is deeply frozen against entry mutation', () => {
  const rb = plannedRunbook();
  assert.throws(() => { rb.approvedPlan[0] = 'tampered'; }, TypeError);
  // Verify the snapshot still contains the original values
  assert.equal(rb.approvedPlan[0], 'review previous run');
});

test('decision capture needs both choice and reason', () => {
  const rb = plannedRunbook();
  assert.equal(captureDecision(rb, { choice: 'x' }).ok, false);
  assert.equal(captureDecision(rb, { reason: 'y' }).ok, false);
  const ok = captureDecision(rb, { choice: 'reuse cluster', reason: 'quota exhausted' });
  assert.equal(ok.ok, true);
  assert.equal(rb.decisions.length, 1);
});

test('dead ends are recorded for the next run', () => {
  const rb = plannedRunbook();
  recordDeadEnd(rb, 'new cluster provisioning — quota exhausted');
  assert.equal(rb.deadEnds.length, 1);
});

test('close requires recorded steps', () => {
  const rb = plannedRunbook();
  assert.equal(closeRunbook(rb).ok, false);
  executeStep(rb, 'run eval', 'ok');
  assert.equal(closeRunbook(rb).ok, true);
  assert.equal(rb.state, 'done');
});

test('index covers only completed runbooks', () => {
  const done = plannedRunbook();
  executeStep(done, 'run eval', 'ok');
  closeRunbook(done);
  const open = plannedRunbook();
  const index = buildIndex([done, open]);
  assert.equal(index.length, 1);
  assert.equal(index[0].workflow, 'model-eval');
  assert.ok(index[0].completedAt);
});

test('discovery reuses what earlier runs learned', () => {
  const done = plannedRunbook();
  executeStep(done, 'run eval', 'ok');
  captureDecision(done, { choice: 'reuse cluster', reason: 'quota' });
  recordDeadEnd(done, 'provisioning dead end');
  closeRunbook(done);
  const index = buildIndex([done]);
  const ctx = discoverContext(index, 'model-eval');
  assert.equal(ctx.priorRuns, 1);
  assert.equal(ctx.totalDecisions, 1);
  assert.equal(ctx.totalDeadEnds, 1);
  assert.equal(ctx.reusable, true);
  const none = discoverContext(index, 'brand-new-workflow');
  assert.equal(none.reusable, false);
});

test('stepId normalizes string and object steps to stable identifiers', () => {
  assert.equal(stepId('run eval'), 'run eval');
  assert.equal(stepId({ id: 'deploy-prod', cmd: 'echo hi' }), 'deploy-prod');
  assert.equal(stepId({ id: '  spaced  ' }), 'spaced');
  assert.equal(stepId({}), null);
  assert.equal(stepId({ id: 123 }), null);
  assert.equal(stepId({ id: '' }), null);
  assert.equal(stepId({ id: '   ' }), null);
  assert.equal(stepId(null), null);
  assert.equal(stepId(undefined), null);
});

test('executeStep matches steps by stable identifier, not reference', () => {
  const rb = newRunbook('wf', 'goal');
  approvePlan(rb, [{ id: 'run eval' }], 'igor');
  // A different object with the same id should execute
  assert.equal(executeStep(rb, { id: 'run eval', cmd: 'echo hi' }).ok, true);
  // A different id is rejected
  assert.equal(executeStep(rb, { id: 'other' }).ok, false);
});

test('approvePlan accepts object steps with stable ids', () => {
  const rb = newRunbook('wf', 'goal');
  const ok = approvePlan(rb, [{ id: 'step-one' }, { id: 'step-two' }], 'igor');
  assert.equal(ok.ok, true);
  assert.deepEqual(rb.approvedPlan, ['step-one', 'step-two']);
});

test('approvePlan rejects object steps without stable ids', () => {
  const rb = newRunbook('wf', 'goal');
  const bad = approvePlan(rb, [{ name: 'no id field' }], 'igor');
  assert.equal(bad.ok, false);
  assert.ok(bad.reason.includes('no stable id'));
});

test('closeRunbook rejects closing a runbook in plan state', () => {
  const rb = newRunbook('wf', 'goal');
  // No steps have been executed — and state is 'plan', not 'approved' or 'running'
  const res = closeRunbook(rb);
  assert.equal(res.ok, false);
  assert.ok(res.reason.includes('state "plan"'));
  assert.equal(rb.state, 'plan');
  assert.equal(rb.steps.length, 0);
});

test('closeRunbook rejects closing a done runbook', () => {
  const rb = plannedRunbook();
  executeStep(rb, 'run eval', 'ok');
  closeRunbook(rb);
  assert.equal(rb.state, 'done');
  const again = closeRunbook(rb);
  assert.equal(again.ok, false);
  assert.ok(again.reason.includes('state "done"'));
});

test('buildIndex stores full decision and dead-end logs', () => {
  const rb = plannedRunbook();
  executeStep(rb, 'run eval', 'ok');
  captureDecision(rb, { choice: 'reuse cluster', reason: 'quota exhausted' });
  recordDeadEnd(rb, 'cluster provisioning failed');
  closeRunbook(rb);
  const index = buildIndex([rb]);
  assert.equal(index.length, 1);
  assert.equal(index[0].decisions, 1);
  assert.equal(index[0].deadEnds, 1);
  assert.deepEqual(index[0].decisionsLog, rb.decisions);
  assert.deepEqual(index[0].deadEndsLog, rb.deadEnds);
  assert.equal(index[0].decisionsLog[0].choice, 'reuse cluster');
  assert.equal(index[0].deadEndsLog[0].deadEnd, 'cluster provisioning failed');
  // Verify logs are deep copies — mutating the index must not affect the runbook
  index[0].decisionsLog[0].choice = 'tampered';
  assert.equal(rb.decisions[0].choice, 'reuse cluster');
  index[0].deadEndsLog[0].deadEnd = 'tampered';
  assert.equal(rb.deadEnds[0].deadEnd, 'cluster provisioning failed');
});

test('discoverContext returns full decision and dead-end records', () => {
  const rb = plannedRunbook();
  executeStep(rb, 'run eval', 'ok');
  captureDecision(rb, { choice: 'reuse cluster', reason: 'quota exhausted', nextTime: 'check first' });
  recordDeadEnd(rb, 'cluster provisioning failed');
  closeRunbook(rb);
  const index = buildIndex([rb]);
  const ctx = discoverContext(index, 'model-eval');
  assert.equal(ctx.priorRuns, 1);
  assert.equal(ctx.totalDecisions, 1);
  assert.equal(ctx.totalDeadEnds, 1);
  assert.equal(ctx.decisions.length, 1);
  assert.equal(ctx.deadEnds.length, 1);
  assert.equal(ctx.decisions[0].choice, 'reuse cluster');
  assert.equal(ctx.deadEnds[0].deadEnd, 'cluster provisioning failed');
  assert.equal(ctx.reusable, true);
});
