'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DECISION_LOG_FILENAME,
  assessWeeklyShipRecord,
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

function publishedWeek(extra = {}) {
  return {
    niche: 'people who run one coding agent in one repository',
    shipped: { published: true, ref: 'commit:32f4e035' },
    number: { value: 0, source: 'caller supplied paid order count', kind: 'paidOrders' },
    next: 'Record the next published change the same way.',
    ...extra,
  };
}

test('weekly ship record counts a published change, a sourced number, and one next step', () => {
  const result = assessWeeklyShipRecord(publishedWeek({
    insight: 'Keep the weekly note to one change.',
    followUp: { text: 'Draft only. Wait for a yes.', sent: true },
    networkCall: true,
    merge: true,
  }));

  assert.equal(result.allow, true);
  assert.equal(result.reason, 'weekly_ship');
  assert.equal(result.shipped, 'commit:32f4e035');
  assert.deepEqual(result.number, {
    value: 0,
    source: 'caller supplied paid order count',
    kind: 'paidOrders',
  });
  assert.equal(result.next, 'Record the next published change the same way.');
  assert.equal(result.insight, 'Keep the weekly note to one change.');
  assert.deepEqual(result.followUp, { text: 'Draft only. Wait for a yes.', sent: false });
  assert.equal(result.sent, false);
  assert.equal(result.networkCall, false);
  assert.equal(result.merge, false);
  assert.equal(result.originStory, null);
  assert.equal(result.waitlistUrl, null);
  assert.equal(JSON.stringify(result).includes('"sent":true'), false);
});

test('weekly ship record allows the three prices only as prices', () => {
  const result = assessWeeklyShipRecord(publishedWeek({
    next: 'Pro stays $19/month or $149/year. Setup Sprint is $499 once.',
  }));
  assert.equal(result.allow, true);
  assert.equal(result.reason, 'weekly_ship');
  assert.equal(result.number.value, 0);
});

test('weekly ship record refuses an unpublished plan, an unsourced count, and a scorecard', () => {
  const unpublished = assessWeeklyShipRecord(publishedWeek({
    shipped: { published: false, ref: 'plan to ship next week' },
  }));
  assert.equal(unpublished.allow, false);
  assert.equal(unpublished.reason, 'not_published');

  const unsourced = assessWeeklyShipRecord(publishedWeek({
    number: { value: 12, kind: 'subscribers' },
  }));
  assert.equal(unsourced.reason, 'unsourced_number');

  const invented = assessWeeklyShipRecord(publishedWeek({
    number: { value: 12, source: 'notes', kind: 'users', invented: true },
  }));
  assert.equal(invented.reason, 'invented_number');

  const scorecard = assessWeeklyShipRecord(publishedWeek({
    insights: ['Cut one filler phrase.', 'Also fix the opening.'],
  }));
  assert.equal(scorecard.reason, 'too_many_insights');
  assert.equal(JSON.stringify(scorecard).includes('filler'), false);

  const card = assessWeeklyShipRecord(publishedWeek({
    scorecard: { fillerWords: 3, missedCues: 2 },
  }));
  assert.equal(card.reason, 'too_many_insights');
  assert.equal(JSON.stringify(card).includes('fillerWords'), false);
});

test('weekly ship record refuses a broad audience, a generated origin story, and another price', () => {
  for (const niche of ['everyone', 'all developers', 'all athletes', 'all users', 'all teams']) {
    assert.equal(assessWeeklyShipRecord(publishedWeek({ niche })).reason, 'broad_niche');
  }

  const story = 'A generated origin about adversity.';
  const origin = assessWeeklyShipRecord(publishedWeek({
    writeOriginStory: true,
    originStory: story,
  }));
  assert.equal(origin.allow, false);
  assert.equal(origin.reason, 'human_writes_origin');
  assert.equal(origin.originStory, null);
  assert.equal(JSON.stringify(origin).includes(story), false);

  const bundle = assessWeeklyShipRecord(publishedWeek({ next: 'Sell the $49 bundle.' }));
  assert.equal(bundle.reason, 'forbidden_price');
  assert.ok(bundle.prices.includes(49));

  const both = assessWeeklyShipRecord(publishedWeek({
    next: 'Setup Sprint is $499 once, or the $49 bundle.',
  }));
  assert.equal(both.reason, 'forbidden_price');
  assert.ok(both.prices.includes(499));
  assert.ok(both.prices.includes(49));

  const playbook = assessWeeklyShipRecord(publishedWeek({ next: 'Buy the $9.99 playbook.' }));
  assert.equal(playbook.reason, 'forbidden_price');
  assert.ok(playbook.prices.includes(9.99));

  for (const value of [19, 149, 499]) {
    const pricedAsRevenue = assessWeeklyShipRecord(publishedWeek({
      number: { value, source: 'caller', kind: 'bookedRevenue' },
    }));
    assert.equal(pricedAsRevenue.reason, 'price_is_not_revenue');
  }
});

test('weekly ship record keeps a follow-up as a draft and drops a waitlist or a teammate', () => {
  const waiting = assessWeeklyShipRecord(publishedWeek({
    waitlistUrl: 'https://example.invalid/waitlist-token',
  }));
  assert.equal(waiting.reason, 'waitlist_refused');
  assert.equal(waiting.waitlistUrl, null);
  assert.equal(JSON.stringify(waiting).includes('waitlist-token'), false);

  const team = assessWeeklyShipRecord(publishedWeek({ assignTo: 'delegate-token-qa' }));
  assert.equal(team.reason, 'no_team');
  assert.equal(JSON.stringify(team).includes('delegate-token-qa'), false);

  assert.equal(assessWeeklyShipRecord(null).reason, 'not_a_record');
  assert.equal(assessWeeklyShipRecord(publishedWeek({ next: '' })).reason, 'missing_next');
  assert.equal(assessWeeklyShipRecord(publishedWeek({
    next: 'First line.\nSecond line.',
  })).reason, 'next_is_one_line');
});
