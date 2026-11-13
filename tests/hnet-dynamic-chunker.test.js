'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeAuxiliaryRatioLoss,
  computeCosineBoundaryProbabilities,
  cosineSimilarity,
  deobfuscateNoisyByteStream,
  emaSmoothStates,
  encodeBytesMambaState,
  hierarchicalChunk,
  straightThroughEstimator,
} = require('../scripts/hnet-dynamic-chunker');
const { evaluatePromptGuard } = require('../scripts/prompt-guard');
const { canonicalizeCommandPositions, evaluateGatesAsync } = require('../scripts/gates-engine');

test('Pillar 1 & 2: Outer Mamba-2 byte encoder + Unsupervised Cosine Router triggers hard cuts on context shifts (P_t > 0.5)', () => {
  const { bytes, states } = encodeBytesMambaState('rm -rf /tmp');
  assert.equal(bytes.length, 11);
  assert.equal(states.length, 11);

  const routing = computeCosineBoundaryProbabilities(states, { threshold: 0.5 });
  assert.equal(routing.probabilities[0], 1.0);
  assert.equal(routing.hardBoundaries[0], 1);

  // Space after "rm" (index 2) is a byte-class transition -> P_t > 0.5 -> hard boundary = 1
  assert.ok(routing.probabilities[2] > 0.5, `Expected P_2 > 0.5 on byte class shift, got ${routing.probabilities[2]}`);
  assert.equal(routing.hardBoundaries[2], 1);

  // Adjacent lowercase letters 'r' -> 'm' share the same byte class -> high cosine similarity -> P_1 < 0.5
  assert.ok(routing.probabilities[1] < 0.5, `Expected P_1 < 0.5 within word, got ${routing.probabilities[1]}`);
  assert.equal(routing.hardBoundaries[1], 0);
});

test('Pillar 1: 2-Stage Hierarchical U-Net topology segments unspaced camelCase, CJK, and shell payloads without splitting UTF-8 codepoints', () => {
  const mixedInput = '删除生产数据库deleteProdDatabaseNow';
  const report = hierarchicalChunk(mixedInput);

  assert.ok(report.byteLength > mixedInput.length);
  assert.ok(report.stage1Chunks.length >= 4);
  assert.ok(report.stage2Chunks.length >= 1);

  // Rejoining Stage-1 chunks must losslessly reconstruct the exact UTF-8 string
  const reconstructed = report.stage1Chunks.map((c) => c.text).join('');
  assert.equal(reconstructed, mixedInput);

  // Verify camelCase transitions split "delete", "Prod", "Database", "Now"
  const stage1Texts = report.stage1Chunks.map((c) => c.text);
  assert.ok(stage1Texts.includes('delete'));
  assert.ok(stage1Texts.includes('Prod'));
  assert.ok(stage1Texts.includes('Database'));
  assert.ok(stage1Texts.includes('Now'));
});

test('Pillar 3: EMA Crossfade Smoothing Z_bar_t = P_t*Z_t + (1-P_t)*Z_bar_{t-1} and Straight-Through Estimator (STE)', () => {
  const states = [
    [1, 0],
    [0, 1],
    [0, 1],
  ];
  const probabilities = [1.0, 0.25, 0.8];
  const smoothed = emaSmoothStates(states, probabilities);

  assert.deepEqual(smoothed[0], [1, 0]);
  // t=1: 0.25*[0,1] + 0.75*[1,0] = [0.75, 0.25]
  assert.deepEqual(smoothed[1], [0.75, 0.25]);
  // t=2: 0.8*[0,1] + 0.2*[0.75,0.25] = [0.15, 0.85]
  assert.ok(Math.abs(smoothed[2][0] - 0.15) < 1e-9);
  assert.ok(Math.abs(smoothed[2][1] - 0.85) < 1e-9);

  // STE forward pass rounds probabilities > 0.5 to 1 and <= 0.5 to 0, while backward pass preserves continuous gradients
  const gradOutput = [
    [1, 1],
    [2, 4],
    [1, 3],
  ];
  const ste = straightThroughEstimator(probabilities, states, gradOutput, 0.5);
  assert.deepEqual(ste.forwardHard, [1, 0, 1]);
  // At t=1 (where hard boundary is 0), continuous gradient dL/dP_1 = 2*(0 - 1) + 4*(1 - 0) = 2 != 0
  assert.equal(ste.gradProbabilities[1], 2);
});

test('Pillar 4: Auxiliary Ratio Loss penalizes under/over-compression and achieves minimum 1.0 at target compression ratio N', () => {
  const N = 4;
  // Exact 1/N boundary rate: 1 boundary per 4 bytes, mean P_t = 0.25
  const optimalProbs = [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25];
  const optimalHard = [1, 0, 0, 0, 1, 0, 0, 0];
  const optLoss = computeAuxiliaryRatioLoss(optimalProbs, optimalHard, N);
  assert.equal(optLoss.f, 0.25);
  assert.equal(optLoss.g, 0.25);
  assert.equal(optLoss.loss, 1.0);
  assert.equal(optLoss.actualCompressionRatio, 4);

  // Degenerate router assigning P_t = 1.0 to every byte (no compression) incurs higher ratio loss
  const lazyProbs = new Array(8).fill(1.0);
  const lazyHard = new Array(8).fill(1);
  const lazyLoss = computeAuxiliaryRatioLoss(lazyProbs, lazyHard, N);
  assert.ok(lazyLoss.loss > optLoss.loss, `Expected lazy loss ${lazyLoss.loss} > optimal ${optLoss.loss}`);
});

test('Pillar 4 + PromptGuard integration: deobfuscateNoisyByteStream catches secrets obfuscated with zero-width bytes or shell quote/IFS splits', () => {
  const githubPatParts = ['ghp_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'];
  const obfuscatedPrompt = `export TOKEN=${githubPatParts[0]}\u200B\u200C""${githubPatParts[1]}`;

  const deob = deobfuscateNoisyByteStream(obfuscatedPrompt);
  assert.equal(deob.hadInvisibleBytes, true);
  assert.ok(deob.normalizedText.includes(githubPatParts.join('')));

  const guardResult = evaluatePromptGuard(obfuscatedPrompt);
  assert.ok(guardResult, 'Expected evaluatePromptGuard to block zero-width/quote-obfuscated GitHub token');
  assert.equal(guardResult.continue, false);
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([], []), 0);
});

test('Pillar 4 + GatesEngine integration: canonicalizeCommandPositions and evaluateGatesAsync block zero-width, ${IFS}, and quote-split catastrophic commands', async () => {
  assert.equal(canonicalizeCommandPositions('g\u200Bit reset --hard'), 'git reset --hard');
  assert.equal(canonicalizeCommandPositions('git${IFS}reset${IFS}--hard'), 'git reset --hard');
  assert.equal(canonicalizeCommandPositions('g\'i\'t r"e"set --hard'), 'git reset --hard');

  for (const cmd of ['r\u200Bm -rf ~', 'rm${IFS}-rf${IFS}~', 'r\'m\' -r"f" ~']) {
    const res = await evaluateGatesAsync('Bash', { command: cmd });
    assert.ok(res, `Expected evaluateGatesAsync to match obfuscated command: ${cmd}`);
    assert.equal(res.decision, 'deny', `Expected evaluateGatesAsync to deny obfuscated command: ${cmd}`);
    assert.equal(res.gate, 'rm-rf-home-or-root');
  }
});
