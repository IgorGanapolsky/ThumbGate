const test = require('node:test');
const assert = require('node:assert');
const { TinkerAlignmentEngine } = require('../scripts/tinker-model-alignment.js');

test('TinkerAlignmentEngine formats lessons and simulates batch submission', async () => {
  const engine = new TinkerAlignmentEngine();
  const pairs = await engine.formatLessonsForTraining();
  assert.ok(Array.isArray(pairs));
  const res = await engine.submitTrainingBatch(pairs.slice(0, 5));
  assert.strictEqual(res.status, 'SUCCESS');
  assert.ok(res.jobId);
});
