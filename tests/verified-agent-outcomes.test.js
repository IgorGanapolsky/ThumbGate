'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  calculateTaskOutcomeMetrics,
  getTaskOutcome,
  normalizeTaskOutcome,
  readTaskOutcomes,
  recordTaskOutcome,
} = require('../scripts/task-outcomes');
const {
  calculateEscalationMetrics,
  decideEscalation,
  listEscalations,
  requestEscalation,
} = require('../scripts/human-escalation');
const { runAgentOutcomeEval } = require('../scripts/agent-outcome-eval');
const {
  buildAgentOutcomeMonitorSchedule,
  fetchHostedMonitor,
  installAgentOutcomeMonitorSchedule,
  monitorTaskOutcomes,
  parseArgs,
} = require('../scripts/agent-outcome-monitor');

function tempFeedbackDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-task-outcomes-'));
}

function verifiedReceipt(overrides = {}) {
  return {
    taskId: 'task-1',
    taskType: 'code-change',
    goal: 'Implement a verified change',
    status: 'completed',
    verification: {
      performed: true,
      passed: true,
      verifier: 'node-test',
      evidence: ['4 tests passed'],
      unsupportedClaims: 0,
    },
    toolCalls: [{
      name: 'apply_patch',
      contractValid: true,
      allowed: true,
      succeeded: true,
      attempts: 1,
      latencyMs: 25,
      costUsd: 0,
      sideEffect: true,
      idempotencyKey: 'edit-1',
      duplicateSideEffect: false,
    }],
    policy: {
      violations: 0,
      unsafeEscapes: 0,
      falseBlocks: 0,
    },
    efficiency: {
      latencyMs: 500,
      costUsd: 0.02,
      firstAttempt: true,
    },
    idempotencyKey: 'task-1',
    ...overrides,
  };
}

test('task outcomes fail closed without verification evidence', () => {
  const receipt = normalizeTaskOutcome(verifiedReceipt({
    verification: {
      performed: false,
      passed: false,
      evidence: [],
      unsupportedClaims: 1,
    },
  }));

  assert.equal(receipt.working, false);
  assert.ok(receipt.workingReasons.includes('verification_not_performed'));
  assert.ok(receipt.workingReasons.includes('evidence_missing'));
  assert.ok(receipt.workingReasons.includes('unsupported_claim'));
});

