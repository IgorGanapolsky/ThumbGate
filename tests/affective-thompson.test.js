'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInitialModel, samplePosteriors } = require('../scripts/thompson-sampling');

test('samplePosteriors with affectiveMultiplier increases block probability', () => {
  const model = createInitialModel();
  // Neutral model reliability is 0.5 (alpha=1, beta=1)
  
  const normalSamples = [];
  const frustratedSamples = [];
  
  // Draw 100 samples for each
  for (let i = 0; i < 100; i++) {
    const normal = samplePosteriors(model, 1.0);
    const frustrated = samplePosteriors(model, 5.0); // 5x beta scaling for strong effect
    normalSamples.push(normal.testing);
    frustratedSamples.push(frustrated.testing);
  }
  
  const normalMean = normalSamples.reduce((a, b) => a + b, 0) / 100;
  const frustratedMean = frustratedSamples.reduce((a, b) => a + b, 0) / 100;
  
  console.log(`Normal mean: ${normalMean.toFixed(3)}, Frustrated mean: ${frustratedMean.toFixed(3)}`);
  
  assert.ok(frustratedMean < normalMean, 'Frustrated mean should be lower than normal mean');
  // 1 / (1 + 5) = 0.166
  assert.ok(frustratedMean < 0.3, 'Frustrated mean should be significantly lower than 0.5');
});

test('samplePosteriors handles edge cases for affectiveMultiplier', () => {
  const model = createInitialModel();
  const res = samplePosteriors(model, -1.0); // should fallback to 1.0
  assert.ok(res.testing >= 0 && res.testing <= 1.0);
  
  const res2 = samplePosteriors(model, 0); // should fallback to 1.0
  assert.ok(res2.testing >= 0 && res2.testing <= 1.0);
});
