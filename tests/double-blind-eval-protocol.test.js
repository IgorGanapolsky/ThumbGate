'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sealAsset,
  createEnclave,
  runEvaluation,
  leakageGuard,
  attest,
  verifyAttestation,
} = require('../scripts/double-blind-eval-protocol');

const QUESTIONS = ['Value MSFT', 'What is my risk exposure?'];

function standardPair() {
  const modelSeal = sealAsset('model', 'agent-config-v3 with valuation skill', 'provider');
  const benchmarkSeal = sealAsset('benchmark', JSON.stringify(QUESTIONS), 'mlcommons');
  return { modelSeal, benchmarkSeal };
}

test('seal commits to a sha256 digest and issues an access token', () => {
  const s = sealAsset('model', 'weights-bytes', 'provider');
  assert.equal(s.sha256.length, 64);
  assert.equal(s.sealId.startsWith('seal_'), true);
  assert.equal(s.accessToken.length, 32);
});

test('seal refuses unknown kinds and empty content', () => {
  assert.throws(() => sealAsset('weights', 'x', 'p'));
  assert.throws(() => sealAsset('model', '', 'p'));
});

test('enclave requires one model seal and one benchmark seal', () => {
  const { modelSeal, benchmarkSeal } = standardPair();
  assert.throws(() => createEnclave(benchmarkSeal, benchmarkSeal));
  assert.throws(() => createEnclave(modelSeal, modelSeal));
  const e = createEnclave(modelSeal, benchmarkSeal);
  assert.equal(e.modeled, true);
  assert.equal(e.modelSeal.sha256, modelSeal.sha256);
  assert.equal(e.benchmarkSeal.sha256, benchmarkSeal.sha256);
});

test('only scores leave the enclave — questions and content withheld', () => {
  const { modelSeal, benchmarkSeal } = standardPair();
  const enclave = createEnclave(modelSeal, benchmarkSeal);
  const result = runEvaluation(enclave, modelSeal, benchmarkSeal, ({ questions }) =>
    questions.map((q) => ({ question: q, score: 1 })),
  );
  assert.equal(result.released, 'scores-only');
  assert.equal(result.scores.length, QUESTIONS.length);
  const serialized = JSON.stringify(result);
  for (const q of QUESTIONS) {
    assert.ok(!serialized.includes(q), `question "${q}" must not leave the enclave`);
  }
  assert.ok(!serialized.includes('valuation skill'), 'model content must not leave the enclave');
});

test('leakage guard catches question text in any output', () => {
  const { benchmarkSeal } = standardPair();
  const leaky = `sure! the answer to ${QUESTIONS[0]} is 42`;
  assert.deepEqual(leakageGuard(leaky, benchmarkSeal), { clean: false, leakedQuestionIndex: 0 });
  assert.equal(leakageGuard('scores: [1, 0.5]', benchmarkSeal).clean, true);
});

test('attestation receipt binds both seal hashes to the scores', () => {
  const { modelSeal, benchmarkSeal } = standardPair();
  const enclave = createEnclave(modelSeal, benchmarkSeal);
  const result = runEvaluation(enclave, modelSeal, benchmarkSeal, ({ questions }) =>
    questions.map((q, i) => ({ question: q, score: i === 0 ? 1 : 0.5 })),
  );
  const receipt = attest(enclave, result);
  assert.equal(receipt.modelSealSha, modelSeal.sha256);
  assert.equal(receipt.benchmarkSealSha, benchmarkSeal.sha256);
  assert.equal(receipt.scoreCount, 2);
});

test('verification passes on honest receipts, fails on tampered scores', () => {
  const { modelSeal, benchmarkSeal } = standardPair();
  const enclave = createEnclave(modelSeal, benchmarkSeal);
  const result = runEvaluation(enclave, modelSeal, benchmarkSeal, ({ questions }) =>
    questions.map((q) => ({ question: q, score: 1 })),
  );
  const receipt = attest(enclave, result);
  const ok = verifyAttestation(receipt, modelSeal, benchmarkSeal, result.scores);
  assert.equal(ok.valid, true);
  const tampered = result.scores.map((s) => ({ ...s, score: 0 })); // score inflation attempt
  const bad = verifyAttestation(receipt, modelSeal, benchmarkSeal, tampered);
  assert.equal(bad.valid, false);
  assert.deepEqual(bad.sealIntegrity, { model: true, benchmark: true });
});

test('verification detects a swapped benchmark (seal integrity)', () => {
  const { modelSeal, benchmarkSeal } = standardPair();
  const enclave = createEnclave(modelSeal, benchmarkSeal);
  const result = runEvaluation(enclave, modelSeal, benchmarkSeal, ({ questions }) =>
    questions.map((q) => ({ question: q, score: 1 })),
  );
  const receipt = attest(enclave, result);
  const swapped = sealAsset('benchmark', JSON.stringify(['easier question']), 'mlcommons');
  const bad = verifyAttestation(receipt, modelSeal, swapped, result.scores);
  assert.equal(bad.valid, false);
  assert.equal(bad.sealIntegrity.benchmark, false);
});
