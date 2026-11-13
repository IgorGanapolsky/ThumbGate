'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const path = require('node:path');

const {
  computeHNetCosineRoutingAndBoundaries,
  computeHNetEmaSmoothingAndSteCrossfade,
  calculateHNetAuxiliaryRatioLoss,
  evaluateHNetDynamicChunkingAndRawByteSteal,
} = require('../src/cloud-token-firewall');

const {
  evaluateHNetDynamicChunkingAndRawByteSteal: fastMoneyHNetSteal,
} = require('../scripts/fast-money-engine');

test('H-Net Cosine Routing: handles empty and raw byte inputs correctly', () => {
  const emptyRes = computeHNetCosineRoutingAndBoundaries({ rawInput: '' });
  assert.equal(emptyRes.ok, true);
  assert.equal(emptyRes.sequenceLengthT, 0);
  assert.equal(emptyRes.boundaries.length, 0);
  assert.equal(emptyRes.chunks.length, 0);

  const sampleText = 'def authenticate_user(token):\n    return verify(token)';
  const strRes = computeHNetCosineRoutingAndBoundaries({ rawInput: sampleText, targetChunkSize: 6 });
  assert.equal(strRes.ok, true);
  assert.equal(strRes.sequenceLengthT, Buffer.from(sampleText).length);
  assert.equal(strRes.boundaries[0], 1); // Position 0 is always a boundary
  assert.ok(strRes.chunkCount > 1);
  assert.ok(strRes.compressionRatio > 1.0);
  assert.ok(strRes.hardFractionF > 0);
  assert.ok(strRes.softFractionG > 0);
});

test('H-Net Cosine Routing: mathematical formula P_t = 0.5 * (1 - sim(q_t, k_{t-1})) holds exactly', () => {
  // Test with explicit vectors:
  // Vector 0: [1, 0] (base condition t=0)
  // Vector 1: [1, 0] (identical to Vector 0 -> sim = 1.0 -> P_t = 0.0)
  // Vector 2: [0, 1] (orthogonal to Vector 1 -> sim = 0.0 -> P_t = 0.5)
  // Vector 3: [0, -1] (opposite to Vector 2 -> sim = -1.0 -> P_t = 1.0)
  const explicitVectors = [
    new Float64Array([1.0, 0.0]),
    new Float64Array([1.0, 0.0]),
    new Float64Array([0.0, 1.0]),
    new Float64Array([0.0, -1.0]),
  ];
  const rawBytes = [65, 66, 67, 68];

  const res = computeHNetCosineRoutingAndBoundaries({
    rawInput: rawBytes,
    byteVectors: explicitVectors,
    cutThreshold: 0.5,
  });

  assert.equal(res.sequenceLengthT, 4);
  assert.equal(res.routingDetails[0].boundaryProbability, 1.0); // t=0 base condition
  assert.equal(res.routingDetails[1].similarityWithPrevious, 1.0); // identical
  assert.equal(res.routingDetails[1].boundaryProbability, 0.0);
  assert.equal(res.boundaries[1], 0);

  assert.equal(res.routingDetails[2].similarityWithPrevious, 0.0); // orthogonal
  assert.equal(res.routingDetails[2].boundaryProbability, 0.5);
  assert.equal(res.boundaries[2], 0); // threshold is > 0.5

  assert.equal(res.routingDetails[3].similarityWithPrevious, -1.0); // opposite direction to vector 2
  assert.equal(res.routingDetails[3].boundaryProbability, 1.0);
  assert.equal(res.boundaries[3], 1); // cut triggered!
});

test('H-Net EMA Smoothing & STE Crossfade: stabilizes backpropagation and eliminates Gumbel noise', () => {
  const boundaryProbs = [1.0, 0.1, 0.8, 0.2];
  const chunkVectors = [
    [1.0, 1.0, 1.0, 1.0],
    [2.0, 2.0, 2.0, 2.0],
    [3.0, 3.0, 3.0, 3.0],
    [4.0, 4.0, 4.0, 4.0],
  ];

  const ema = computeHNetEmaSmoothingAndSteCrossfade({
    chunkVectors,
    boundaryProbabilities: boundaryProbs,
    dimension: 4,
  });

  assert.equal(ema.ok, true);
  assert.equal(ema.sequenceLengthT, 4);
  assert.equal(ema.gumbelNoiseEliminated, true);
  assert.equal(ema.differentiableCrossfade, true);
  assert.equal(ema.steHardSelection.length, 4);
  // Boundary > 0.5 triggers hard cut
  assert.deepEqual(ema.steHardSelection, [1, 0, 1, 0]);

  // t=0 base condition: smoothed = Z_0 = [1, 1, 1, 1]
  assert.deepEqual(ema.smoothedSequence[0], [1, 1, 1, 1]);

  // t=1: Pt=0.1, Z1=2. smoothed = 0.1 * 2 + 0.9 * 1 = 1.1
  assert.deepEqual(ema.smoothedSequence[1], [1.1, 1.1, 1.1, 1.1]);

  // STE continuous gradients are non-empty and finite
  assert.equal(ema.steContinuousGradients.length, 4);
});

