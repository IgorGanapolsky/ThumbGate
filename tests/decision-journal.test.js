'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DECISION_LOG_FILENAME,
  collapseDecisionTimeline,
  computeDecisionMetrics,
  readDecisionLog,
  recordDecisionEvaluation,
  recordDecisionOutcome,
} = require('../scripts/decision-journal');

function withTempDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-decision-journal-'));
  const previous = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  try {
    return fn(tmpDir);
  } finally {
    if (previous === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = previous;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

test('decision journal records evaluations and outcomes with computed latency', () => {
  withTempDir((tmpDir) => {
    const evaluation = recordDecisionEvaluation({
      toolName: 'Bash',
      decision: 'warn',
      riskScore: 0.61,
      band: 'high',
      summary: 'Predicted workflow risk is elevated before execution.',
      blastRadius: {
        severity: 'high',
        fileCount: 3,
        surfaceCount: 2,
        affectedFiles: ['src/api/server.js', 'tests/api-server.test.js'],
      },
      decisionControl: {
        executionMode: 'checkpoint_required',
        decisionOwner: 'human',
        reversibility: 'one_way_door',
        requiresHumanApproval: true,
        recommendedAction: 'review',
      },
    }, {
      toolName: 'Bash',
      toolInput: { command: 'npm publish', changedFiles: ['package.json'] },
      changedFiles: ['package.json'],
      timestamp: '2026-04-09T12:00:00.000Z',
    });

    const outcome = recordDecisionOutcome({
      actionId: evaluation.actionId,
      outcome: 'overridden',
      actualDecision: 'warn',
      actor: 'human',
      notes: 'Needed a manual checkpoint before release.',
      timestamp: '2026-04-09T12:05:00.000Z',
    });

    assert.equal(outcome.latencyMs, 5 * 60 * 1000);
    const logPath = path.join(tmpDir, DECISION_LOG_FILENAME);
    const entries = readDecisionLog(logPath);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].recordType, 'evaluation');
    assert.equal(entries[1].recordType, 'outcome');
  });
});

test('collapseDecisionTimeline groups records by actionId', () => {
  withTempDir(() => {
    const evaluation = recordDecisionEvaluation({
      toolName: 'Edit',
      decision: 'allow',
      riskScore: 0.1,
      band: 'low',
      summary: 'No predictive blockers detected.',
      blastRadius: {
        severity: 'low',
        fileCount: 1,
        surfaceCount: 1,
        affectedFiles: ['README.md'],
      },
      decisionControl: {
        executionMode: 'auto_execute',
        decisionOwner: 'agent',
        reversibility: 'two_way_door',
        requiresHumanApproval: false,
        recommendedAction: 'proceed',
      },
    }, {
      toolName: 'Edit',
      toolInput: { filePath: 'README.md' },
      changedFiles: ['README.md'],
      timestamp: '2026-04-09T08:00:00.000Z',
    });

    recordDecisionOutcome({
      actionId: evaluation.actionId,
      outcome: 'completed',
      actor: 'agent',
      timestamp: '2026-04-09T08:01:30.000Z',
    });

    const timeline = collapseDecisionTimeline(readDecisionLog());
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].actionId, evaluation.actionId);
    assert.equal(timeline[0].outcomes.length, 1);
    assert.equal(timeline[0].outcomes[0].outcome, 'completed');
  });
});

