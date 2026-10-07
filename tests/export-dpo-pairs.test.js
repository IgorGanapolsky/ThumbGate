'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  extractDomainKeys,
  domainOverlap,
  findDistractors,
  buildDpoPairs,
  buildRubricDelta,
  isEligiblePreference,
} = require('../scripts/export-dpo-pairs');

describe('findDistractors', () => {
  const errors = [
    { id: 1, title: 'MISTAKE: Skipped tests', content: 'No tests', category: 'error', tags: ['testing', 'verification'] },
    { id: 2, title: 'MISTAKE: Wrong deploy target', content: 'Deployed to prod', category: 'error', tags: ['deployment', 'verification'] },
    { id: 3, title: 'MISTAKE: Bad merge strategy', content: 'Force merged', category: 'error', tags: ['git', 'merge'] },
  ];
  const errorKeys = errors.map((e) => ({ memory: e, keys: extractDomainKeys(e) }));

  it('finds same-domain errors as distractors', () => {
    const learning = { id: 10, title: 'SUCCESS: Always verify', content: 'Run tests', category: 'learning', tags: ['testing', 'verification'] };
    const distractors = findDistractors(learning, errorKeys, 1, 2);
    assert.ok(distractors.length > 0, 'should find at least one distractor');
    assert.ok(distractors.every((d) => d.id !== 1), 'should exclude the paired error');
    assert.ok(distractors.every((d) => d.overlap > 0), 'all distractors should have domain overlap');
  });

  it('excludes the already-paired error', () => {
    const learning = { id: 10, title: 'SUCCESS: Test first', content: 'Test', category: 'learning', tags: ['testing'] };
    const distractors = findDistractors(learning, errorKeys, 1, 5);
    assert.ok(!distractors.some((d) => d.id === 1), 'should not include used error');
  });

  it('respects maxDistractors limit', () => {
    const learning = { id: 10, title: 'SUCCESS: Verify everything', content: 'All', category: 'learning', tags: ['testing', 'verification', 'deployment'] };
    const distractors = findDistractors(learning, errorKeys, 1, 1);
    assert.ok(distractors.length <= 1, 'should respect maxDistractors');
  });

  it('returns empty array when no overlap', () => {
    const learning = { id: 10, title: 'SUCCESS: Unique domain', content: 'Unique', category: 'learning', tags: ['quantum', 'physics'] };
    const distractors = findDistractors(learning, errorKeys, 99, 5);
    assert.equal(distractors.length, 0, 'no overlap means no distractors');
  });

  it('sorts distractors by overlap descending', () => {
    const learning = { id: 10, title: 'SUCCESS: Deploy with tests', content: 'Deploy', category: 'learning', tags: ['testing', 'verification', 'deployment'] };
    const distractors = findDistractors(learning, errorKeys, 99, 5);
    for (let i = 1; i < distractors.length; i++) {
      assert.ok(distractors[i - 1].overlap >= distractors[i].overlap, 'should sort by overlap desc');
    }
  });
});

