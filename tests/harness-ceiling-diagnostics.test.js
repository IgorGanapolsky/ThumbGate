'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  FAILURE_CLASSES,
  DEFAULT_NOISE_SIGMA,
  classifyTrajectory,
  analyzeFailureComposition,
  decomposeScoreDelta,
  computeSelectionOptimismBound,
  diagnoseIntervention,
  classifyEditSurface,
  generateFixtureTrajectories,
} = require('../scripts/harness-ceiling-diagnostics.js');

test('classifyTrajectory classifies healthy trajectories when score >= 0.5', () => {
  const res = classifyTrajectory({ score: 0.85, delivered: true });
  assert.equal(res.classification, FAILURE_CLASSES.HEALTHY);
  assert.equal(res.delivered, true);
  assert.equal(res.score, 0.85);
});

test('classifyTrajectory identifies F1 (evidence) failures', () => {
  // Unbacked citations >= 0.5
  const res1 = classifyTrajectory({ score: 0.3, delivered: true, unbackedCitationRatio: 0.55 });
  assert.equal(res1.classification, FAILURE_CLASSES.F1_EVIDENCE);
  assert.match(res1.reason, /Unbacked citation ratio/);

  // Unresolved checklist items
  const res2 = classifyTrajectory({ score: 0.4, delivered: true, unresolvedChecklistItems: 3 });
  assert.equal(res2.classification, FAILURE_CLASSES.F1_EVIDENCE);
  assert.match(res2.reason, /unresolved checklist items/);
});

test('classifyTrajectory identifies F2 (harness friction) failures', () => {
  // >= 10 blocked tool calls
  const res1 = classifyTrajectory({ score: 0.2, delivered: false, blockedToolCalls: 12 });
  assert.equal(res1.classification, FAILURE_CLASSES.F2_FRICTION);
  assert.match(res1.reason, /blocked 12 tool calls/);

  // Forced checkpoint unlock
  const res2 = classifyTrajectory({ score: 0.1, delivered: false, forcedCheckpointUnlock: true });
  assert.equal(res2.classification, FAILURE_CLASSES.F2_FRICTION);
  assert.match(res2.reason, /forced checkpoint unlock/);
});

test('classifyTrajectory identifies F3 (execution control) failures', () => {
  // Repeated tool calls >= 3
  const res1 = classifyTrajectory({ score: 0.0, delivered: false, maxRepeatedToolCalls: 3 });
  assert.equal(res1.classification, FAILURE_CLASSES.F3_EXECUTION);
  assert.match(res1.reason, /repeated 3 times/);

  // Step budget >= 90%
  const res2 = classifyTrajectory({ score: 0.1, delivered: false, stepBudgetUsedPercent: 92 });
  assert.equal(res2.classification, FAILURE_CLASSES.F3_EXECUTION);
  assert.match(res2.reason, /Step budget exhausted/);

  // Runtime timeout
  const res3 = classifyTrajectory({ score: 0.0, delivered: false, timedOut: true });
  assert.equal(res3.classification, FAILURE_CLASSES.F3_EXECUTION);
  assert.match(res3.reason, /timeout/);
});

test('classifyTrajectory identifies F4 (planning capacity / content) failures', () => {
  // Delivered cleanly, score < 0.5, no process signals
  const res = classifyTrajectory({ score: 0.35, delivered: true });
  assert.equal(res.classification, FAILURE_CLASSES.F4_CONTENT);
  assert.match(res.reason, /Plan delivered cleanly without process signals/);
});

test('analyzeFailureComposition calculates mathematical score identities (S = r * q_bar)', () => {
  const trajs = [
    { score: 0.8, delivered: true },
    { score: 0.6, delivered: true },
    { score: 0.0, delivered: false, maxRepeatedToolCalls: 4 },
    { score: 0.4, delivered: true },
  ];

  const analysis = analyzeFailureComposition(trajs);
  assert.equal(analysis.total, 4);
  assert.equal(analysis.deliveryRate, 0.75); // 3 delivered out of 4
  const expectedQBar = (0.8 + 0.6 + 0.4) / 3;
  assert.equal(Number(analysis.meanQualityDelivered.toFixed(4)), Number(expectedQBar.toFixed(4)));
  assert.equal(Number(analysis.compositeScore.toFixed(4)), Number((0.75 * expectedQBar).toFixed(4)));

  assert.equal(analysis.counts.HEALTHY, 2);
  assert.equal(analysis.counts.F3_EXECUTION, 1);
  assert.equal(analysis.counts.F4_CONTENT, 1);
});