test('computeDecisionMetrics summarizes fast-path, overrides, rollbacks, and latency', () => {
  withTempDir(() => {
    // Pin a synthetic "now" and anchor events three days earlier so both the
    // day-series window and the event timestamps share a single clock. This
    // removes the day-boundary flake where CI crossing UTC midnight between
    // event inserts and metrics aggregation dropped events out of the window.
    const pinnedNow = new Date('2026-06-15T12:00:00.000Z');
    const baseDate = new Date(pinnedNow.getTime() - 3 * 24 * 60 * 60 * 1000);
    baseDate.setUTCHours(0, 0, 0, 0);
    const baseMs = baseDate.getTime();
    const iso = (hours, minutes = 0, seconds = 0) =>
      new Date(baseMs + ((hours * 60 + minutes) * 60 + seconds) * 1000).toISOString();

    const fastPath = recordDecisionEvaluation({
      toolName: 'Edit',
      decision: 'allow',
      riskScore: 0.08,
      band: 'low',
      summary: 'Safe to execute quickly.',
      blastRadius: {
        severity: 'low',
        fileCount: 1,
        surfaceCount: 1,
        affectedFiles: ['README.md'],
      },
      decisionControl: {
        executionMode: 'auto_execute',
        decisionOwner: 'agent',
        reversibility: 'two_way_door',
        requiresHumanApproval: false,
        recommendedAction: 'proceed',
      },
    }, {
      toolName: 'Edit',
      toolInput: { filePath: 'README.md' },
      changedFiles: ['README.md'],
      timestamp: iso(9),
    });
    recordDecisionOutcome({
      actionId: fastPath.actionId,
      outcome: 'completed',
      actor: 'agent',
      timestamp: iso(9, 1),
    });

    const warned = recordDecisionEvaluation({
      toolName: 'Bash',
      decision: 'warn',
      riskScore: 0.61,
      band: 'high',
      summary: 'Pause for explicit review before executing this action.',
      blastRadius: {
        severity: 'high',
        fileCount: 2,
        surfaceCount: 2,
        affectedFiles: ['package.json', 'server.json'],
      },
      decisionControl: {
        executionMode: 'checkpoint_required',
        decisionOwner: 'human',
        reversibility: 'one_way_door',
        requiresHumanApproval: true,
        recommendedAction: 'review',
      },
    }, {
      toolName: 'Bash',
      toolInput: { command: 'npm publish' },
      changedFiles: ['package.json', 'server.json'],
      timestamp: iso(10),
    });
    recordDecisionOutcome({
      actionId: warned.actionId,
      outcome: 'overridden',
      actualDecision: 'warn',
      actor: 'human',
      timestamp: iso(10, 6),
    });

    const blocked = recordDecisionEvaluation({
      toolName: 'Bash',
      decision: 'deny',
      riskScore: 0.9,
      band: 'very_high',
      summary: 'Do not proceed until the remediation steps are completed.',
      blastRadius: {
        severity: 'critical',
        fileCount: 3,
        surfaceCount: 2,
        affectedFiles: ['package.json', '.github/workflows/release.yml'],
      },
      decisionControl: {
        executionMode: 'blocked',
        decisionOwner: 'human',
        reversibility: 'one_way_door',
        requiresHumanApproval: false,
        recommendedAction: 'halt',
      },
    }, {
      toolName: 'Bash',
      toolInput: { command: 'gh pr merge --admin' },
      changedFiles: ['package.json', '.github/workflows/release.yml'],
      timestamp: iso(11),
    });
    recordDecisionOutcome({
      actionId: blocked.actionId,
      outcome: 'rolled_back',
      actualDecision: 'deny',
      actor: 'system',
      timestamp: iso(11, 3),
    });

    const metrics = computeDecisionMetrics(undefined, { now: pinnedNow });
    assert.equal(metrics.evaluationCount, 3);
    assert.equal(metrics.fastPathCount, 1);
    assert.equal(metrics.overrideCount, 1);
    assert.equal(metrics.rollbackCount, 1);
    assert.equal(metrics.resolvedCount, 3);
    assert.equal(metrics.fastPathRate, 0.3333);
    assert.equal(metrics.overrideRate, 0.3333);
    assert.equal(metrics.rollbackRate, 0.3333);
    assert.equal(metrics.medianLatencyMs, 180000);
    assert.ok(metrics.days.some((day) => day.evaluations > 0));
  });
});