describe('buildDpoPairs with distractors', () => {
  const errors = [
    { id: 1, title: 'MISTAKE: Skipped tests', content: 'No tests', category: 'error', tags: ['testing', 'verification'] },
    { id: 2, title: 'MISTAKE: Wrong deploy', content: 'Bad deploy', category: 'error', tags: ['testing', 'deployment'] },
    { id: 3, title: 'MISTAKE: Unrelated', content: 'Other', category: 'error', tags: ['unrelated-unique-tag'] },
  ];
  const learnings = [
    { id: 10, title: 'SUCCESS: Always test', content: 'Run tests', category: 'learning', tags: ['testing', 'verification'] },
  ];

  it('includes distractors in paired output', () => {
    const result = buildDpoPairs(errors, learnings);
    assert.ok(result.pairs.length >= 1, 'should produce pairs');
    const pair = result.pairs[0];
    assert.ok(Array.isArray(pair.distractors) || pair.distractors === undefined, 'distractors should be array or undefined');
    if (pair.distractors) {
      assert.ok(pair.distractors.length > 0, 'should have distractor entries');
      assert.ok(pair.distractors[0].id, 'distractor should have id');
      assert.ok(pair.distractors[0].content, 'distractor should have content');
      assert.ok(pair.distractors[0].overlap > 0, 'distractor should have overlap score');
    }
  });

  it('reports distractorCount in metadata', () => {
    const result = buildDpoPairs(errors, learnings);
    const pair = result.pairs[0];
    assert.ok(pair.metadata.distractorCount >= 0, 'metadata should include distractorCount');
  });

  it('maxDistractors option limits distractor count', () => {
    const result = buildDpoPairs(errors, learnings, { maxDistractors: 1 });
    const pair = result.pairs[0];
    if (pair.distractors) {
      assert.ok(pair.distractors.length <= 1, 'should respect maxDistractors');
    }
  });

  it('distractor is not the same as the rejected error', () => {
    const result = buildDpoPairs(errors, learnings);
    const pair = result.pairs[0];
    if (pair.distractors) {
      const rejectedId = pair.metadata.errorId;
      assert.ok(!pair.distractors.some((d) => d.id === rejectedId), 'distractor should differ from rejected');
    }
  });

  it('pairs still work correctly without distractors available', () => {
    const singleError = [{ id: 1, title: 'MISTAKE: Skipped tests', content: 'No tests', category: 'error', tags: ['testing'] }];
    const result = buildDpoPairs(singleError, learnings);
    assert.ok(result.pairs.length >= 1, 'should still produce pairs');
    // With only one error, no distractors possible (it's the paired one)
  });
});