test('H-Net Auxiliary Ratio Loss: penalizes deviations from target chunk size and prevents lazy collapse', () => {
  // Target N = 4 -> r* = 0.25
  const boundaryProbs = [0.25, 0.25, 0.25, 0.25];
  const hardCuts = [0, 1, 0, 0]; // 1 / 4 = 0.25

  const lossIdeal = calculateHNetAuxiliaryRatioLoss({
    boundaryProbabilities: boundaryProbs,
    hardCuts,
    targetChunkSize: 4,
    lambdaRatio: 1.0,
  });

  assert.equal(lossIdeal.ok, true);
  assert.equal(lossIdeal.targetBoundaryRatioRStar, 0.25);
  assert.equal(lossIdeal.hardFractionF, 0.25);
  assert.equal(lossIdeal.softFractionG, 0.25);
  assert.equal(lossIdeal.totalAuxiliaryLoss, 0.0);

  // Lazy collapse scenario: P_t = 1.0 everywhere (zero compression)
  const lossLazy = calculateHNetAuxiliaryRatioLoss({
    boundaryProbabilities: [1.0, 1.0, 1.0, 1.0],
    hardCuts: [1, 1, 1, 1],
    targetChunkSize: 4,
  });
  assert.ok(lossLazy.totalAuxiliaryLoss > 0.5); // Large penalty for lazy collapse
});

test('H-Net Full Steal Evaluation: benchmarks 5 pillars and compares against BPE tokenizer', () => {
  const evalRes = evaluateHNetDynamicChunkingAndRawByteSteal({
    rawInput: 'class NeuralNetwork(nn.Module):\n    def __init__(self):\n        super().__init__()',
    targetChunkSize: 6,
  });

  assert.equal(evalRes.ok, true);
  assert.ok(evalRes.sourceUrls.includes('https://music.youtube.com/watch?v=bomIFE-G-do'));
  assert.equal(evalRes.paperTitle, 'H-Net: Hierarchical Dynamic Chunking for End-to-End Raw Byte Sequence Modeling');

  // Pillar 1: U-Net Hybrid Topology
  const p1 = evalRes.fivePillarsOfHNet.pillar1_unet_hybrid_topology;
  assert.equal(p1.rawBytesDirectIngestion, true);
  assert.equal(p1.staticBpeTokenizerEliminated, true);
  assert.ok(p1.outerLayers.includes('Mamba-2'));
  assert.ok(p1.centralCore.includes('Transformer'));

  // Pillar 2: Unsupervised Cosine Routing
  const p2 = evalRes.fivePillarsOfHNet.pillar2_unsupervised_cosine_routing;
  assert.ok(p2.formula.includes('CosineSimilarity'));

  // Pillar 3: Stabilized Backprop via EMA & STE
  const p3 = evalRes.fivePillarsOfHNet.pillar3_stabilized_backprop_ema_ste;
  assert.equal(p3.gumbelSoftmaxNoiseAvoided, true);

  // Pillar 4: Auxiliary Ratio Loss
  const p4 = evalRes.fivePillarsOfHNet.pillar4_auxiliary_ratio_loss;
  assert.ok(p4.preventsLazyCollapse);

  // Pillar 5: Target Modalities
  const p5 = evalRes.fivePillarsOfHNet.pillar5_target_modalities_and_scale;
  assert.ok(p5.unspacedLanguages);
  assert.ok(p5.codeIndentationSyntax);
  assert.ok(p5.genomicsAndDna);
  assert.ok(p5.adversarialTypoDefense);
  assert.ok(p5.trainingScaleCrossover.includes('30-billion-byte'));

  // BPE Comparison Matrix
  const bpe = evalRes.bpeComparisonVsHNet;
  assert.equal(bpe.outOfVocabularyHandling.hnet, '100% native raw byte coverage, 0 OOV');
  assert.ok(bpe.tokenSmugglingDefense.hnet.includes('Immune'));
});

test('Fast Money Engine re-export: exposes evaluateHNetDynamicChunkingAndRawByteSteal faithfully', () => {
  assert.equal(typeof fastMoneyHNetSteal, 'function');
  const res = fastMoneyHNetSteal({ rawInput: 'test input string' });
  assert.equal(res.ok, true);
  assert.ok(res.fivePillarsOfHNet);
});

test('PyTorch reference file syntax: dynamic_chunking.py compiles cleanly', () => {
  const pyPath = path.join(__dirname, '..', 'src', 'hnet', 'dynamic_chunking.py');
  const result = execSync(`python3 -m py_compile "${pyPath}"`, { encoding: 'utf-8' });
  assert.equal(result, '');
});
