'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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

const SCRIPT = path.join(__dirname, '..', 'scripts', 'harness-ceiling-diagnostics.js');
const REFUSED = ['export-dpo', 'QLoRA', 'WEIGHT_TRAINING', 'RELAX_GATE_RULES', 'LoRA'];

function writeTrace(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ceiling-'));
  const file = path.join(dir, 'trace.json');
  fs.writeFileSync(file, JSON.stringify(rows));
  return file;
}

function runScript(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

test('classifyTrajectory classifies healthy trajectories when score >= 0.5', () => {
  const res = classifyTrajectory({ score: 0.85, delivered: true });
  assert.equal(res.classification, FAILURE_CLASSES.HEALTHY);
  assert.equal(res.delivered, true);
  assert.equal(res.score, 0.85);
});

test('classifyTrajectory applies failure signals before a healthy label', () => {
  const evidence = classifyTrajectory({ score: 0.9, delivered: true, unbackedCitationRatio: 1 });
  assert.equal(evidence.classification, FAILURE_CLASSES.F1_EVIDENCE);

  const friction = classifyTrajectory({ score: 0.9, delivered: true, forcedCheckpointUnlock: true });
  assert.equal(friction.classification, FAILURE_CLASSES.F2_FRICTION);

  const execution = classifyTrajectory({ score: 0.9, delivered: true, timedOut: true });
  assert.equal(execution.classification, FAILURE_CLASSES.F3_EXECUTION);
});

test('classifyTrajectory identifies F1 (evidence) failures', () => {
  const res1 = classifyTrajectory({ score: 0.3, delivered: true, unbackedCitationRatio: 0.55 });
  assert.equal(res1.classification, FAILURE_CLASSES.F1_EVIDENCE);
  assert.match(res1.reason, /Unbacked citation ratio/);

  const res2 = classifyTrajectory({ score: 0.4, delivered: true, unresolvedChecklistItems: 3 });
  assert.equal(res2.classification, FAILURE_CLASSES.F1_EVIDENCE);
  assert.match(res2.reason, /unresolved checklist items/);
});

test('classifyTrajectory identifies F2 (harness friction) failures', () => {
  const res1 = classifyTrajectory({ score: 0.2, delivered: false, blockedToolCalls: 12 });
  assert.equal(res1.classification, FAILURE_CLASSES.F2_FRICTION);
  assert.match(res1.reason, /blocked 12 tool calls/);

  const res2 = classifyTrajectory({ score: 0.1, delivered: false, forcedCheckpointUnlock: true });
  assert.equal(res2.classification, FAILURE_CLASSES.F2_FRICTION);
  assert.match(res2.reason, /forced checkpoint unlock/);
});

test('classifyTrajectory identifies F3 (execution control) failures', () => {
  const res1 = classifyTrajectory({ score: 0.0, delivered: false, maxRepeatedToolCalls: 3 });
  assert.equal(res1.classification, FAILURE_CLASSES.F3_EXECUTION);
  assert.match(res1.reason, /repeated 3 times/);

  const res2 = classifyTrajectory({ score: 0.1, delivered: false, stepBudgetUsedPercent: 92 });
  assert.equal(res2.classification, FAILURE_CLASSES.F3_EXECUTION);
  assert.match(res2.reason, /Step budget exhausted/);

  const res3 = classifyTrajectory({ score: 0.0, delivered: false, timedOut: true });
  assert.equal(res3.classification, FAILURE_CLASSES.F3_EXECUTION);
  assert.match(res3.reason, /timeout/);
});

test('classifyTrajectory identifies F4 (planning capacity / content) failures', () => {
  const res = classifyTrajectory({ score: 0.35, delivered: true });
  assert.equal(res.classification, FAILURE_CLASSES.F4_CONTENT);
  assert.match(res.reason, /Plan delivered cleanly without process signals/);
});

test('a missing delivered flag is not delivery, even when a score and output are present', () => {
  const res = classifyTrajectory({ score: 0.9, output: 'plan' });
  assert.equal(res.delivered, false);
  assert.notEqual(res.classification, FAILURE_CLASSES.HEALTHY);
  assert.equal(res.classification, FAILURE_CLASSES.UNDELIVERED);
  assert.notEqual(res.classification, FAILURE_CLASSES.F4_CONTENT);
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
  assert.equal(analysis.deliveryRate, 0.75);
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
  assert.equal(Number(delta.deliveryTerm.toFixed(4)), 0.12);
  assert.equal(Number(delta.qualityTerm.toFixed(4)), 0.09);
  assert.equal(Number(delta.reconstructedDelta.toFixed(4)), 0.21);
  assert.equal(Number(delta.totalDelta.toFixed(4)), 0.21);
});

test('computeSelectionOptimismBound implements Proposition 1 only when sigma is measured', () => {
  assert.equal(DEFAULT_NOISE_SIGMA, 0.023);
  const res = computeSelectionOptimismBound(10, 0.023, 4);
  assert.equal(res.noiseMeasured, true);
  assert.equal(Number(res.perReadingStdDev.toFixed(4)), 0.0115);
  assert.ok(Math.abs(res.selectionOptimismBound - 0.02468) < 0.001);
  assert.equal(res.resolvableDeltaThreshold, 0.035);

  const unmeasured = computeSelectionOptimismBound(10);
  assert.equal(unmeasured.noiseMeasured, false);
  assert.equal(unmeasured.selectionOptimismBound, null);
  assert.equal(unmeasured.resolvableDeltaThreshold, null);

  const zero = computeSelectionOptimismBound(10, 0, 4);
  assert.equal(zero.noiseMeasured, true);
  assert.equal(zero.perReadingStdDev, 0);
  assert.equal(zero.selectionOptimismBound, 0);
});

test('diagnoseIntervention stops a harness rewrite when delivery is saturated and F4 dominates', () => {
  const ceilingMetrics = analyzeFailureComposition(generateFixtureTrajectories('ceilinged'));
  const diag = diagnoseIntervention(ceilingMetrics);

  assert.equal(diag.recommendation, 'CONTENT_CEILING');
  assert.equal(diag.primaryLever, 'STOP_HARNESS_REWRITE');
  assert.equal(diag.actions.join('\n').includes('export-dpo'), false);
});

test('diagnoseIntervention identifies HARNESS_EVOLUTION when loops/process failures dominate', () => {
  const processMetrics = analyzeFailureComposition(generateFixtureTrajectories('process_heavy'));
  const diag = diagnoseIntervention(processMetrics);

  assert.equal(diag.recommendation, 'HARNESS_EVOLUTION');
  assert.equal(diag.primaryLever, 'HARNESS_RUNTIME');
  assert.match(diag.reason, /Process failures dominate/);
  assert.ok(diag.actions.some((action) => action.includes('state ledger')));
});

test('diagnoseIntervention checks friction before a healthy majority', () => {
  const rows = [
    { score: 0.9, delivered: true },
    { score: 0.9, delivered: true },
    { score: 0.9, delivered: true },
    { score: 0.2, delivered: false, blockedToolCalls: 12 },
  ];
  const diag = diagnoseIntervention(analyzeFailureComposition(rows));
  assert.equal(diag.recommendation, 'HARNESS_FRICTION_CALIBRATION');
});

test('diagnoseIntervention does not prescribe from an empty total', () => {
  const diag = diagnoseIntervention({ total: 0, deliveryRate: 0, shares: {} });
  assert.equal(diag.recommendation, 'NONE');
  assert.equal(diag.primaryLever, 'NONE');
});

test('undelivered rows are not content failures', () => {
  const healthy = Array.from({ length: 60 }, () => ({ score: 0.9, delivered: true }));
  const content = Array.from({ length: 25 }, () => ({ score: 0.3, delivered: true }));
  const unknown = Array.from({ length: 15 }, () => ({ score: 0.9, output: 'plan' }));
  const analysis = analyzeFailureComposition([...healthy, ...content, ...unknown]);
  assert.equal(analysis.deliveryRate, 0.85);
  assert.equal(analysis.counts.HEALTHY, 60);
  assert.equal(analysis.counts.F4_CONTENT, 25);
  assert.equal(analysis.counts.UNDELIVERED, 15);
  assert.equal(analysis.shares.F4_CONTENT, 0.25);
  const diag = diagnoseIntervention(analysis);
  assert.notEqual(diag.recommendation, 'CONTENT_CEILING');
  assert.equal(diag.recommendation, 'HYBRID_TUNING');
});

test('diagnoseIntervention calibrates false positives and keeps the hard floor', () => {
  const frictionMetrics = analyzeFailureComposition(generateFixtureTrajectories('harness_friction'));
  const diag = diagnoseIntervention(frictionMetrics);
  const actions = diag.actions.join('\n');

  assert.equal(diag.recommendation, 'HARNESS_FRICTION_CALIBRATION');
  assert.equal(diag.primaryLever, 'CALIBRATE_FALSE_POSITIVES');
  assert.match(diag.reason, /Harness friction \(F2\)/);
  assert.match(actions, /secrets/);
  assert.match(actions, /outbound email/);
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

test('an unknown path and a both-matching path stay sees', () => {
  const unknown = classifyEditSurface(['src/utils/misc.js']);
  assert.deepEqual(unknown.writes, []);
  assert.deepEqual(unknown.sees, ['src/utils/misc.js']);

  const both = classifyEditSurface(['src/prompts/context-pack.txt']);
  assert.deepEqual(both.writes, []);
  assert.deepEqual(both.sees, ['src/prompts/context-pack.txt']);
});

test('CLI map-only is a rail map and a missing trace does not invent a sample', () => {
  const runMap = runScript(['--map-only']);
  assert.equal(runMap.status, 0);
  const mapObj = JSON.parse(runMap.stdout);
  assert.equal(mapObj.paper, 'arXiv:2610.11655');
  assert.match(mapObj.disclaimer, /Does not train weights/);
  assert.match(mapObj.noiseFloor.source, /DeepPlanning/);
  assert.equal(mapObj.noiseFloor.sigma, 0.023);
  assert.equal(mapObj.noiseFloor.resolvableDeltaThreshold, 0.035);
  assert.equal(mapObj.noiseFloor.capacityFloor, 0.18);
  assert.equal(JSON.stringify(mapObj).includes('WEIGHT_TRAINING'), false);

  const runJson = runScript(['--json', '--profile=ceilinged']);
  assert.notEqual(runJson.status, 0);
  const jsonObj = JSON.parse(runJson.stdout);
  assert.equal(jsonObj.status, 'no_trace');
  assert.equal(jsonObj.ok, false);
  assert.equal(jsonObj.recommendation, 'NONE');
  assert.match(jsonObj.disclaimer, /Does not train weights/);
  assert.equal(runJson.stdout.includes('LoRA'), false);
  assert.equal(runJson.stdout.includes('WEIGHT_TRAINING'), false);
});

test('a real trace reports the branch and does not inject paper noise', () => {
  const ceilinged = writeTrace(generateFixtureTrajectories('ceilinged'));
  const ceilingRun = runScript(['--json', `--trace=${ceilinged}`]);
  assert.equal(ceilingRun.status, 0);
  const ceilingObj = JSON.parse(ceilingRun.stdout);
  assert.equal(ceilingObj.status, 'traced');
  assert.equal(ceilingObj.ok, true);
  assert.equal(ceilingObj.diagnosis.recommendation, 'CONTENT_CEILING');
  assert.equal(ceilingObj.diagnosis.primaryLever, 'STOP_HARNESS_REWRITE');
  assert.equal(ceilingObj.optimismBound.noiseMeasured, false);
  assert.equal(ceilingObj.optimismBound.selectionOptimismBound, null);
  assert.match(ceilingObj.disclaimer, /Does not train weights/);

  const processHeavy = writeTrace(generateFixtureTrajectories('process_heavy'));
  const processRun = runScript(['--json', `--trace=${processHeavy}`]);
  assert.equal(processRun.status, 0);
  assert.equal(JSON.parse(processRun.stdout).diagnosis.recommendation, 'HARNESS_EVOLUTION');
});

test('a missing trace file and an empty trace fail closed', () => {
  const missing = runScript(['--json', '--trace=/tmp/does-not-exist-harness-ceiling.json']);
  assert.notEqual(missing.status, 0);
  const missingObj = JSON.parse(missing.stdout);
  assert.equal(missingObj.status, 'trace_unreadable');
  assert.equal(missingObj.ok, false);
  assert.equal(missingObj.recommendation, 'NONE');

  const empty = runScript(['--json', `--trace=${writeTrace([])}`]);
  assert.notEqual(empty.status, 0);
  const emptyObj = JSON.parse(empty.stdout);
  assert.equal(emptyObj.status, 'empty');
  assert.equal(emptyObj.recommendation, 'NONE');
});

test('harness ceiling surfaces do not recommend a training job', () => {
  const repo = path.join(__dirname, '..');
  const doctor = fs.readFileSync(SCRIPT, 'utf8');
  const runCliBody = doctor.slice(doctor.indexOf('function runCli'));
  assert.equal(runCliBody.includes('generateFixtureTrajectories'), false);
  assert.equal(doctor.includes('require.main === module'), false);

  const agents = fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
  const agentsSection = agents.slice(
    agents.indexOf('## Harness ceiling'),
    agents.indexOf('## Canonical Product Scope')
  );
  const gemini = fs.readFileSync(path.join(repo, 'GEMINI.md'), 'utf8');
  const geminiStart = gemini.indexOf('## Harness ceiling');
  const geminiRest = gemini.slice(geminiStart);
  const geminiNext = geminiRest.indexOf('\n## ', 1);
  const geminiSection = geminiNext === -1 ? geminiRest : geminiRest.slice(0, geminiNext);

  const surfaces = {
    doctor,
    agentsSection,
    geminiSection,
    skillAgents: fs.readFileSync(path.join(repo, '.agents/skills/harness-ceiling-diagnostics/SKILL.md'), 'utf8'),
    skillRoot: fs.readFileSync(path.join(repo, 'skills/harness-ceiling-diagnostics/SKILL.md'), 'utf8'),
    docs: fs.readFileSync(path.join(repo, 'docs/agents/harness-ceiling-weight-training.md'), 'utf8'),
    changeset: fs.readFileSync(path.join(repo, '.changeset/harness-ceiling-weight-training.md'), 'utf8'),
  };
  assert.equal(surfaces.skillAgents, surfaces.skillRoot);
  for (const [name, text] of Object.entries(surfaces)) {
    for (const token of REFUSED) {
      assert.equal(text.includes(token), false, `${name} contains ${token}`);
    }
  }
});
