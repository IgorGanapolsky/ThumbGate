'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  findDecisiveStep,
  evaluatePatchMcq,
  estimatePatchAffinity,
  compareStepScoringMethods,
} = require('../scripts/decisive-step-evaluator');
const {
  auditDecisiveStep,
  PILLARS,
} = require('../scripts/decisive-step-doctor');

test('findDecisiveStep isolates first edit that flips tests from fail to pass', () => {
  const trajectory = [
    { stepNumber: 1, tool: 'bash', action: 'git status', patch: null, testsPassed: false },
    { stepNumber: 2, tool: 'edit', action: 'attempt 1', patch: 'return null;', testsPassed: false },
    { stepNumber: 3, tool: 'edit', action: 'decisive fix', patch: 'return a + b;', testsPassed: true },
    { stepNumber: 4, tool: 'edit', action: 'clean comment', patch: '// format', testsPassed: true },
  ];

  const result = findDecisiveStep(trajectory);
  assert.equal(result.hasDecisiveStep, true);
  assert.equal(result.decisiveStepIndex, 2);
  assert.equal(result.prefixSteps.length, 2);
  assert.equal(result.subsequentSteps.length, 1);
  assert.equal(result.rejectedSteps.length, 1);
  assert.equal(result.rejectedSteps[0].index, 1);
  assert.ok(result.decisiveStep.patch.includes('return a + b'));
});

test('findDecisiveStep rejects trajectories without a fail->pass flip', () => {
  // 1. All failing
  const allFailing = [
    { stepNumber: 1, tool: 'edit', patch: 'x = 1', testsPassed: false },
    { stepNumber: 2, tool: 'edit', patch: 'x = 2', testsPassed: false },
  ];
  const rFailing = findDecisiveStep(allFailing);
  assert.equal(rFailing.hasDecisiveStep, false);
  assert.equal(rFailing.decisiveStepIndex, -1);
  assert.ok(rFailing.reason.includes('never achieved passing tests'));

  // 2. Already passing from start
  const alreadyPassing = [
    { stepNumber: 1, tool: 'edit', patch: 'x = 1', testsPassed: true },
    { stepNumber: 2, tool: 'edit', patch: 'x = 2', testsPassed: true },
  ];
  const rPassing = findDecisiveStep(alreadyPassing, { initialTestStatus: 'pass' });
  assert.equal(rPassing.hasDecisiveStep, false);
  assert.ok(rPassing.reason.includes('already passing'));

  // 3. Empty trajectory
  const rEmpty = findDecisiveStep([]);
  assert.equal(rEmpty.hasDecisiveStep, false);
});

test('evaluatePatchMcq favors decisive passing patch over failing stubs', () => {
  const decisiveStep = {
    patch: 'export function processOrder(order) { if (!order.id) throw new Error(); return order.total * 1.1; }',
  };
  const rejectedSteps = [
    { index: 1, patch: 'export function processOrder(order) { return null; }' },
    { index: 2, patch: 'export function processOrder(order) { return undefined; }' },
    { index: 3, patch: 'export function processOrder(order) { // TODO: implement }' },
  ];
  const candidate = { name: 'codex-qwen', codingTierScore: 1.1 };

  const mcq = evaluatePatchMcq({ candidate, decisiveStep, rejectedSteps });
  assert.equal(mcq.valid, true);
  assert.equal(mcq.alternativesCount, 3);
  assert.equal(mcq.preferredDecisiveCount, 3);
  assert.equal(mcq.discriminationRate, 1.0);
  assert.equal(mcq.passedMcq, true);
});

test('compareStepScoringMethods demonstrates signal isolation over all-step noise', () => {
  const trajectory = [
    { stepNumber: 1, tool: 'bash', action: 'inspect files', patch: '', testsPassed: false },
    { stepNumber: 2, tool: 'edit', action: 'bad stub', patch: 'return null;', testsPassed: false },
    { stepNumber: 3, tool: 'edit', action: 'good logic', patch: 'return Math.max(0, val - min);', testsPassed: true },
  ];
  const candidate = { name: 'frontier-candidate', codingTierScore: 1.2 };

  const comp = compareStepScoringMethods(trajectory, candidate);
  assert.equal(comp.valid, true);
  assert.ok(comp.decisiveScore > comp.allStepAverage);
  assert.ok(comp.signalContrastRatio >= 1.0);
  assert.equal(comp.source.includes('arXiv:2610.10478'), true);
});

test('decisive-step-doctor audits all 4 pillars and returns PASS', () => {
  const audit = auditDecisiveStep();
  assert.equal(audit.status, 'PASS');
  assert.equal(audit.checks.length, 4);
  assert.ok(audit.checks.every((c) => c.ok));
  assert.equal(audit.pillars.length, 4);
});

test('CLI decisive-step supports --json and --map-only', () => {
  const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');

  // 1. --json
  const runJson = spawnSync(process.execPath, [cliPath, 'decisive-step', '--json'], { encoding: 'utf8' });
  assert.equal(runJson.status, 0);
  const outJson = JSON.parse(runJson.stdout);
  assert.equal(outJson.status, 'PASS');

  // 2. --map-only --json
  const runMap = spawnSync(process.execPath, [cliPath, 'decisive-step', '--map-only', '--json'], { encoding: 'utf8' });
  assert.equal(runMap.status, 0);
  const outMap = JSON.parse(runMap.stdout);
  assert.equal(outMap.mapOnly, true);
  assert.equal(outMap.pillars.length, 4);
});
