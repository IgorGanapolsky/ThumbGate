'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { calculateRetrievalEntropy } = require('../scripts/lesson-retrieval');

test('calculateRetrievalEntropy - zero for empty lessons', () => {
  assert.equal(calculateRetrievalEntropy([]), 0);
});

test('calculateRetrievalEntropy - zero for unanimous consensus', () => {
  const lessons = [
    { signal: 'positive', relevanceScore: 0.9 },
    { signal: 'positive', relevanceScore: 0.8 },
  ];
  assert.equal(calculateRetrievalEntropy(lessons), 0);
});

test('calculateRetrievalEntropy - high for perfectly conflicting signals', () => {
  const lessons = [
    { signal: 'positive', relevanceScore: 0.5 },
    { signal: 'negative', relevanceScore: 0.5 },
  ];
  // Shannon Entropy for p=0.5 is 1.0
  assert.equal(calculateRetrievalEntropy(lessons), 1.0);
});

test('calculateRetrievalEntropy - weighted entropy for unequal relevance', () => {
  const lessons = [
    { signal: 'positive', relevanceScore: 0.8 },
    { signal: 'negative', relevanceScore: 0.2 },
  ];
  // pPos = 0.8, pNeg = 0.2
  // E = -(0.8 * log2(0.8) + 0.2 * log2(0.2))
  // E = -(0.8 * -0.3219 + 0.2 * -2.3219)
  // E = -(-0.2575 - 0.4644) = 0.7219
  const entropy = calculateRetrievalEntropy(lessons);
  assert.ok(Math.abs(entropy - 0.7219) < 0.001);
});
