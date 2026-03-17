const fs = require('fs');
const path = require('path');
const { captureFeedback, getFeedbackPaths, readJSONL } = require('../scripts/feedback-loop');
const assert = require('assert');

const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rlhf-bayes-test-'));
process.env.RLHF_FEEDBACK_DIR = tmpDir;

console.log('Testing Project Bayes (Bayesian Memory)...');

// 1. Initial Success
console.log('  Capturing first success...');
captureFeedback({
  signal: 'up',
  context: 'User prefers tabs',
  whatWorked: 'Switched to tabs',
  tags: ['style', 'formatting']
});

let memories = readJSONL(path.join(tmpDir, 'memory-log.jsonl'));
assert.strictEqual(memories.length, 1);
assert.strictEqual(memories[0].bayesian.priorProbability, 0.7);
assert.strictEqual(memories[0].bayesian.observations, 1);

// 2. Second Success (Strengthening the belief)
console.log('  Capturing second success...');
captureFeedback({
  signal: 'up',
  context: 'Tabs are great',
  whatWorked: 'Used tabs again',
  tags: ['style']
});

memories = readJSONL(path.join(tmpDir, 'memory-log.jsonl'));
assert.strictEqual(memories.length, 2);
assert.strictEqual(memories[1].revisedFromId, memories[0].id);
// (0.7 * 1 + 0.9) / 2 = 0.8
assert.strictEqual(memories[1].bayesian.priorProbability, 0.8);
assert.strictEqual(memories[1].bayesian.observations, 2);

// 3. Contradiction (User changes mind)
console.log('  Capturing contradiction (down signal)...');
captureFeedback({
  signal: 'down',
  context: 'Actually I hate tabs now',
  whatWentWrong: 'User asked for spaces',
  tags: ['style']
});

memories = readJSONL(path.join(tmpDir, 'memory-log.jsonl'));
assert.strictEqual(memories.length, 3);
assert.strictEqual(memories[2].revisedFromId, memories[1].id);
// (0.8 * 2 + 0.1) / 3 = 1.7 / 3 = 0.567
assert.strictEqual(memories[2].bayesian.priorProbability, 0.567);
assert.strictEqual(memories[2].bayesian.observations, 3);
// Contradiction increases uncertainty
assert.ok(memories[2].bayesian.uncertainty > memories[1].bayesian.uncertainty);

console.log('PASS: Project Bayes');

fs.rmSync(tmpDir, { recursive: true, force: true });
delete process.env.RLHF_FEEDBACK_DIR;
