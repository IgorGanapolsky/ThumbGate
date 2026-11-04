'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const {
  BYTE_TRAINING_CROSSOVER_BYTES,
  detectCloneAttempt,
  evaluateByteCrossoverThreshold,
  projectUnitVector,
  computeCosineSimilarity,
  computeBoundaryProbability,
  scanOuterByteStream,
  routeCosineBoundaries,
  emaSmoothChunks,
  straightThroughEstimatorStep,
  computeAuxiliaryRatioLoss,
  buildTwoStageHierarchy,
  shuntAgentStreamDynamic,
  runDoctor,
} = require('../scripts/hnet-dynamic-chunking-honesty');

test('1. U-Net Hybrid Outer Byte Scanner strips zero-width & IFS splinters and catches adversarial commands in O(n)', () => {
  const obfuscated = 'c\u200Bat${IFS}/e\\tc/pa\'\'sswd && r\\m${IFS}-rf /';
  const result = scanOuterByteStream(obfuscated);

  assert.equal(result.normalizedText, 'cat /etc/passwd && rm -rf /');
  assert.equal(result.strippedZeroWidthCount, 1);
  assert.ok(result.strippedEscapeSplinters >= 4);
  assert.equal(result.adversarialDetected, true);
  assert.ok(result.matchedAdversarialIds.includes('etc_passwd_shadow'));
  assert.ok(result.matchedAdversarialIds.includes('rm_rf_root'));
  assert.equal(result.rollingState.length, 16);
});

test('2. Unsupervised Cosine Routing computes P_t = 0.5 * (1 - CosineSimilarity(q_t, k_{t-1})) and cuts at P_t > 0.5', () => {
  const qSame = projectUnitVector('Compiling module alpha.js', 'query');
  const kSame = projectUnitVector('Compiling module alpha.js', 'key');
  assert.equal(computeBoundaryProbability(qSame, kSame), 0);

  const qShift = projectUnitVector('FATAL ERROR: Segmentation fault at 0x0000', 'query');
  const pShift = computeBoundaryProbability(qShift, kSame);
  assert.ok(pShift > 0.5, `Expected context fracture P_t > 0.5, got ${pShift}`);

  const lines = [
    'PASS test_case_1',
    'PASS test_case_2',
    'PASS test_case_3',
    'FATAL ERROR: database connection refused',
  ];
  const routed = routeCosineBoundaries(lines, { threshold: 0.35 });
  assert.equal(routed.hardBoundaries[0], 1);
  assert.equal(routed.hardBoundaries[1], 0);
  assert.equal(routed.hardBoundaries[2], 0);
  assert.equal(routed.hardBoundaries[3], 1);
  assert.equal(routed.chunks.length, 2);
});

test('3. EMA Crossfade Smoothing and Straight-Through Estimator (STE) preserve forward hard cuts and backward continuous gradients', () => {
  const chunks = [
    { text: 'step 1', boundaryProbability: 1.0, vector: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { text: 'step 2', boundaryProbability: 0.5, vector: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  ];
  const smoothed = emaSmoothChunks(chunks);
  assert.deepEqual(smoothed[0].emaVector.slice(0, 2), [1, 0]);
  // Z_bar_1 = 0.5 * [0, 1] + 0.5 * [1, 0] = [0.5, 0.5]
  assert.deepEqual(smoothed[1].emaVector.slice(0, 2), [0.5, 0.5]);

  const steHigh = straightThroughEstimatorStep(0.82, -0.33, 0.5);
  assert.equal(steHigh.hardForward, 1.0);
  assert.equal(steHigh.steForwardValue, 1.0);
  assert.equal(steHigh.backwardGradient, -0.33);

  const steLow = straightThroughEstimatorStep(0.21, 0.19, 0.5);
  assert.equal(steLow.hardForward, 0.0);
  assert.equal(steLow.steForwardValue, 0.0);
  assert.equal(steLow.backwardGradient, 0.19);
});

test('4. Auxiliary Ratio Loss penalizes router collapse and validates target compression N=6', () => {
  // Ideal N=6: 1 boundary every 6 tokens
  const probsOptimal = [1, 0.05, 0.05, 0.05, 0.05, 0.05, 0.9, 0.05, 0.05, 0.05, 0.05, 0.05];
  const hardOptimal = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];
  const optimal = computeAuxiliaryRatioLoss(probsOptimal, hardOptimal, { targetRatioN: 6 });
  assert.equal(optimal.status, 'optimal');
  assert.equal(optimal.achievedCompressionRatio, 6);

  // Lazy router assigning P_t = 1.0 everywhere (no compression)
  const probsLazy = new Array(12).fill(1.0);
  const hardLazy = new Array(12).fill(1);
  const lazy = computeAuxiliaryRatioLoss(probsLazy, hardLazy, { targetRatioN: 6 });
  assert.equal(lazy.status, 'under_compressed');
  assert.ok(lazy.ratioLoss > optimal.ratioLoss);
});

test('5. Two-Stage Recursive H-Net Hierarchy and Dynamic Stream Shunting compress repetitive logs while preserving errors', () => {
  const twoStage = buildTwoStageHierarchy(
    'const x = 1; const y = 2; FATAL ERROR: rm -rf / blocked by PreToolUse diode',
    { stage1BlockBytes: 4 }
  );
  assert.ok(twoStage.stage1.chunkCount >= twoStage.stage2.chunkCount);
  assert.ok(twoStage.totalCompressionRatio > 1);

  const noisyBuildLog = [
    ...Array.from({ length: 20 }, (_, i) => `[build] compiling file_${i}.js -> ok`),
    'ERROR: Invariant violation in src/api/server.js:512',
    '  at verifyGate (src/api/server.js:512:9)',
    'VERDICT: FAIL',
  ].join('\n');

  const shunted = shuntAgentStreamDynamic(noisyBuildLog, { boundaryThreshold: 0.35 });
  assert.equal(shunted.originalLineCount, 23);
  assert.ok(shunted.retainedChunkCount <= 5);
  assert.ok(shunted.shuntedText.includes('ERROR: Invariant violation'));
  assert.ok(shunted.shuntedText.includes('H-Net dynamic chunk collapsed'));
});

test('6. Enforces 30B-byte training crossover honesty and blocks mamba-ssm cloning', () => {
  assert.deepEqual(detectCloneAttempt('pip install mamba-ssm causal-conv1d'), ['vendor_mamba_ssm']);
  assert.deepEqual(detectCloneAttempt('node scripts/hnet-dynamic-chunking-honesty.js --json'), []);

  const subCrossover = evaluateByteCrossoverThreshold({
    trainingBytes: 1_000_000_000,
    claimsBeatBpe: true,
  });
  assert.equal(subCrossover.ok, false);
  assert.equal(subCrossover.requiredCrossoverBytes, BYTE_TRAINING_CROSSOVER_BYTES);

  const aboveCrossover = evaluateByteCrossoverThreshold({
    trainingBytes: 35_000_000_000,
    claimsBeatBpe: true,
  });
  assert.equal(aboveCrossover.ok, true);
});

test('7. CLI --json doctor exits 0 with all checks passing', () => {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'hnet-dynamic-chunking-honesty.js');
  const stdout = execFileSync(process.execPath, [scriptPath, '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.verdict, 'PASS');
  assert.equal(runDoctor().ok, true);
});