test('task outcomes are idempotent and reject conflicting duplicate writes', () => {
  const feedbackDir = tempFeedbackDir();
  try {
    const first = recordTaskOutcome(verifiedReceipt(), { feedbackDir, recordTrace: false });
    const duplicate = recordTaskOutcome(verifiedReceipt(), { feedbackDir, recordTrace: false });
    assert.equal(first.recorded, true);
    assert.equal(duplicate.recorded, false);
    assert.equal(readTaskOutcomes({ feedbackDir }).length, 1);
    assert.equal(getTaskOutcome('task-1', { feedbackDir }).working, true);

    assert.throws(
      () => recordTaskOutcome(verifiedReceipt({ goal: 'Conflicting goal' }), { feedbackDir, recordTrace: false }),
      { code: 'THUMBGATE_IDEMPOTENCY_CONFLICT' },
    );
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('task outcome metrics expose denominators, safety, latency, cost, and business KPIs', () => {
  const outcomes = [
    normalizeTaskOutcome(verifiedReceipt({
      businessOutcome: { kpi: 'qualified_leads', value: 2, unit: 'lead' },
    })),
    normalizeTaskOutcome(verifiedReceipt({
      taskId: 'task-2',
      idempotencyKey: 'task-2',
      status: 'failed',
      verification: {
        performed: true,
        passed: false,
        evidence: ['provider rejected request'],
        unsupportedClaims: 0,
      },
      toolCalls: [{
        name: 'provider',
        contractValid: false,
        allowed: true,
        succeeded: false,
        attempts: 2,
        duplicateSideEffect: false,
      }],
      policy: { violations: 0, unsafeEscapes: 0, falseBlocks: 0 },
      failure: { category: 'contract', repeated: true, recovered: false, rolledBack: true },
      efficiency: { latencyMs: 1500, costUsd: 0.03, firstAttempt: false },
    })),
  ];
  const metrics = calculateTaskOutcomeMetrics(outcomes);

  assert.equal(metrics.sampleSize, 2);
  assert.equal(metrics.task.verifiedCompletionRate, 0.5);
  assert.equal(metrics.tools.contractAccuracy, 0.5);
  assert.equal(metrics.tools.retryRate, 0.5);
  assert.equal(metrics.efficiency.latencyP95Ms, 1500);
  assert.equal(metrics.efficiency.costPerVerifiedSuccessUsd, 0.05);
  assert.deepEqual(metrics.businessOutcomes, [{
    kpi: 'qualified_leads',
    unit: 'lead',
    value: 2,
    tasks: 1,
  }]);
});

test('human escalation requires evidence and a distinct human decision maker', () => {
  const feedbackDir = tempFeedbackDir();
  const now = new Date('2026-07-26T12:00:00Z');
  try {
    const requested = requestEscalation({
      taskId: 'task-risky',
      reason: 'Material external side effect',
      severity: 'high',
      requester: { id: 'agent-1', kind: 'agent' },
      evidence: ['policy requires review'],
      idempotencyKey: 'escalate-task-risky',
    }, { feedbackDir, now });
    const duplicate = requestEscalation({
      taskId: 'task-risky',
      reason: 'Material external side effect',
      severity: 'high',
      requester: { id: 'agent-1', kind: 'agent' },
      evidence: ['policy requires review'],
      idempotencyKey: 'escalate-task-risky',
    }, { feedbackDir, now });

    assert.equal(duplicate.recorded, false);
    assert.throws(() => decideEscalation({
      escalationId: requested.escalation.escalationId,
      decision: 'approved',
      actor: { id: 'agent-1', kind: 'agent' },
      reason: 'self approve',
    }, { feedbackDir, now }), /actor is derived from the authenticated reviewer/);
    assert.throws(() => decideEscalation({
      escalationId: requested.escalation.escalationId,
      decision: 'approved',
      reason: 'missing reviewer authentication',
    }, { feedbackDir, now }), /authenticatedActor identity is required/);
    assert.throws(() => decideEscalation({
      escalationId: requested.escalation.escalationId,
      decision: 'approved',
      reason: 'agent credential cannot approve',
    }, {
      authenticatedActor: { id: 'agent-2', kind: 'agent' },
      feedbackDir,
      now,
    }), /authenticatedActor.kind must be human/);

    const decided = decideEscalation({
      escalationId: requested.escalation.escalationId,
      decision: 'approved',
      reason: 'Evidence is sufficient',
    }, {
      authenticatedActor: { id: 'reviewer-1', kind: 'human' },
      feedbackDir,
      now: new Date('2026-07-26T12:05:00Z'),
    });
    const rows = listEscalations({ feedbackDir, now });
    const metrics = calculateEscalationMetrics(rows, now);

    assert.equal(decided.escalation.status, 'approved');
    assert.equal(rows.length, 1);
    assert.equal(metrics.approved, 1);
    assert.equal(metrics.medianDecisionLatencyMs, 300000);
  } finally {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
  }
});

test('golden outcome evaluation is complete and regression-free', () => {
  const report = runAgentOutcomeEval();
  assert.equal(report.pass, true);
  assert.equal(report.score, 100);
  assert.equal(report.total, 8);
  assert.deepEqual(report.regressions, []);
});

test('production monitor distinguishes insufficient evidence, blocked, and healthy', () => {
  const insufficient = monitorTaskOutcomes([normalizeTaskOutcome(verifiedReceipt())]);
  assert.equal(insufficient.verdict, 'insufficient_evidence');

  const healthyOutcomes = Array.from({ length: 3 }, (_, index) => normalizeTaskOutcome(verifiedReceipt({
    taskId: `healthy-${index}`,
    idempotencyKey: `healthy-${index}`,
  })));
  const thresholds = {
    minimumSamples: 3,
    verifiedCompletionRate: { operator: 'gte', value: 0.8, severity: 'block' },
    unsafeEscapeRate: { operator: 'lte', value: 0, severity: 'block' },
  };
  assert.equal(monitorTaskOutcomes(healthyOutcomes, { thresholds }).verdict, 'healthy');

  const unsafe = normalizeTaskOutcome(verifiedReceipt({
    taskId: 'unsafe',
    idempotencyKey: 'unsafe',
    policy: { violations: 1, unsafeEscapes: 1, falseBlocks: 0 },
  }));
  assert.equal(monitorTaskOutcomes([...healthyOutcomes.slice(0, 2), unsafe], { thresholds }).verdict, 'blocked');
});

test('production monitor blocks agents that complete demos but fail tools or policy', () => {
  const brokenOutcomes = Array.from({ length: 20 }, (_, index) => normalizeTaskOutcome(verifiedReceipt({
    taskId: `broken-${index}`,
    idempotencyKey: `broken-${index}`,
    toolCalls: [{
      name: 'provider',
      contractValid: true,
      allowed: true,
      succeeded: false,
      attempts: 1,
      duplicateSideEffect: false,
    }],
    policy: { violations: 1, unsafeEscapes: 0, falseBlocks: 0 },
  })));

  const report = monitorTaskOutcomes(brokenOutcomes);
  assert.equal(report.verdict, 'blocked');
  assert.equal(report.metrics.task.workingRate, 0);
  assert.equal(report.metrics.tools.executionSuccessRate, 0);
  assert.equal(report.metrics.safety.policyViolationRate, 1);
  assert.ok(report.alerts.some((alert) => alert.id === 'workingRate-threshold'));
  assert.ok(report.alerts.some((alert) => alert.id === 'executionSuccessRate-threshold'));
  assert.ok(report.alerts.some((alert) => alert.id === 'policyViolationRate-threshold'));
});

test('hosted outcome monitor uses operator authentication without returning it', async () => {
  const calls = [];
  const report = await fetchHostedMonitor({
    env: {
      THUMBGATE_OPERATOR_KEY: 'unit-operator-token',
      THUMBGATE_BILLING_API_BASE_URL: 'https://example.test',
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () => ({ verdict: 'healthy', sampleSize: 25 }),
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.test/v1/task-outcomes/monitor');
  assert.match(calls[0].init.headers.authorization, /^Bearer /);
  assert.equal(report.verdict, 'healthy');
  assert.equal(report.source, 'hosted');
  assert.doesNotMatch(JSON.stringify(report), /unit-operator-token/);
});

test('agent outcome monitor installs outside GitHub-hosted cron', () => {
  const parsed = parseArgs([
    '--install-schedule',
    '--hosted',
    '--working-directory=/tmp/thumbgate-project',
  ]);
  assert.equal(parsed.installSchedule, true);
  assert.equal(parsed.hosted, true);

  const schedule = buildAgentOutcomeMonitorSchedule({
    workingDirectory: '/tmp/thumbgate-project',
    outputPath: '/tmp/thumbgate-report.json',
  });
  assert.equal(schedule.id, 'thumbgate-agent-outcome-monitor');
  assert.equal(schedule.schedule, 'daily 10:17');
  assert.match(schedule.command, /--hosted/);
  assert.match(schedule.command, /thumbgate-report\.json/);
  assert.doesNotMatch(schedule.command, /OPERATOR_KEY|API_KEY|Bearer/);

  const calls = [];
  const result = installAgentOutcomeMonitorSchedule({
    workingDirectory: '/tmp/thumbgate-project',
  }, {
    createSchedule: (input) => {
      calls.push(input);
      return { success: true, schedule: input };
    },
  });
  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'thumbgate-agent-outcome-monitor');
});
