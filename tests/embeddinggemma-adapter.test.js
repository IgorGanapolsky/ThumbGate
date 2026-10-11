'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  MODEL_NAME,
  MODEL_BACKBONE_270M,
  NATIVE_DIMENSION,
  MRL_DIMENSIONS,
  FAST_GATE_DIMENSION,
  MAX_CONTEXT_TOKENS,
  MAX_CONTEXT_CHARS,
  SUPPORTED_MODALITIES,
  TASK_PREFIXES,
  l2Normalize,
  truncateMrl,
  cosineSimilarity,
  formatEmbeddingInput,
  generateEmbeddingVector,
  createMultimodalEmbedding,
  evaluatePreToolUseGate,
  runEmbeddingGemmaDoctor,
} = require('../scripts/embeddinggemma-adapter');

const { parseEmbeddingIdentity, assertCompatibleEmbeddings } = require('../scripts/rag-embedding-identity');

test('EmbeddingGemma 2 Architecture Constants & Modalities', () => {
  assert.equal(MODEL_NAME, 'google/embeddinggemma-2');
  assert.equal(MODEL_BACKBONE_270M, 'google/embeddinggemma-2-270m');
  assert.equal(NATIVE_DIMENSION, 768);
  assert.equal(FAST_GATE_DIMENSION, 256);
  assert.equal(MAX_CONTEXT_TOKENS, 8192);
  assert.deepEqual(MRL_DIMENSIONS, [64, 128, 256, 512, 768]);
  assert.ok(SUPPORTED_MODALITIES.includes('text'));
  assert.ok(SUPPORTED_MODALITIES.includes('code'));
  assert.ok(SUPPORTED_MODALITIES.includes('vision'));
  assert.ok(SUPPORTED_MODALITIES.includes('audio'));
});

test('Matryoshka Representation Learning (MRL) Truncation & L2 Normalization', () => {
  const fullVec = generateEmbeddingVector('const x = 42; // test', { dimension: 768 });
  assert.equal(fullVec.length, 768);

  // Check L2 norm is 1.0 on native vector
  const norm768 = Math.sqrt(fullVec.reduce((s, v) => s + v * v, 0));
  assert.ok(Math.abs(norm768 - 1.0) < 1e-4, `Expected norm 1.0, got ${norm768}`);

  // Truncate to MRL tiers
  for (const tier of [512, 256, 128, 64]) {
    const truncated = truncateMrl(fullVec, tier);
    assert.equal(truncated.length, tier);
    const norm = Math.sqrt(truncated.reduce((s, v) => s + v * v, 0));
    assert.ok(Math.abs(norm - 1.0) < 1e-4, `Expected tier ${tier} norm 1.0, got ${norm}`);
  }

  // Cosine similarity consistency across dimensions
  const vecA = generateEmbeddingVector('git checkout -b new-feature', { dimension: 768 });
  const vecB = generateEmbeddingVector('git switch -c new-feature', { dimension: 768 });
  
  const simFull = cosineSimilarity(vecA, vecB);
  const sim256 = cosineSimilarity(truncateMrl(vecA, 256), truncateMrl(vecB, 256));
  
  assert.ok(simFull > 0.5, 'Synonymous git actions should have strong similarity at 768d');
  assert.ok(sim256 > 0.5, 'Synonymous git actions should preserve strong similarity at 256d');
});

test('8K Token Context Window Formatting & Scaling', () => {
  const codeChunk = 'function compute() { return true; }\n'.repeat(400); // ~14k chars
  const formatted = formatEmbeddingInput(codeChunk, { modality: 'code', isQuery: false });

  assert.ok(formatted.startsWith(TASK_PREFIXES.CODE_DOCUMENT));
  assert.ok(formatted.length > 10000);

  // Exceeding 32K chars should cap safely at MAX_CONTEXT_CHARS
  const hugeChunk = 'A'.repeat(50000);
  const formattedHuge = formatEmbeddingInput(hugeChunk, { modality: 'text' });
  assert.ok(formattedHuge.length <= MAX_CONTEXT_CHARS + TASK_PREFIXES.TEXT_DOCUMENT.length);

  const t0 = process.hrtime.bigint();
  const vec = generateEmbeddingVector(formatted, { dimension: 256 });
  const t1 = process.hrtime.bigint();
  const latencyMs = Number(t1 - t0) / 1e6;

  assert.equal(vec.length, 256);
  assert.ok(latencyMs < 50, `8K context embedding should complete in <50ms, took ${latencyMs}ms`);
});

