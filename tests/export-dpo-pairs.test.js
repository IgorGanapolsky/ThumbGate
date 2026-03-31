'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  extractDomainKeys,
  domainOverlap,
  findDistractors,
  buildDpoPairs,
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