test('decomposeScoreDelta implements Eq. 2 delivery vs quality decomposition', () => {
  const seed = {
    deliveryRate: 0.50,
    meanQualityDelivered: 0.30,
    compositeScore: 0.15,
  };
  const evolved = {
    deliveryRate: 0.90,
    meanQualityDelivered: 0.40,
    compositeScore: 0.36,
  };

  const delta = decomposeScoreDelta(seed, evolved);
  // Delta r = 0.40, q_bar = 0.30 -> deliveryTerm = 0.12
  // r_prime = 0.90, Delta q_bar = 0.10 -> qualityTerm = 0.09
  // total = 0.21
  assert.equal(Number(delta.deliveryTerm.toFixed(4)), 0.12);
  assert.equal(Number(delta.qualityTerm.toFixed(4)), 0.09);
  assert.equal(Number(delta.reconstructedDelta.toFixed(4)), 0.21);
  assert.equal(Number(delta.totalDelta.toFixed(4)), 0.21);
});

test('computeSelectionOptimismBound implements Proposition 1 s * sqrt(2 * ln(K))', () => {
  const res = computeSelectionOptimismBound(10, 0.023, 4);
  // s = 0.023 / sqrt(4) = 0.0115
  // sqrt(2 * ln(10)) = sqrt(2 * 2.302585) = sqrt(4.60517) = 2.145966
  // bound = 0.0115 * 2.145966 = 0.0246786
  assert.equal(Number(res.perReadingStdDev.toFixed(4)), 0.0115);
  assert.ok(Math.abs(res.selectionOptimismBound - 0.02468) < 0.001);
  assert.equal(res.resolvableDeltaThreshold, 0.035);
});

test('diagnoseIntervention identifies WEIGHT_TRAINING_CEILING when delivery is saturated and F4 dominates', () => {
  const ceilingMetrics = analyzeFailureComposition(generateFixtureTrajectories('ceilinged'));
  const diag = diagnoseIntervention(ceilingMetrics);

  assert.equal(diag.recommendation, 'WEIGHT_TRAINING_CEILING');
  assert.equal(diag.primaryLever, 'WEIGHT_TRAINING_DPO');
  assert.match(diag.reason, /Harness evolution has ceilinged/);
  assert.ok(diag.actions.some((a) => a.includes('thumbgate export-dpo')));
});

test('diagnoseIntervention identifies HARNESS_EVOLUTION when loops/process failures dominate', () => {
  const processMetrics = analyzeFailureComposition(generateFixtureTrajectories('process_heavy'));
  const diag = diagnoseIntervention(processMetrics);

  assert.equal(diag.recommendation, 'HARNESS_EVOLUTION');
  assert.equal(diag.primaryLever, 'HARNESS_RUNTIME');
  assert.match(diag.reason, /Process failures dominate/);
  assert.ok(diag.actions.some((a) => a.includes('state ledger')));
});

test('diagnoseIntervention identifies HARNESS_FRICTION_CALIBRATION when F2 is elevated', () => {
  const frictionMetrics = analyzeFailureComposition(generateFixtureTrajectories('harness_friction'));
  const diag = diagnoseIntervention(frictionMetrics);

  assert.equal(diag.recommendation, 'HARNESS_FRICTION_CALIBRATION');
  assert.equal(diag.primaryLever, 'RELAX_GATE_RULES');
  assert.match(diag.reason, /Harness friction \(F2\)/);
});

test('classifyEditSurface separates what model writes vs what model sees', () => {
  const edits = [
    'src/prompts/system-planning.txt',
    'src/tools/schema-flight-search.json',
    'src/harness/context-history-pages.js',
    'src/memory/state-ledger-store.js',
    'config/rules/output-formatting.json',
  ];

  const res = classifyEditSurface(edits);
  assert.deepEqual(res.writes, [
    'src/prompts/system-planning.txt',
    'src/tools/schema-flight-search.json',
    'config/rules/output-formatting.json',
  ]);
  assert.deepEqual(res.sees, [
    'src/harness/context-history-pages.js',
    'src/memory/state-ledger-store.js',
  ]);
  assert.equal(res.distillablePercentage, 60);
  assert.match(res.guidance, /SEES/);
});

test('CLI runs cleanly in JSON and map-only modes', () => {
  const script = path.join(__dirname, '..', 'scripts', 'harness-ceiling-diagnostics.js');

  const runMap = spawnSync(process.execPath, [script, '--map-only'], { encoding: 'utf8' });
  assert.equal(runMap.status, 0);
  const mapObj = JSON.parse(runMap.stdout);
  assert.equal(mapObj.paper, 'arXiv:2610.11655');

  const runJson = spawnSync(process.execPath, [script, '--json', '--profile=ceilinged'], { encoding: 'utf8' });
  assert.equal(runJson.status, 0);
  const jsonObj = JSON.parse(runJson.stdout);
  assert.equal(jsonObj.diagnosis.recommendation, 'WEIGHT_TRAINING_CEILING');
});
