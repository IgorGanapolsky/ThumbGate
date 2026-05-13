const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cosineSimilarity,
  evaluateReconstruction,
  buildNaturalLanguageActivationAudit,
} = require('../scripts/natural-language-activation-audit');

test('cosine similarity handles identical and orthogonal vectors', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test('reconstruction evaluator reports pass/fail by layer', () => {
  const pass = evaluateReconstruction({
    originalActivations: { layer12: [1, 2, 3] },
    reconstructedActivations: { layer12: [1, 2, 3.01] },
    threshold: 0.99,
  });
  assert.equal(pass.passed, true);
  const fail = evaluateReconstruction({
    originalActivations: { layer12: [1, 0] },
    reconstructedActivations: { layer12: [0, 1] },
    threshold: 0.5,
  });
  assert.equal(fail.passed, false);
});

test('activation-backed NLA audit keeps reconstruction metrics', () => {
  const report = buildNaturalLanguageActivationAudit([{
    sampleId: 'a',
    activationSource: 'hidden_state',
    decodedState: 'recognizes this as a safety evaluation',
    originalActivations: { layer1: [1, 0.5] },
    reconstructedActivations: { layer1: [1, 0.5] },
  }]);
  assert.equal(report.mode, 'activation_backed');
  assert.equal(report.reconstructionSummary.passed, 1);
  assert.equal(report.safetyFindings[0].flags[0], 'eval_awareness');
});

test('behavioral-only audit labels inference instead of claiming thoughts', () => {
  const report = buildNaturalLanguageActivationAudit([{
    sampleId: 'b',
    activationSource: 'behavioral_inference',
    inferredState: 'likely planning to decline a tedious task',
  }]);
  assert.equal(report.mode, 'behavioral_inference_only');
  assert.match(report.claimBoundary, /No proprietary model thoughts are claimed/);
  assert.equal(report.records[0].trustLevel, 'inferred_not_hidden_state');
});