describe('DPO preference eligibility', () => {
  const error = { id: 'E', content: 'Skip tests', tags: ['testing'], rubricSummary: { weightedScore: 0.7 } };
  const learning = { id: 'L', content: 'Run tests', tags: ['testing'], rubricSummary: { weightedScore: 0.8 } };

  it('preserves valid legacy category pairs without rubric scores', () => {
    const legacyError = { ...error, rubricSummary: undefined };
    const legacyLearning = { ...learning, rubricSummary: undefined };
    const result = buildDpoPairs([legacyError], [legacyLearning]);
    assert.equal(result.pairs.length, 1);
    assert.equal(result.pairs[0].chosen, learning.content);
    assert.equal(result.pairs[0].rejected, error.content);
    assert.equal(result.pairs[0].metadata.rubric, null);
  });

  it('leaves blank and nonstring candidates unpaired', () => {
    for (const content of [undefined, null, '', '  \r\n ', 1, false, [], {}]) {
      for (const [errors, learnings] of [
        [[{ ...error, content }], [learning]],
        [[error], [{ ...learning, content }]],
      ]) {
        const result = buildDpoPairs(errors, learnings);
        assert.deepEqual(result.pairs, []);
        assert.deepEqual(result.unpairedErrors, errors);
        assert.deepEqual(result.unpairedLearnings, learnings);
      }
    }
  });

  it('rejects identical and line-ending-equivalent text', () => {
    for (const content of ['Run tests\nDeploy', '  Run tests\r\nDeploy  ']) {
      const result = buildDpoPairs(
        [{ ...error, content }],
        [{ ...learning, content: 'Run tests\nDeploy' }],
      );
      assert.deepEqual(result.pairs, []);
    }
  });

  it('preserves case and internal whitespace distinctions', () => {
    for (const content of ['run tests', 'Run  tests']) {
      assert.equal(isEligiblePreference({ ...error, content }, learning), true);
    }
  });

  it('rejects preferences that collapse after redaction', () => {
    const result = buildDpoPairs(
      [{ ...error, content: 'Use sk_test_aaaaaaaaaaaaaaaa' }],
      [{ ...learning, content: 'Use sk_test_bbbbbbbbbbbbbbbb' }],
    );
    assert.deepEqual(result.pairs, []);
    assert.equal(result.unpairedErrors.length, 1);
    assert.equal(result.unpairedLearnings.length, 1);
  });

  it('abstains on equal or inverted scores without rounding away small differences', () => {
    for (const score of [0.7, 0.6999, 0.5]) {
      assert.equal(buildDpoPairs([error], [{ ...learning, rubricSummary: { weightedScore: score } }]).pairs.length, 0);
    }
    const result = buildDpoPairs([error], [{ ...learning, rubricSummary: { weightedScore: 0.7001 } }]);
    assert.equal(result.pairs.length, 1);
    assert.ok(result.pairs[0].metadata.matchScore > 1);
  });

  it('treats malformed rubric values as unknown rather than zero', () => {
    for (const weightedScore of [undefined, null, '', ' ', '0.9', false, true, [], {}, NaN, Infinity, -Infinity]) {
      const malformedError = { ...error, rubricSummary: { weightedScore } };
      const malformedLearning = { ...learning, rubricSummary: { weightedScore } };
      const zeroError = { ...error, rubricSummary: { weightedScore: 0 } };
      const zeroLearning = { ...learning, rubricSummary: { weightedScore: 0 } };
      assert.equal(isEligiblePreference(malformedError, zeroLearning), true);
      assert.equal(isEligiblePreference(zeroError, malformedLearning), true);
      assert.equal(buildRubricDelta(malformedError, zeroLearning).errorWeightedScore, null);
      assert.equal(buildRubricDelta(zeroError, malformedLearning).learningWeightedScore, null);
    }
  });

  it('falls back from an invalid highest-overlap learning before ranking', () => {
    const invalid = { ...learning, id: 'invalid', content: error.content, tags: ['testing', 'deployment'] };
    const result = buildDpoPairs([{ ...error, tags: invalid.tags }], [invalid, learning]);
    assert.equal(result.pairs[0].metadata.learningId, learning.id);
    assert.deepEqual(result.unpairedLearnings, [invalid]);
  });

  it('does not let a rubric-only candidate hide a domain match', () => {
    const highScore = { ...learning, id: 'unrelated', tags: ['other'], rubricSummary: { weightedScore: 10 } };
    const result = buildDpoPairs([error], [highScore, learning]);
    assert.equal(result.pairs[0].metadata.learningId, learning.id);
  });

  it('ranks eligible learnings using raw rubric differences', () => {
    const better = { ...learning, id: 'better', rubricSummary: { weightedScore: 0.8001 } };
    const result = buildDpoPairs([error], [learning, better]);
    assert.equal(result.pairs[0].metadata.learningId, 'better');
  });

  it('fills the distractor budget after validity and redacted-text deduplication', () => {
    const errors = [
      error,
      { ...error, id: 'same-paired-text' },
      { ...error, id: 'blank', content: '  ' },
      { ...error, id: 'same-chosen', content: learning.content },
      { ...error, id: 'equal-score', content: 'Wait', rubricSummary: { weightedScore: 0.8 } },
      { ...error, id: 'higher-score', content: 'Check later', rubricSummary: { weightedScore: 0.9 } },
      { ...error, id: 'first', content: 'Use sk_test_aaaaaaaaaaaaaaaa', tags: ['testing', 'verification'] },
      { ...error, id: 'duplicate', content: '  Use sk_test_bbbbbbbbbbbbbbbb  ' },
      { ...error, id: 'second', content: 'Ignore failures' },
    ];
    const result = buildDpoPairs(errors, [{ ...learning, tags: ['testing', 'verification'] }], { maxDistractors: 2 });
    assert.deepEqual(result.pairs[0].distractors.map((d) => d.id), ['first', 'second']);
    assert.equal(result.pairs[0].metadata.distractorCount, 2);
  });
});
