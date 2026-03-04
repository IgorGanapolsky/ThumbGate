const test = require('node:test');
const assert = require('node:assert/strict');
const {
  loadRubricConfig,
  normalizeRubricScores,
  buildRubricEvaluation,
} = require('../scripts/rubric-engine');

test('loads rubric config with expected criteria', () => {
  const rubric = loadRubricConfig();
  assert.equal(rubric.rubricId, 'default-v1');
  assert.ok(Array.isArray(rubric.criteria));
  assert.ok(rubric.criteria.length >= 4);
});

test('normalizes rubric scores and validates criterion names', () => {
  const normalized = normalizeRubricScores([
    { criterion: 'correctness', score: 4, judge: 'judge-a' },
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].criterion, 'correctness');

  assert.throws(() => normalizeRubricScores([{ criterion: 'unknown', score: 5 }]), /unknown criterion/);
});

test('buildRubricEvaluation flags disagreement and failed guardrails', () => {
  const evaluation = buildRubricEvaluation({
    rubricScores: [
      { criterion: 'verification_evidence', score: 5, judge: 'judge-a' },
      { criterion: 'verification_evidence', score: 2, judge: 'judge-b', evidence: 'missing logs' },
      { criterion: 'correctness', score: 4, judge: 'judge-a', evidence: 'tests pass' },
    ],
    guardrails: {
      testsPassed: false,
      pathSafety: true,
      budgetCompliant: true,
    },
  });

  assert.equal(evaluation.promotionEligible, false);
  assert.ok(evaluation.failingGuardrails.includes('testsPassed'));
  assert.ok(evaluation.judgeDisagreements.length >= 1);
});
