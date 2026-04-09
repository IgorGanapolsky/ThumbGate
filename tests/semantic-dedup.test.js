'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  bigrams,
  jaccardSimilarity,
  normalizeContext,
  clusterFeedback,
  deduplicateFeedback,
} = require('../scripts/semantic-dedup');

describe('semantic-dedup', () => {
  describe('bigrams', () => {
    it('extracts character bigrams from text', () => {
      const result = bigrams('abc');
      assert.ok(result.has('ab'));
      assert.ok(result.has('bc'));
      assert.strictEqual(result.size, 2);
    });

    it('normalizes before extracting', () => {
      const result = bigrams('A-B!C');
      // 'a b c' → 'a ', ' b', 'b ', ' c'
      assert.ok(result.size > 0);
    });

    it('returns empty set for empty input', () => {
      assert.strictEqual(bigrams('').size, 0);
      assert.strictEqual(bigrams(null).size, 0);
    });
  });

  describe('jaccardSimilarity', () => {
    it('returns 1 for identical sets', () => {
      const a = new Set(['ab', 'bc']);
      assert.strictEqual(jaccardSimilarity(a, a), 1);
    });

    it('returns 0 for disjoint sets', () => {
      const a = new Set(['ab', 'bc']);
      const b = new Set(['xy', 'yz']);
      assert.strictEqual(jaccardSimilarity(a, b), 0);
    });

    it('returns correct value for partial overlap', () => {
      const a = new Set(['ab', 'bc', 'cd']);
      const b = new Set(['ab', 'bc', 'de']);
      // intersection=2, union=4
      assert.strictEqual(jaccardSimilarity(a, b), 0.5);
    });

    it('handles empty sets', () => {
      assert.strictEqual(jaccardSimilarity(new Set(), new Set()), 1);
      assert.strictEqual(jaccardSimilarity(new Set(['a']), new Set()), 0);
    });
  });

  describe('normalizeContext', () => {
    it('strips user paths', () => {
      assert.ok(!normalizeContext('/Users/igor/code/app').includes('/Users/igor'));
    });

    it('strips line numbers', () => {
      assert.ok(!normalizeContext('file.js:42').includes(':42'));
    });

    it('strips timestamps', () => {
      assert.ok(!normalizeContext('2026-04-09T12:00:00.000Z').includes('2026'));
    });

    it('strips hex hashes', () => {
      assert.ok(!normalizeContext('commit abc123def456').includes('abc123def456'));
    });
  });

  describe('clusterFeedback', () => {
    it('clusters near-duplicate entries', () => {
      const entries = [
        { context: 'force push to main branch destroyed work', tags: ['git'] },
        { context: 'force push to main branch destroyed changes', tags: ['trust'] },
        { context: 'completely unrelated feedback about testing', tags: ['test'] },
      ];

      const clusters = clusterFeedback(entries, { threshold: 0.4 });
      // First two should cluster together, third separate
      assert.strictEqual(clusters.length, 2);

      const bigCluster = clusters.find((c) => c.count === 2);
      assert.ok(bigCluster, 'Should have a cluster of size 2');
      assert.ok(bigCluster.mergedTags.includes('git'));
      assert.ok(bigCluster.mergedTags.includes('trust'));
    });

    it('returns empty array for empty input', () => {
      assert.deepStrictEqual(clusterFeedback([]), []);
      assert.deepStrictEqual(clusterFeedback(null), []);
    });

    it('keeps distinct entries as separate clusters', () => {
      const entries = [
        { context: 'alpha beta gamma delta', tags: [] },
        { context: 'one two three four five', tags: [] },
      ];
      const clusters = clusterFeedback(entries, { threshold: 0.8 });
      assert.strictEqual(clusters.length, 2);
    });

    it('picks longest context as representative', () => {
      const entries = [
        { context: 'short error', tags: [] },
        { context: 'a much longer and more detailed error description for the same issue', tags: [] },
      ];
      const clusters = clusterFeedback(entries, { threshold: 0.01 }); // very low threshold to force cluster
      assert.strictEqual(clusters.length, 1);
      assert.ok(clusters[0].representative.context.includes('much longer'));
    });
  });

  describe('deduplicateFeedback', () => {
    it('returns entries with _clusterCount', () => {
      const entries = [
        { context: 'push force to main again', tags: ['git'] },
        { context: 'push force to main once more', tags: ['trust'] },
        { context: 'test failure in auth module', tags: ['test'] },
      ];

      const deduped = deduplicateFeedback(entries, { threshold: 0.4 });
      assert.ok(deduped.length <= entries.length);
      assert.ok(deduped.every((e) => typeof e._clusterCount === 'number'));

      const clustered = deduped.find((e) => e._clusterCount > 1);
      if (clustered) {
        assert.ok(clustered._mergedTags.length >= 1);
      }
    });
  });
});
