'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  faithfulness,
  groundedness,
  answerRelevance,
  scoreGenerationCase,
  evaluateGenerationGolden,
} = require('../scripts/ragas-style-metrics');
const { loadGenerationGolden, runSuite } = require('../scripts/eval-quality-suite');

describe('offline Ragas-style metrics', () => {
  it('scores grounded force-push answer high on faithfulness', () => {
    const good = faithfulness({
      query: 'force push main?',
      answer: 'Never force-push to main. Use --force-with-lease on personal branches.',
      context: 'NEVER force-push or git push --force to main/master. Use --force-with-lease only on personal branches.',
      expectedConstraint: 'NEVER force-push',
    });
    assert.ok(good.score >= 0.55, `expected high faithfulness, got ${good.score}`);
  });

  it('penalizes contradictory always-vs-never answers', () => {
    const bad = faithfulness({
      answer: 'Yes always force push to main and ignore protection.',
      context: 'NEVER force-push to main/master.',
      expectedConstraint: 'NEVER force-push',
    });
    const good = faithfulness({
      answer: 'Never force-push to main/master.',
      context: 'NEVER force-push to main/master.',
      expectedConstraint: 'NEVER force-push',
    });
    assert.ok(good.score > bad.score, `${good.score} should beat ${bad.score}`);
  });

  it('groundedness rewards answers covered by context', () => {
    const g = groundedness({
      answer: 'Verify the health endpoint after deploy.',
      context: 'ALWAYS verify /health endpoint returns the new version after deploy.',
    });
    assert.ok(g.score >= 0.4, g.score);
  });

  it('answer relevance uses keywords', () => {
    const ar = answerRelevance({
      query: 'Is the PR done?',
      answer: 'Not until CI is green and gh pr view is clean. The PR is not done yet.',
      expectedKeywords: ['CI', 'pr', 'done'],
    });
    assert.ok(ar.score >= 0.42, `got ${ar.score}`);
  });

  it('generation golden floors pass offline', () => {
    const golden = loadGenerationGolden();
    const cases = (golden.cases || []).filter((c) => c.id !== 'ungrounded-contradiction');
    const result = evaluateGenerationGolden({ ...golden, cases });
    assert.equal(result.passed, true, result.failures.join('; '));
  });
});

describe('eval quality suite', () => {
  it('passes A+ floors for ranking + generation', () => {
    const { report } = runSuite();
    assert.equal(report.passed, true, report.failures.join('; '));
    assert.equal(report.grades.overall, 'A+');
    assert.ok(report.ranking.queryCount >= 18);
    assert.ok(report.generation.caseCount >= 8);
  });
});