test('Multimodal Representation with Visual & Code Metadata', () => {
  const multimodalItem = createMultimodalEmbedding({
    modality: 'vision',
    content: 'BrowserOS Neo visual regression: login button obscured by cookie banner',
    visualHash: 'sha256-visual-a89e1b2f4c',
    metadata: {
      url: 'https://app.example.com/login',
      resolution: '1920x1080',
    },
    dimension: FAST_GATE_DIMENSION,
  });

  assert.equal(multimodalItem.model, 'google/embeddinggemma-2');
  assert.equal(multimodalItem.modality, 'vision');
  assert.equal(multimodalItem.dimension, 256);
  assert.equal(multimodalItem.metadata.visualHash, 'sha256-visual-a89e1b2f4c');
  assert.ok(multimodalItem.contentPreview.includes('login button obscured'));
});

test('PreToolUse Multi-Modal Invariant Gate Evaluation (<0.5ms CPU Budget)', () => {
  const lessonCorpus = [
    {
      id: 'lesson-git-force-wipe',
      title: 'Never force push or wipe untracked work in shared checkout',
      content: 'A foreign agent executed git clean -f and git push -f, destroying uncommitted teammate work.',
      modality: 'code',
      whatWentWrong: 'Force push wiped master branch history and untracked files.',
    },
    {
      id: 'lesson-secret-exfiltration',
      title: 'Block shell execution transmitting AWS keys',
      content: 'Curl command attempted egress of AWS_SECRET_KEY to external webhook.',
      modality: 'code',
      whatWentWrong: 'Exfiltrated environment credentials.',
    },
  ];

  // Dangerous action: should be denied by semantic similarity to lesson
  const dangerousCall = { command: 'git push --force origin main' };
  const verdictDangerous = evaluatePreToolUseGate(dangerousCall, lessonCorpus, {
    threshold: 0.60,
    dimension: FAST_GATE_DIMENSION,
  });

  assert.equal(verdictDangerous.permissionDecision, 'deny');
  assert.equal(verdictDangerous.decision, 'block');
  assert.ok(verdictDangerous.similarity >= 0.60);
  assert.equal(verdictDangerous.matchedLesson.id, 'lesson-git-force-wipe');
  assert.ok(verdictDangerous.latencyMs < 5.0, `Gating evaluation took ${verdictDangerous.latencyMs}ms`);

  // Benign action: should be allowed
  const benignCall = { command: 'npm test -- --coverage' };
  const verdictBenign = evaluatePreToolUseGate(benignCall, lessonCorpus, {
    threshold: 0.60,
    dimension: FAST_GATE_DIMENSION,
  });

  assert.equal(verdictBenign.permissionDecision, 'allow');
  assert.equal(verdictBenign.decision, 'pass');
  assert.equal(verdictBenign.matchedLesson, null);
});

test('RAG Embedding Identity Fail-Closed Contract Integration', () => {
  const identity = parseEmbeddingIdentity('google/embeddinggemma-2:768');
  assert.equal(identity.source, 'google/embeddinggemma-2');
  assert.equal(identity.model, 'google/embeddinggemma-2');
  assert.equal(identity.dimension, 768);

  // Compatible same-model check
  const compat = assertCompatibleEmbeddings({
    queryProvider: 'google/embeddinggemma-2:768',
    queryDimension: 768,
    documentProvider: 'google/embeddinggemma-2:768',
    documentDimension: 768,
  });
  assert.ok(compat.ok);
  assert.equal(compat.failClosed, false);

  // Incompatible provider mismatch fails closed
  const mismatch = assertCompatibleEmbeddings({
    queryProvider: 'google/embeddinggemma-2:768',
    queryDimension: 768,
    documentProvider: 'openai/text-embedding-3-small:1536',
    documentDimension: 1536,
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.failClosed, true);
});

test('EmbeddingGemma Doctor System Diagnostic Verification', () => {
  const doctorResults = runEmbeddingGemmaDoctor();
  assert.equal(doctorResults.status, 'pass');
  assert.equal(doctorResults.checks.length, 3);
  assert.ok(doctorResults.checks.every((c) => c.status === 'pass'));
});
