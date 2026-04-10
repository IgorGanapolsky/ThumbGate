'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  categorizeDoc,
  scoreBundle,
  scoreRetrievalQuality,
  compactContext,
  CATEGORY_RULES,
} = require('../scripts/context-engine');

describe('context-engine', () => {
  it('categorizeDoc classifies testing-related files', () => {
    assert.strictEqual(categorizeDoc('TESTING_GUIDELINES.md'), 'testing');
    assert.strictEqual(categorizeDoc('TEST_COVERAGE.md'), 'testing');
  });

  it('categorizeDoc classifies CI/CD files', () => {
    assert.strictEqual(categorizeDoc('CI_FIXES.md'), 'ci-cd');
    assert.strictEqual(categorizeDoc('BUILD_PIPELINE.md'), 'ci-cd');
  });

  it('categorizeDoc returns general for unknown patterns', () => {
    assert.strictEqual(categorizeDoc('RANDOM_NOTES.md'), 'general');
  });

  it('scoreBundle returns positive score for matching tokens', () => {
    const bundle = { keywords: ['testing', 'jest', 'coverage'], docs: [{}] };
    const score = scoreBundle(['testing', 'coverage'], bundle);
    assert.ok(score > 0);
  });

  it('scoreBundle returns 0 when no tokens match', () => {
    const bundle = { keywords: ['testing', 'jest'], docs: [{}] };
    assert.strictEqual(scoreBundle(['unrelated'], bundle), 0);
  });

  it('scoreRetrievalQuality computes precision, recall, and F1', () => {
    const result = scoreRetrievalQuality(
      'test query',
      ['TESTING_GUIDELINES.md', 'CI_FIXES.md'],
      ['testing', 'security'],
      '/dev/null'
    );
    assert.ok(result.precision >= 0 && result.precision <= 1);
    assert.ok(result.recall >= 0 && result.recall <= 1);
    assert.ok(result.f1 >= 0 && result.f1 <= 1);
  });

  it('compactContext preserves anchors and reduces entry count', () => {
    const entries = [];
    for (let i = 0; i < 50; i++) {
      entries.push({ id: `e${i}`, signal: 'down', context: `context ${i}`, whatWentWrong: `error ${i}` });
    }
    const anchors = [{ id: 'e0' }];
    const result = compactContext(entries, anchors, { windowSize: 10 });
    assert.ok(result.entries.length <= 50);
    assert.ok(result.entries.some(e => e.id === 'e0'), 'Anchor should be preserved');
    assert.strictEqual(result.stage, 5);
  });

  it('compactContext applies Stage 6 token budget when totalMaxChars triggers trimming', () => {
    const entries = [
      { id: 'e0', signal: 'down', context: 'ctx', whatWentWrong: 'error zero' },
      { id: 'e1', signal: 'down', context: 'ctx', whatWentWrong: 'error one' },
      { id: 'e2', signal: 'down', context: 'ctx', whatWentWrong: 'error two' },
    ];
    // Budget tight enough to fit only the most recent entry (~72 chars each)
    const result = compactContext(entries, [], { totalMaxChars: 80 });
    assert.strictEqual(result.stage, 6);
    assert.ok(result.entries.length < entries.length, 'Some entries should be dropped by budget');
    assert.ok(result.entries.map(e => e.id).includes('e2'), 'Most recent entry should be preserved');
  });

  it('compactContext Stage 6 is skipped when all entries fit within totalMaxChars', () => {
    const entries = [
      { id: 'e0', signal: 'down', context: 'x', whatWentWrong: 'err' },
    ];
    const result = compactContext(entries, [], { totalMaxChars: 999999 });
    assert.strictEqual(result.stage, 5);
    assert.strictEqual(result.entries.length, 1);
  });
});
