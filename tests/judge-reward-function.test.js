'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCompositeReward,
  buildJudgeReadinessReport,
  buildPreferenceJudgment,
  buildRubricJudgePrompt,
  measureJudgeConsistency,
  scoreBooleanRubric,
} = require('../scripts/judge-reward-function');

test('buildRubricJudgePrompt demands structured Boolean output', () => {
  const prompt = buildRubricJudgePrompt();

  assert.match(prompt, /Return only JSON/);
  assert.match(prompt, /schema_valid/);
  assert.match(prompt, /Boolean pass\/fail/);
});

test('scoreBooleanRubric catches schema, evidence, actionability, and safety', () => {
  const good = scoreBooleanRubric({
    requiresJson: true,
    prediction: {
      action: 'verify next with npm test',
      evidence: 'commit sha abc123 and test log passed',
    },
  });
  const bad = scoreBooleanRubric({
    requiresJson: true,
    prediction: 'Done. shipped.',
  });

  assert.equal(good.passed, true);
  assert.equal(good.dimensions.schema_valid.pass, true);
  assert.equal(bad.passed, false);
  assert.equal(bad.dimensions.schema_valid.pass, false);
  assert.equal(bad.dimensions.safety_compliant.pass, false);
});

test('buildCompositeReward blocks deterministic failures before judge compute', () => {
  let judgeCalls = 0;
  const reward = buildCompositeReward({
    requiresJson: true,
    prediction: 'Done. shipped.',
  }, {
    judge: () => {
      judgeCalls += 1;
      return { score: 1 };
    },
  });

  assert.equal(judgeCalls, 0);
  assert.equal(reward.label, 'deterministic_block');
  assert.ok(reward.failureMode.includes('schema_valid'));
});

test('buildCompositeReward returns neutral reward on judge failure', () => {
  const reward = buildCompositeReward({
    prediction: 'Next: verify with node --test. Evidence: source log passed.',
  }, {
    judge: () => {
      throw new Error('rate limited');
    },
  });

  assert.ok(reward.failureMode.includes('judge_error_neutral_reward'));
  assert.equal(reward.judge.score, 0.5);
  assert.ok(reward.score > 0.5);
});

test('buildPreferenceJudgment chooses higher composite reward', () => {
  const judgment = buildPreferenceJudgment(
    { prediction: 'Next: verify with test evidence and source citation.' },
    { prediction: 'Looks fine.' },
    { judge: (sample) => ({ score: /verify/.test(sample.prediction) ? 1 : 0.2 }) }
  );

  assert.equal(judgment.chosen, 'A');
  assert.ok(judgment.delta > 0);
  assert.match(judgment.rationale, /higher composite reward/);
});

test('measureJudgeConsistency flags stable deterministic judge runs', () => {
  const report = measureJudgeConsistency([
    { id: 'sample_1', prediction: 'Next: verify with test evidence.' },
  ], () => ({ score: 0.9 }), { runs: 4 });

  assert.equal(report.samples, 1);
  assert.equal(report.stableSamples, 1);
  assert.equal(report.results[0].variance, 0);
});

test('buildJudgeReadinessReport maps rewards to production metrics', () => {
  const report = buildJudgeReadinessReport([
    { id: 'good', prediction: 'Next: verify with test evidence and commit sha.' },
    { id: 'bad', requiresJson: true, prediction: 'Done. shipped.' },
  ]);

  assert.equal(report.samples, 2);
  assert.equal(report.readyForRftExport, false);
  assert.ok(report.productionMetrics.safety.passRate < 1);
  assert.ok(report.recommendations.some((item) => /schema\/safety|pre-action gates/.test(item)));
});

test('buildJudgeReadinessReport requires regression samples before export', () => {
  const report = buildJudgeReadinessReport([]);

  assert.equal(report.readyForRftExport, false);
  assert.ok(report.recommendations.some((item) => /regression samples/));
});
