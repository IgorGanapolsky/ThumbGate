'use strict';

/**
 * tests/hermes-mobile-launch-strategy.test.js
 *
 * FUTRFND high-ROI: demand validation, signal metrics, interviews, trials, CLI, API.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const http = require('node:http');

const strategy = require('../scripts/hermes-mobile-launch-strategy');
const { createApiServer } = require('../src/api/server');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

function tmpStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tg-hermes-launch-'));
}

test('getExecutionPhase calculates correct 90-day FUTRFND execution phases', () => {
  const base = new Date('2026-08-01T00:00:00Z');

  const day10 = new Date('2026-08-11T00:00:00Z').toISOString();
  const phase10 = strategy.getExecutionPhase(base.toISOString(), day10);
  assert.equal(phase10.phase, 'DAYS_1_30_FOUNDATION');
  assert.equal(phase10.dayNumber, 11);

  const day45 = new Date('2026-09-15T00:00:00Z').toISOString();
  const phase45 = strategy.getExecutionPhase(base.toISOString(), day45);
  assert.equal(phase45.phase, 'DAYS_31_60_LAUNCH_LEARN');

  const day75 = new Date('2026-10-15T00:00:00Z').toISOString();
  const phase75 = strategy.getExecutionPhase(base.toISOString(), day75);
  assert.equal(phase75.phase, 'DAYS_61_90_OPTIMIZE_GROW');
});

test('empty default state has zero fake conversions (honest demand validation)', () => {
  const empty = strategy.createEmptyLaunchState('2026-08-12T00:00:00Z');
  assert.equal(empty.outreach.length, 0);
  assert.equal(empty.trials.length, 0);
  assert.equal(empty.inAppRatings.length, 0);
  const metrics = strategy.calculateSignalMetrics(empty);
  assert.equal(metrics.freeTrialToPaidConversion.totalTrials, 0);
  assert.equal(metrics.freeTrialToPaidConversion.convertedCount, 0);
  assert.equal(metrics.userFeedbackRating.totalScores, 0);
});

test('calculateSignalMetrics computes Bayesian feedback rating & Beta-Binomial conversion rate', () => {
  const sampleState = {
    outreach: [
      { status: 'interviewed', featureAlignmentScore: 4.8, remoteControlPainPoints: ['Unmonitored mobile commands'] },
      { status: 'interviewed', featureAlignmentScore: 4.2, remoteControlPainPoints: ['Secret leakage'] },
    ],
    trials: [
      { id: 't1', convertedToPaid: true },
      { id: 't2', convertedToPaid: true },
      { id: 't3', convertedToPaid: false },
    ],
    inAppRatings: [],
  };

  const metrics = strategy.calculateSignalMetrics(sampleState);

  assert.equal(metrics.userFeedbackRating.rawAverage, 4.5);
  assert.equal(metrics.userFeedbackRating.bayesianSmoothed, 4.25);
  assert.equal(metrics.freeTrialToPaidConversion.convertedCount, 2);
  assert.equal(metrics.freeTrialToPaidConversion.totalTrials, 3);
  assert.ok(metrics.freeTrialToPaidConversion.bayesianMeanPct > 0);
  assert.equal(metrics.freeTrialToPaidConversion.credibleInterval95Pct.length, 2);
});

test('in-app ratings blend into user feedback rating signal', () => {
  const state = {
    outreach: [{ status: 'interviewed', featureAlignmentScore: 4.0 }],
    trials: [],
    inAppRatings: [{ score: 2 }, { score: 2 }],
  };
  const metrics = strategy.calculateSignalMetrics(state);
  // (4+2+2)/3 = 2.67 raw; bayesian (8 + 8)/5 = 3.2
  assert.equal(metrics.userFeedbackRating.rawAverage, 2.67);
  assert.equal(metrics.userFeedbackRating.totalInAppRatings, 2);
  assert.equal(metrics.userFeedbackRating.totalScores, 3);
});

test('mapSignalToRating maps thumbs and explicit scores', () => {
  assert.equal(strategy.mapSignalToRating('up'), 5);
  assert.equal(strategy.mapSignalToRating('down'), 2);
  assert.equal(strategy.mapSignalToRating(null, 4), 4);
  assert.equal(strategy.mapSignalToRating('up', 1), 1);
});

test('getDemandValidationReport is no-go until interview + rating + trial thresholds', () => {
  const empty = strategy.createEmptyLaunchState();
  const reportEmpty = strategy.getDemandValidationReport(empty);
  assert.equal(reportEmpty.readyToScaleMonetization, false);
  assert.equal(reportEmpty.priority, 'VALIDATE_USER_DEMAND');

  const ready = {
    outreach: Array.from({ length: 5 }, (_, i) => ({
      status: 'interviewed',
      featureAlignmentScore: 4.5,
      contactName: `op-${i}`,
    })),
    trials: Array.from({ length: 5 }, (_, i) => ({
      id: `t-${i}`,
      convertedToPaid: i < 2,
    })),
    inAppRatings: [{ score: 4 }],
  };
  const reportReady = strategy.getDemandValidationReport(ready);
  assert.equal(reportReady.readyToScaleMonetization, true);
  assert.ok(reportReady.headline.includes('CLEAR'));
});

test('auditLaunchRisks identifies misaligned features and inadequate feedback loops', () => {
  const lowState = {
    outreach: [{ status: 'interviewed', featureAlignmentScore: 2.0 }],
    trials: [],
    inAppRatings: [],
  };

  const audit = strategy.auditLaunchRisks(lowState);
  assert.equal(audit.auditPassed, false);
  assert.ok(audit.risks.some((r) => r.riskId === 'MISALIGNED_FEATURES'));
  assert.ok(audit.risks.some((r) => r.riskId === 'INADEQUATE_FEEDBACK_LOOP'));
  assert.ok(audit.risks.some((r) => r.riskId === 'PREMATURE_MONETIZATION'));
});

test('recordOutreach, recordTrial, convertTrial, recordInAppFeedback persist state', () => {
  const dir = tmpStateDir();
  try {
    strategy.saveLaunchState(strategy.createEmptyLaunchState(), dir);

    const outreach = strategy.recordOutreach({
      contactName: 'Ops Beta',
      featureAlignmentScore: 4.2,
      notes: 'pairing friction on cellular',
      remoteControlPainPoints: ['cellular-pairing-friction'],
    }, dir);
    assert.equal(outreach.contactName, 'Ops Beta');

    const trial = strategy.recordTrial({ user: 'ops-beta', status: 'active_trial' }, dir);
    assert.equal(trial.convertedToPaid, false);

    const converted = strategy.convertTrial(trial.id, dir);
    assert.equal(converted.found, true);
    assert.equal(converted.trial.convertedToPaid, true);

    const rating = strategy.recordInAppFeedback({ signal: 'up', context: 'approval_card' }, dir);
    assert.equal(rating.score, 5);

    const dash = strategy.getLaunchDashboard(dir);
    assert.equal(dash.counts.outreach, 1);
    assert.equal(dash.counts.trials, 1);
    assert.equal(dash.counts.inAppRatings, 1);
    assert.equal(dash.signalMetrics.freeTrialToPaidConversion.convertedCount, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildOutreachDraft includes UTM trial link and interview script', () => {
  const draft = strategy.buildOutreachDraft({
    contactName: 'Alex',
    channel: 'linkedin',
    baseUrl: 'https://thumbgate.ai/hermes-mobile',
  });
  assert.ok(draft.subject.includes('15 minutes'));
  assert.ok(draft.body.includes('Alex'));
  assert.ok(draft.trialUrl.includes('utm_source=linkedin'));
  assert.ok(draft.trialUrl.includes('utm_campaign=hermes_mobile_interview'));
  assert.equal(draft.interviewScript.durationMinutes, 15);
  assert.equal(draft.disclaimer.includes('never auto-send'), true);
});

test('listInterviewTargets tracks remaining vs target of 10', () => {
  const targets = strategy.listInterviewTargets({
    outreach: [
      { contactName: 'A', status: 'interviewed', featureAlignmentScore: 4 },
      { contactName: 'B', status: 'scheduled', featureAlignmentScore: 0 },
    ],
  });
  assert.equal(targets.targetCount, 10);
  assert.equal(targets.completedCount, 1);
  assert.equal(targets.remaining, 8);
  assert.ok(targets.channels.length >= 3);
  assert.ok(targets.script.questions.length >= 4);
});

test('autoPromoteHermesFeedback turns remote control pain points into prevention rules', () => {
  const tmpDir = tmpStateDir();
  try {
    const initialState = {
      ...strategy.createEmptyLaunchState(),
      outreach: [
        { status: 'interviewed', remoteControlPainPoints: ['unmonitored-mobile-shell-execution'] },
      ],
    };
    strategy.saveLaunchState(initialState, tmpDir);

    const result = strategy.autoPromoteHermesFeedback(tmpDir);
    assert.equal(result.promotedCount, 1);
    assert.equal(result.promotedRules[0].pattern, 'unmonitored-mobile-shell-execution');

    const rulesFile = path.join(tmpDir, 'rules.json');
    assert.ok(fs.existsSync(rulesFile));
    const savedRules = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
    assert.ok(savedRules.some((r) => r.pattern === 'unmonitored-mobile-shell-execution'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI hermes-launch status outputs expected summary', () => {
  const tmpDir = tmpStateDir();
  try {
    const out = execFileSync('node', [CLI, 'hermes-launch', 'status'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        THUMBGATE_STATE_DIR: tmpDir,
      },
    });

    assert.ok(out.includes('Hermes Mobile FUTRFND Launch Strategy'));
    assert.ok(out.includes('Signal Metrics:'));
    assert.ok(out.includes('User Feedback Rating:'));
    assert.ok(out.includes('Demand Validation:'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI hermes-launch outreach and trial and draft subcommands', () => {
  const tmpDir = tmpStateDir();
  try {
    const outreachOut = execFileSync(
      'node',
      [CLI, 'hermes-launch', 'outreach', '--name=Casey', '--score=4.5', '--notes=needs-lan-pair'],
      { encoding: 'utf8', env: { ...process.env, THUMBGATE_STATE_DIR: tmpDir } },
    );
    assert.ok(outreachOut.includes('Casey'));

    const trialOut = execFileSync(
      'node',
      [CLI, 'hermes-launch', 'trial', '--user=casey', '--converted=false'],
      { encoding: 'utf8', env: { ...process.env, THUMBGATE_STATE_DIR: tmpDir } },
    );
    assert.ok(trialOut.includes('trial'));

    const draftOut = execFileSync(
      'node',
      [CLI, 'hermes-launch', 'draft', '--name=Casey', '--channel=linkedin'],
      { encoding: 'utf8', env: { ...process.env, THUMBGATE_STATE_DIR: tmpDir } },
    );
    assert.ok(draftOut.includes('utm_source=linkedin'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('REST API GET /api/hermes-mobile/launch-metrics returns live launch metrics', async () => {
  const apiKey = process.env.THUMBGATE_API_KEY || 'test-api-key';
  process.env.THUMBGATE_API_KEY = apiKey;
  const server = createApiServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const res = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/api/hermes-mobile/launch-metrics`, {
        headers: { 'x-api-key': apiKey },
      }, (response) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve({ statusCode: response.statusCode, data: JSON.parse(body) }));
      }).on('error', reject);
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.data.success, true);
    assert.ok(res.data.executionPhase);
    assert.ok(res.data.signalMetrics);
    assert.ok(res.data.riskAudit);
    assert.ok(res.data.demandValidation);
  } finally {
    server.close();
  }
});
