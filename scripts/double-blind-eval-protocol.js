'use strict';

/**
 * Double-Blind Evaluation Protocol — ThumbGate steal of the Google DeepMind
 * pilot (TheNewStack coverage; deepmind.google blog): the first double-blind
 * evaluation of a proprietary frontier model, run in a confidential-computing
 * enclave so the provider never sees the benchmark questions and the
 * evaluator never sees the weights.
 *
 * Why it matters (the article's numbers): earlier research found signs of
 * benchmark leakage in about half of 31 models tested, and contamination
 * inflates scores, especially for larger models. Closed models make private
 * benchmarks hard: API-based evaluation exposes questions to the provider.
 *
 * Protocol, mapped onto ThumbGate as the enclave broker:
 *
 *   provider  seals model asset (weights / inference code / agent config)
 *   evaluator seals benchmark asset (prompts / eval code)
 *        |  encrypted in transit; only hashes cross the boundary
 *        v
 *   ThumbGate enclave runs the eval over the sealed pair
 *        v
 *   ONLY scores leave the enclave — never questions, never weights
 *        v
 *   attestation receipt (hash chain) proves neither party saw the
 *   other's assets before the results were released
 *
 * Honesty: this is a deterministic local model of the protocol (sha256
 * sealing + HMAC attestation). It does not provide real confidential
 * computing; it provides the enforcement surface ThumbGate can gate on.
 */

const crypto = require('node:crypto');

const ASSET_KINDS = Object.freeze(['model', 'benchmark']);

// Private store for sealed asset content — never exposed in JSON serialization.
const _contentStore = new WeakMap();

/**
 * Seal one asset. The content goes into the sealed store; only metadata and
 * a sha256 commitment cross the boundary.
 *
 * @param {string} kind     'model' | 'benchmark'
 * @param {string} content  the protected asset
 * @param {string} owner    who sealed it
 */
