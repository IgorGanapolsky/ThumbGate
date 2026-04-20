const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  advanceCheckpoint,
  createCheckpoint,
  formatCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
  shouldHaltWorkflow,
} = require('../scripts/workflow-gate-checkpoint');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-wf-checkpoint-'));
}

test('createCheckpoint generates valid checkpoint with defaults', () => {
  const cp = createCheckpoint();
  assert.ok(cp.checkpointId.startsWith('wfcp_'));
  assert.ok(cp.workflowId.startsWith('wf_'));
  assert.equal(cp.step, 0);
  assert.equal(cp.phase, 'intent');
  assert.equal(cp.status, 'running');
  assert.ok(cp.timestamp);
  assert.deepEqual(cp.sessionActions, []);
  assert.deepEqual(cp.evaluationHistory, []);
  assert.deepEqual(cp.evidence, []);
  assert.equal(cp.gateState.blockedCount, 0);
});

test('createCheckpoint accepts custom values', () => {
  const cp = createCheckpoint({
    workflowId: 'wf_custom',
    step: 5,
    phase: 'verify',
    status: 'completed',
    sessionActions: ['npm test', 'git add .'],
    activeSpecs: ['agent-safety'],
    intent: { summary: 'Ship release' },
    plan: { summary: 'Run verification' },
    report: { status: 'completed' },
    evidence: ['proof/runtime-report.json'],
    metadata: { owner: 'automation' },
    gateState: { blockedCount: 2, nearMissCount: 1, totalChecked: 10, safetyPosture: 'cautious' },
  });

  assert.equal(cp.workflowId, 'wf_custom');
  assert.equal(cp.step, 5);
  assert.equal(cp.phase, 'verify');
  assert.equal(cp.status, 'completed');
  assert.equal(cp.sessionActions.length, 2);
  assert.equal(cp.intent.summary, 'Ship release');
  assert.equal(cp.plan.summary, 'Run verification');
  assert.equal(cp.report.status, 'completed');
  assert.deepEqual(cp.evidence, ['proof/runtime-report.json']);
  assert.equal(cp.metadata.owner, 'automation');
  assert.equal(cp.gateState.blockedCount, 2);
  assert.equal(cp.gateState.safetyPosture, 'cautious');
});

test('createCheckpoint truncates long action lists', () => {
  const actions = Array.from({ length: 200 }, (_, i) => `action_${i}`);
  const cp = createCheckpoint({ sessionActions: actions });
  assert.equal(cp.sessionActions.length, 100);
});

test('saveCheckpoint and loadCheckpoint round-trip', () => {
  const tempDir = makeTempDir();
  const filePath = path.join(tempDir, 'checkpoint.json');

  const cp = createCheckpoint({ workflowId: 'wf_test', step: 3 });
  saveCheckpoint(cp, filePath);

  const loaded = loadCheckpoint(filePath);
  assert.equal(loaded.workflowId, 'wf_test');
  assert.equal(loaded.step, 3);
  assert.equal(loaded.checkpointId, cp.checkpointId);
});

test('loadCheckpoint returns null for missing file', () => {
  const result = loadCheckpoint('/nonexistent/checkpoint.json');
  assert.equal(result, null);
});

test('advanceCheckpoint increments step and merges state', () => {
  const cp = createCheckpoint({
    workflowId: 'wf_advance',
    step: 2,
    sessionActions: ['npm test'],
    gateState: { blockedCount: 1, nearMissCount: 0, totalChecked: 5, safetyPosture: 'cautious' },
  });

  const next = advanceCheckpoint(cp, {
    newActions: ['git commit -m "fix"'],
    newEvaluations: [{ allowed: true }],
    phase: 'report',
    status: 'completed',
    report: { status: 'completed' },
    evidence: ['proof/runtime-report.json'],
    metadata: { reportWritten: true },
    gateState: { blockedCount: 0, nearMissCount: 1, totalChecked: 3, safetyPosture: 'cautious' },
  });

  assert.equal(next.step, 3);
  assert.equal(next.workflowId, 'wf_advance');
  assert.equal(next.phase, 'report');
  assert.equal(next.status, 'completed');
  assert.equal(next.sessionActions.length, 2);
  assert.equal(next.evaluationHistory.length, 1);
  assert.equal(next.report.status, 'completed');
  assert.deepEqual(next.evidence, ['proof/runtime-report.json']);
  assert.equal(next.metadata.reportWritten, true);
  assert.equal(next.gateState.blockedCount, 1); // 1 + 0
  assert.equal(next.gateState.nearMissCount, 1); // 0 + 1
  assert.equal(next.gateState.totalChecked, 8); // 5 + 3
});

test('shouldHaltWorkflow returns halt when blocked count exceeds threshold', () => {
  const cp = createCheckpoint({
    gateState: { blockedCount: 6, nearMissCount: 0, totalChecked: 20, safetyPosture: 'critical' },
  });

  const result = shouldHaltWorkflow(cp, { maxBlocked: 5 });
  assert.equal(result.halt, true);
  assert.ok(result.reason.includes('exceeded threshold'));
});

test('shouldHaltWorkflow returns halt on consecutive blocks', () => {
  const cp = createCheckpoint({
    gateState: { blockedCount: 3, nearMissCount: 0, totalChecked: 10, safetyPosture: 'critical' },
  });
  cp.evaluationHistory = [
    { allowed: false },
    { allowed: false },
    { allowed: false },
  ];

  const result = shouldHaltWorkflow(cp, { maxConsecutiveBlocks: 3 });
  assert.equal(result.halt, true);
  assert.ok(result.reason.includes('consecutive'));
});

test('shouldHaltWorkflow returns no halt for healthy workflow', () => {
  const cp = createCheckpoint({
    gateState: { blockedCount: 1, nearMissCount: 0, totalChecked: 20, safetyPosture: 'clean' },
  });
  cp.evaluationHistory = [
    { allowed: true },
    { allowed: false },
    { allowed: true },
  ];

  const result = shouldHaltWorkflow(cp);
  assert.equal(result.halt, false);
  assert.equal(result.reason, null);
});

test('formatCheckpoint produces readable output', () => {
  const cp = createCheckpoint({
    workflowId: 'wf_fmt',
    step: 7,
    sessionActions: ['a', 'b'],
    gateState: { blockedCount: 2, nearMissCount: 1, totalChecked: 15, safetyPosture: 'cautious' },
  });

  const output = formatCheckpoint(cp);
  assert.ok(output.includes('wf_fmt'));
  assert.ok(output.includes('Step: 7'));
  assert.ok(output.includes('Phase: intent'));
  assert.ok(output.includes('blocked=2'));
  assert.ok(output.includes('posture=cautious'));
});