function sealAsset(kind, content, owner) {
  if (!ASSET_KINDS.includes(kind)) {
    throw new Error(`unknown asset kind "${kind}"`);
  }
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('asset content must be a non-empty string');
  }
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  const seal = {
    sealId: `seal_${digest.slice(0, 16)}`,
    kind,
    owner: String(owner || 'unknown'),
    sha256: digest,
    sealedAt: new Date().toISOString(),
    // token required to retrieve the content; holder != the other party
    accessToken: crypto.randomBytes(16).toString('hex'),
  };
  // Store content privately so it is never serialized by JSON.stringify.
  Object.defineProperty(seal, '_content', {
    value: content,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  _contentStore.set(seal, content);
  return seal;
}

/**
 * Create an enclave over one model seal and one benchmark seal.
 */
function createEnclave(modelSeal, benchmarkSeal) {
  if (!modelSeal || modelSeal.kind !== 'model') {
    throw new Error('enclave requires a model seal');
  }
  if (!benchmarkSeal || benchmarkSeal.kind !== 'benchmark') {
    throw new Error('enclave requires a benchmark seal');
  }
  return {
    enclaveId: `enclave_${crypto.randomBytes(8).toString('hex')}`,
    modelSeal: { sealId: modelSeal.sealId, sha256: modelSeal.sha256, owner: modelSeal.owner },
    benchmarkSeal: { sealId: benchmarkSeal.sealId, sha256: benchmarkSeal.sha256, owner: benchmarkSeal.owner },
    openedAt: new Date().toISOString(),
    modeled: true,
    note: 'local deterministic model of a confidential-computing enclave',
  };
}

/**
 * Run the evaluation inside the enclave. The scoring function receives the
 * sealed pair and returns per-question results; only scores leave.
 *
 * @param {object} enclave
 * @param {object} modelSeal      sealed model asset (with access token)
 * @param {object} benchmarkSeal  sealed benchmark asset (with access token)
 * @param {Function} scoreFn      ({ modelContent, questions }) => [{question, score}]
 */
function runEvaluation(enclave, modelSeal, benchmarkSeal, scoreFn) {
  // Validate seals against the enclave commitment before scoring.
  // A caller cannot swap seals or tamper with content after enclave creation.
  if (modelSeal.sealId !== enclave.modelSeal.sealId ||
      modelSeal.sha256 !== enclave.modelSeal.sha256) {
    throw new Error('model seal does not match the enclave commitment');
  }
  if (benchmarkSeal.sealId !== enclave.benchmarkSeal.sealId ||
      benchmarkSeal.sha256 !== enclave.benchmarkSeal.sha256) {
    throw new Error('benchmark seal does not match the enclave commitment');
  }
  const modelContent = _contentStore.get(modelSeal);
  const benchmarkContent = _contentStore.get(benchmarkSeal);
  if (typeof modelContent !== 'string') {
    throw new Error('model content is not available in the private store');
  }
  const questions = JSON.parse(benchmarkContent);
  const results = scoreFn({
    modelContent,
    questions,
  });
  // Require exactly one result per benchmark question.
  if (!Array.isArray(results) || results.length !== questions.length) {
    throw new Error(
      `scoreFn must return exactly ${questions.length} results, got ${Array.isArray(results) ? results.length : 'non-array'}`,
    );
  }
  // Only scores cross the boundary. Questions and model content never do.
  const scores = results.map((r, i) => ({
    index: i,
    score: Number(r.score),
    passed: Boolean(r.score >= 1),
  }));
  return {
    enclaveId: enclave.enclaveId,
    released: 'scores-only',
    scores,
    passRate: scores.length === 0 ? 0 : scores.filter((s) => s.passed).length / scores.length,
    questions: undefined, // explicitly withheld
    modelContent: undefined, // explicitly withheld
  };
}

/**
 * Leakage guard: refuse to release any output that contains benchmark
 * question text. This is the enforcement teeth of the protocol.
 */
function leakageGuard(output, benchmarkSeal) {
  const questions = JSON.parse(benchmarkSeal._content);
  const s = typeof output === 'string' ? output : JSON.stringify(output);
  for (const q of questions) {
    const text = typeof q === 'string' ? q : String(q.prompt || '');
    if (text && s.includes(text)) {
      return { clean: false, leakedQuestionIndex: questions.indexOf(q) };
    }
  }
  return { clean: true };
}

/**
 * Attestation receipt: hash chain over both seals + the released scores.
 * A third party can verify it without ever seeing either asset.
 */
function attest(enclave, evaluationResult, attestationKey) {
  if (typeof attestationKey !== 'string' || attestationKey.trim().length === 0) {
    throw new Error('a non-empty attestationKey must be provided by the caller');
  }
  const key = attestationKey;
  const payload = JSON.stringify({
    enclaveId: enclave.enclaveId,
    modelSealSha: enclave.modelSeal.sha256,
    benchmarkSealSha: enclave.benchmarkSeal.sha256,
    scores: evaluationResult.scores,
  });
  const receiptHash = crypto.createHmac('sha256', key).update(payload).digest('hex');
  return {
    receiptId: `att_${receiptHash.slice(0, 16)}`,
    enclaveId: enclave.enclaveId,
    modelSealSha: enclave.modelSeal.sha256,
    benchmarkSealSha: enclave.benchmarkSeal.sha256,
    scoreCount: evaluationResult.scores.length,
    passRate: evaluationResult.passRate,
    receiptHash,
    attestedAt: new Date().toISOString(),
    claim: 'neither party accessed the other\'s sealed asset before results release',
  };
}

/**
 * Verify an attestation receipt against the seals and scores.
 */
function verifyAttestation(receipt, modelSeal, benchmarkSeal, scores, attestationKey) {
  if (typeof attestationKey !== 'string' || attestationKey.trim().length === 0) {
    throw new Error('a non-empty attestationKey must be provided by the caller');
  }
  const key = attestationKey;
  const payload = JSON.stringify({
    enclaveId: receipt.enclaveId,
    modelSealSha: modelSeal.sha256,
    benchmarkSealSha: benchmarkSeal.sha256,
    scores,
  });
  const expected = crypto.createHmac('sha256', key).update(payload).digest('hex');
  return {
    valid: expected === receipt.receiptHash,
    sealIntegrity: {
      model: modelSeal.sha256 === receipt.modelSealSha,
      benchmark: benchmarkSeal.sha256 === receipt.benchmarkSealSha,
    },
  };
}

function isCliEntrypoint() {
  return require.main === module;
}

function main() {
  const modelSeal = sealAsset('model', 'agent-config-v3 with valuation skill', 'provider');
  const benchmarkSeal = sealAsset(
    'benchmark',
    JSON.stringify(['Value MSFT', 'What is my risk exposure?']),
    'mlcommons',
  );
  const enclave = createEnclave(modelSeal, benchmarkSeal);
  const result = runEvaluation(enclave, modelSeal, benchmarkSeal, ({ questions }) =>
    questions.map((q) => ({ question: q, score: /value/i.test(q) ? 1 : 0.5 })),
  );
  const guard = leakageGuard(JSON.stringify(result.scores), benchmarkSeal);
  const receipt = attest(enclave, result);
  const verification = verifyAttestation(receipt, modelSeal, benchmarkSeal, result.scores);
  process.stdout.write(JSON.stringify({
    honesty: 'deterministic local model of the DeepMind double-blind protocol',
    enclave, result, guard, receipt, verification,
  }, null, 2) + '\n');
}

if (isCliEntrypoint()) main();

module.exports = {
  ASSET_KINDS,
  sealAsset,
  createEnclave,
  runEvaluation,
  leakageGuard,
  attest,
  verifyAttestation,
  isCliEntrypoint,
};
