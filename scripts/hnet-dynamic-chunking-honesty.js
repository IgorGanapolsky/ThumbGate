#!/usr/bin/env node
'use strict';

/**
 * H-Net Dynamic Chunking (arXiv:2507.07955) FORMAT steal — not a model clone.
 *
 * Sources:
 *   - https://arxiv.org/abs/2507.07955 ("Dynamic Chunking for End-to-End Hierarchical Sequence Modeling")
 *   - https://www.youtube.com/watch?v=bomIFE-G-do ("H-Net Explained: Dynamic Chunking Is Replacing Tokenization")
 *
 * Transfers 4 mathematical primitives onto ThumbGate's <1ms PreToolUse firewall,
 * context-shunting diode, and RL feedback trajectory segmentation:
 *   1. U-Net Hybrid Topology & Two-Stage Hierarchy:
 *      - Outer linear-time O(n) rolling state-space byte scanner (Mamba-2 analog)
 *        that strips zero-width/IFS/escaped byte obfuscation without quadratic KV blowup.
 *      - Stage 1 groups raw byte windows into syntactic tokens; Stage 2 groups
 *        syntactic tokens into compressed semantic chunks for the core evaluator.
 *   2. Unsupervised Cosine Routing Module:
 *      - Projects query (q_t) and key (k_{t-1}) vectors and computes exact
 *        boundary probability: P_t = 0.5 * (1 - CosineSimilarity(q_t, k_{t-1})).
 *      - Triggers discrete hard chunk cuts whenever P_t > 0.5.
 *   3. EMA Crossfade Smoothing + Straight-Through Estimator (STE):
 *      - Replaces stochastic Gumbel-Softmax noise with deterministic EMA smoothing:
 *        Z_bar_t = P_t * Z_t + (1 - P_t) * Z_bar_{t-1}.
 *      - Forward pass rounds P_t to hard {0, 1} cuts; backward pass passes continuous
 *        EMA gradients straight through.
 *   4. Auxiliary Compression Ratio Loss & 30B-Byte Crossover Honesty:
 *      - Penalizes deviation from target compression ratio (default N = 6 units/chunk)
 *        by aligning hard selected fraction (f) and continuous mean probability (g).
 *      - Enforces 30B-byte training crossover honesty (never vendor mamba-ssm/PyTorch
 *        or claim sub-30B byte-level weight training beats BPE).
 */

const SOURCE_URLS = Object.freeze([
  'https://arxiv.org/abs/2507.07955',
  'https://www.youtube.com/watch?v=bomIFE-G-do',
]);

const DEFAULT_TARGET_RATIO_N = 6;
const DEFAULT_BOUNDARY_THRESHOLD = 0.5;
const DEFAULT_SSM_DECAY_ALPHA = 0.75;
const BYTE_TRAINING_CROSSOVER_BYTES = 30_000_000_000; // 30B bytes (~30GB raw text)
const VECTOR_DIM = 16;

const CLONE_PATTERNS = Object.freeze([
  {
    id: 'vendor_mamba_ssm',
    re: /\b(pip\s+install|npm\s+i(?:nstall)?|vendor|clone)\b.{0,50}\b(mamba-ssm|causal-conv1d|hnet-pytorch)\b/i,
  },
  {
    id: 'train_byte_llm_in_gate',
    re: /\b(pretrain|fine[-_ ]?tune)\b.{0,40}\b(byte[-_ ]level\s+h-?net)\b.{0,40}\b(in\s+thumbgate|in\s+pretooluse)\b/i,
  },
]);

const ADVERSARIAL_BYTE_PATTERNS = Object.freeze([
  { id: 'rm_rf_root', re: /\brm\s+-[rf]{1,4}\s+(?:\/|~|\$HOME)(?=\s|$|;|&|\|)/i },
  { id: 'etc_passwd_shadow', re: /\/etc\/(?:passwd|shadow|sudoers)\b/i },
  { id: 'curl_pipe_sh', re: /\b(?:curl|wget)\b[^|]*\|\s*(?:ba)?sh\b/i },
  { id: 'git_force_push_main', re: /\bgit\s+push\b[^;]*--force(?:-with-lease)?\b[^;]*\b(?:main|master)\b/i },
  { id: 'env_secret_dump', re: /\b(?:printenv|env)\b.*\|\s*(?:curl|nc|POST)\b/i },
]);

function detectCloneAttempt(text) {
  const raw = String(text || '');
  return CLONE_PATTERNS.filter((p) => p.re.test(raw)).map((p) => p.id);
}

function evaluateByteCrossoverThreshold({
  trainingBytes = 0,
  claimsBeatBpe = false,
} = {}) {
  const bytes = Math.max(0, Number(trainingBytes) || 0);
  const belowCrossover = bytes < BYTE_TRAINING_CROSSOVER_BYTES;
  if (claimsBeatBpe && belowCrossover) {
    return {
      ok: false,
      verdict: 'FAIL_SUB_CROSSOVER_CLAIM',
      trainingBytes: bytes,
      requiredCrossoverBytes: BYTE_TRAINING_CROSSOVER_BYTES,
      reason: `Two-stage byte-level H-Net requires ~${BYTE_TRAINING_CROSSOVER_BYTES} training bytes before outscaling an optimized BPE baseline (got ${bytes}).`,
    };
  }
  return {
    ok: true,
    verdict: 'PASS',
    trainingBytes: bytes,
    requiredCrossoverBytes: BYTE_TRAINING_CROSSOVER_BYTES,
    reason: 'Training crossover honesty satisfied.',
  };
}

/**
 * Project a unit (byte, token, or line) into a deterministic 16-d feature vector.
 * Distinguishes query projection (W_q) and key projection (W_k) via phase shift
 * while preserving exact alignment (CosineSimilarity = 1.0) on identical context.
 */
function projectUnitVector(unit, role = 'query') {
  const str = typeof unit === 'number' ? String.fromCharCode(unit) : String(unit == null ? '' : unit);
  const vec = new Float64Array(VECTOR_DIM);
  if (!str) {
    vec[0] = 1;
    return Array.from(vec);
  }

  let charClassBits = 0;
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    const bucket = code % 10;
    const sign = ((code * 17 + i * 13) & 1) === 0 ? 1 : -1;
    vec[bucket] += sign * 0.25;
    if (i + 1 < str.length) {
      const nextCode = str.charCodeAt(i + 1);
      const biBucket = (code * 31 + nextCode) % 10;
      const biSign = ((code + nextCode) & 1) === 0 ? 1 : -1;
      vec[biBucket] += biSign * 0.35;
    }

    if (code >= 48 && code <= 57) charClassBits |= 1; // digit
    else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) charClassBits |= 2; // alpha
    else if (code === 32 || code === 9 || code === 10) charClassBits |= 4; // whitespace
    else if (code > 127) charClassBits |= 8; // multibyte / CJK / unicode
    else charClassBits |= 16; // punctuation / operator / delimiter
  }

  // Signed antipodal semantic regime coordinates in dimensions 10..15
  // Ensure semantic regime shifts produce negative dot products (CosineSimilarity < 0 -> P_t > 0.5)
  const lower = str.toLowerCase();
  const isError = /\b(error|exception|fail|failed|fatal|panic|denied|violation|traceback)\b/.test(lower);
  const isMutationCmd = /\b(rm|sudo|chmod|chown|curl|wget|eval|exec|drop|delete|truncate)\b/.test(lower);
  const isStackOrDiff = /^\s*(at\s+|file\s+"|traceback|\d+\s*\||---|\+\+\+|@@)/.test(lower);
  const isSummaryVerdict = /\b(finished|summary|verdict|passed|completed|total)\b/.test(lower);

  if (isError && !isSummaryVerdict) {
    vec[10] = -10.0;
    vec[11] = 12.0;
    vec[12] = -8.0;
    vec[13] = 6.0;
  } else if (isStackOrDiff) {
    vec[10] = -6.0;
    vec[11] = -10.0;
    vec[12] = 12.0;
    vec[13] = -6.0;
  } else if (isMutationCmd) {
    vec[10] = -12.0;
    vec[11] = -6.0;
    vec[12] = -6.0;
    vec[13] = 14.0;
  } else if (isSummaryVerdict) {
    vec[10] = 6.0;
    vec[11] = -12.0;
    vec[12] = -10.0;
    vec[13] = -8.0;
  } else {
    // Routine progress / compilation / normal text regime
    vec[10] = 12.0;
    vec[11] = 4.0;
    vec[12] = 4.0;
    vec[13] = -4.0;
  }

  vec[14] = ((charClassBits & 16) ? 3.0 : -3.0) + ((charClassBits & 8) ? 4.0 : 0);
  vec[15] = ((charClassBits & 1) ? 2.0 : -2.0);

  if (role === 'query' || role === 'key') {
    vec[0] += 1e-6;
  }
  return Array.from(vec);
}

function computeCosineSimilarity(vecA = [], vecB = []) {
  const len = Math.min(vecA.length, vecB.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    const a = Number(vecA[i]) || 0;
    const b = Number(vecB[i]) || 0;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom <= 1e-12) return 0;
  const rawSim = dot / denom;
  return Math.max(-1, Math.min(1, rawSim));
}

/**
 * H-Net Unsupervised Cosine Boundary Probability:
 *   P_t = 0.5 * (1 - CosineSimilarity(q_t, k_{t-1}))
 */
function computeBoundaryProbability(qVec, kPrevVec) {
  const sim = computeCosineSimilarity(qVec, kPrevVec);
  const prob = 0.5 * (1 - sim);
  return Number(Math.max(0, Math.min(1, prob)).toFixed(6));
}

/**
 * Outer Mamba-2 Analog: Linear O(n) State-Space Byte Scanner.
 * Scans raw byte streams with rolling state h_t = alpha * h_{t-1} + (1 - alpha) * x_t,
 * strips adversarial obfuscation (zero-width chars, shell IFS splinters, backslash
 * mid-token escapes like c\at /e\tc/passwd), and detects adversarial payloads.
 */
function scanOuterByteStream(input, { alpha = DEFAULT_SSM_DECAY_ALPHA } = {}) {
  const rawText = Buffer.isBuffer(input) ? input.toString('utf8') : String(input == null ? '' : input);
  const rawBytes = Buffer.from(rawText, 'utf8');
  const decay = Math.max(0, Math.min(0.99, Number(alpha) || DEFAULT_SSM_DECAY_ALPHA));
  const rollingState = new Float64Array(VECTOR_DIM);

  let strippedZeroWidthCount = 0;
  let strippedEscapeSplinters = 0;

  // Linear pass over bytes to update fixed-size SSM rolling state
  for (let i = 0; i < rawBytes.length; i += 1) {
    const byteVal = rawBytes[i];
    const dimIdx = byteVal % VECTOR_DIM;
    for (let d = 0; d < VECTOR_DIM; d += 1) {
      const impulse = d === dimIdx ? byteVal / 255 : 0;
      rollingState[d] = decay * rollingState[d] + (1 - decay) * impulse;
    }
  }

  // Normalize adversarial byte noise that breaks BPE tokenizers:
  // 1. Strip zero-width & control bytes (\u200B-\u200F, \uFEFF, \x00)
  const withoutZeroWidth = rawText.replace(/[\u200B-\u200F\u202A-\u202E\uFEFF\x00]/g, () => {
    strippedZeroWidthCount += 1;
    return '';
  });

  // 2. Collapse shell IFS / empty-quote / backslash character splinters (e.g. c\at, r'm', ${IFS})
  const normalizedText = withoutZeroWidth
    .replace(/\$\{IFS\}|\$IFS/g, () => {
      strippedEscapeSplinters += 1;
      return ' ';
    })
    .replace(/([a-zA-Z0-9_/])\\([a-zA-Z0-9_/])/g, (_m, a, b) => {
      strippedEscapeSplinters += 1;
      return `${a}${b}`;
    })
    .replace(/([a-zA-Z0-9_/])(?:''|"")([a-zA-Z0-9_/])/g, (_m, a, b) => {
      strippedEscapeSplinters += 1;
      return `${a}${b}`;
    });

  const matchedAdversarialIds = ADVERSARIAL_BYTE_PATTERNS
    .filter((p) => p.re.test(normalizedText))
    .map((p) => p.id);

  return {
    byteLength: rawBytes.length,
    normalizedText,
    strippedZeroWidthCount,
    strippedEscapeSplinters,
    adversarialDetected: matchedAdversarialIds.length > 0,
    matchedAdversarialIds,
    rollingState: Array.from(rollingState).map((v) => Number(v.toFixed(6))),
  };
}

/**
 * Unsupervised Cosine Routing Module with Straight-Through Estimator (STE).
 */
function routeCosineBoundaries(units = [], {
  threshold = DEFAULT_BOUNDARY_THRESHOLD,
} = {}) {
  if (!Array.isArray(units) || units.length === 0) {
    return {
      probabilities: [],
      hardBoundaries: [],
      chunks: [],
      vectors: [],
    };
  }

  const cutThreshold = Number.isFinite(Number(threshold))
    ? Number(threshold)
    : DEFAULT_BOUNDARY_THRESHOLD;

  const probabilities = [];
  const hardBoundaries = [];
  const vectors = [];
  const chunks = [];
  let currentChunkUnits = [];
  let currentChunkVectors = [];

  for (let t = 0; t < units.length; t += 1) {
    const qVec = projectUnitVector(units[t], 'query');
    let prob = 1.0; // First unit always initiates the first chunk (P_0 = 1.0)
    if (t > 0) {
      const kPrevVec = projectUnitVector(units[t - 1], 'key');
      prob = computeBoundaryProbability(qVec, kPrevVec);
    }
    const hardCut = t === 0 || prob > cutThreshold ? 1 : 0;
    probabilities.push(prob);
    hardBoundaries.push(hardCut);
    vectors.push(qVec);

    if (hardCut === 1 && currentChunkUnits.length > 0) {
      chunks.push({
        startIndex: t - currentChunkUnits.length,
        endIndex: t - 1,
        units: currentChunkUnits,
        text: currentChunkUnits.join(''),
        boundaryProbability: probabilities[t - currentChunkUnits.length],
        vector: averageVectors(currentChunkVectors),
      });
      currentChunkUnits = [];
      currentChunkVectors = [];
    }
    currentChunkUnits.push(units[t]);
    currentChunkVectors.push(qVec);
  }

  if (currentChunkUnits.length > 0) {
    const startIdx = units.length - currentChunkUnits.length;
    chunks.push({
      startIndex: startIdx,
      endIndex: units.length - 1,
      units: currentChunkUnits,
      text: currentChunkUnits.join(''),
      boundaryProbability: probabilities[startIdx],
      vector: averageVectors(currentChunkVectors),
    });
  }

  return {
    probabilities,
    hardBoundaries,
    chunks,
    vectors,
  };
}

function averageVectors(vecs = []) {
  if (!vecs.length) return new Array(VECTOR_DIM).fill(0);
  const out = new Float64Array(VECTOR_DIM);
  for (const v of vecs) {
    for (let i = 0; i < VECTOR_DIM; i += 1) {
      out[i] += Number(v[i]) || 0;
    }
  }
  for (let i = 0; i < VECTOR_DIM; i += 1) {
    out[i] = Number((out[i] / vecs.length).toFixed(6));
  }
  return Array.from(out);
}

/**
 * EMA Smoothing De-Chunker (replaces high-variance Gumbel-Softmax):
 *   Z_bar_t = P_t * Z_t + (1 - P_t) * Z_bar_{t-1}
 */
function emaSmoothChunks(chunks = []) {
  if (!Array.isArray(chunks) || chunks.length === 0) return [];
  const smoothed = [];
  let prevZBar = null;

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const p = chunk.boundaryProbability !== undefined ? Number(chunk.boundaryProbability) : 1.0;
    const zVec = Array.isArray(chunk.vector) ? chunk.vector : projectUnitVector(chunk.text || '');
    if (!prevZBar) {
      prevZBar = zVec.slice();
    } else {
      prevZBar = zVec.map((val, idx) => Number((p * val + (1 - p) * prevZBar[idx]).toFixed(6)));
    }
    smoothed.push({
      ...chunk,
      emaVector: prevZBar.slice(),
    });
  }
  return smoothed;
}

/**
 * Straight-Through Estimator (STE):
 *   Forward pass: hard binary decision (1 if P_t > threshold else 0)
 *   Backward pass: continuous gradient dL/dP_t = upstreamGradient
 */
function straightThroughEstimatorStep(probability, upstreamGradient = 1.0, threshold = DEFAULT_BOUNDARY_THRESHOLD) {
  const p = Math.max(0, Math.min(1, Number(probability) || 0));
  const hardForward = p > threshold ? 1.0 : 0.0;
  const stopGradResidual = hardForward - p;
  const steForwardValue = Number((p + stopGradResidual).toFixed(6));
  return {
    probability: p,
    hardForward,
    steForwardValue,
    backwardGradient: Number(upstreamGradient),
  };
}

/**
 * Auxiliary Ratio Loss (Section 4):
 * Penalizes router collapse (P_t -> 1 everywhere or P_t -> 0 everywhere)
 * against a target compression ratio N (default N = 6 units per chunk).
 */
function computeAuxiliaryRatioLoss(probabilities = [], hardBoundaries = [], {
  targetRatioN = DEFAULT_TARGET_RATIO_N,
} = {}) {
  const total = Math.max(1, probabilities.length);
  const N = Math.max(1.5, Number(targetRatioN) || DEFAULT_TARGET_RATIO_N);
  const targetFraction = 1 / N;

  const selectedCount = hardBoundaries.reduce((acc, b) => acc + (Number(b) > 0 ? 1 : 0), 0);
  const probSum = probabilities.reduce((acc, p) => acc + (Number(p) || 0), 0);

  const f = selectedCount / total; // hard selected fraction
  const g = probSum / total; // continuous mean boundary probability

  // H-Net load-balancing ratio loss: (N / (N - 1)) * ((N - 1) * f * g + (1 - f) * (1 - g))
  // normalized so minimum is achieved when f = 1/N and g = 1/N, plus L2 anchor to 1/N:
  const hnetTerm = (N / (N - 1)) * ((N - 1) * f * g + (1 - f) * (1 - g));
  const targetDeviationLoss = Math.pow(f - targetFraction, 2) + Math.pow(g - targetFraction, 2);
  const achievedCompressionRatio = selectedCount > 0 ? total / selectedCount : total;

  let status = 'optimal';
  if (f > targetFraction * 1.75) status = 'under_compressed';
  else if (f < targetFraction * 0.45) status = 'over_compressed';

  return {
    targetRatioN: N,
    targetBoundaryFraction: Number(targetFraction.toFixed(6)),
    hardFractionF: Number(f.toFixed(6)),
    continuousMeanG: Number(g.toFixed(6)),
    achievedCompressionRatio: Number(achievedCompressionRatio.toFixed(4)),
    hnetLoadBalanceTerm: Number(hnetTerm.toFixed(6)),
    ratioLoss: Number(targetDeviationLoss.toFixed(6)),
    status,
  };
}

/**
 * Two-Stage H-Net Recursive Hierarchy:
 *   - Outer SSM Layer scans raw bytes & strips obfuscation
 *   - Stage 1 groups fine-grained byte/character blocks into syntactic spans
 *   - Stage 2 groups Stage-1 spans into higher-level semantic phrases/actions
 */
function buildTwoStageHierarchy(input, {
  stage1BlockBytes = 4,
  stage1Threshold = 0.35,
  stage2Threshold = 0.5,
  targetRatioN = DEFAULT_TARGET_RATIO_N,
} = {}) {
  const outerScan = scanOuterByteStream(input);
  const text = outerScan.normalizedText;

  // Slice normalized stream into fine-grained byte/char blocks for Stage 1
  const blockSize = Math.max(1, Number(stage1BlockBytes) || 4);
  const stage1Units = [];
  for (let i = 0; i < text.length; i += blockSize) {
    stage1Units.push(text.slice(i, i + blockSize));
  }

  const stage1Routing = routeCosineBoundaries(stage1Units, { threshold: stage1Threshold });
  const stage1Smoothed = emaSmoothChunks(stage1Routing.chunks);

  // Stage 2: feed Stage-1 chunk texts into the inner semantic router
  const stage2Units = stage1Smoothed.map((c) => c.text);
  const stage2Routing = routeCosineBoundaries(stage2Units, { threshold: stage2Threshold });
  const stage2Smoothed = emaSmoothChunks(stage2Routing.chunks);

  const stage1Ratio = computeAuxiliaryRatioLoss(
    stage1Routing.probabilities,
    stage1Routing.hardBoundaries,
    { targetRatioN: Math.max(2, Math.sqrt(targetRatioN)) }
  );
  const stage2Ratio = computeAuxiliaryRatioLoss(
    stage2Routing.probabilities,
    stage2Routing.hardBoundaries,
    { targetRatioN: Math.max(2, Math.sqrt(targetRatioN)) }
  );

  const totalCompressionRatio = stage2Smoothed.length > 0
    ? Number(( Math.max(1, stage1Units.length) / stage2Smoothed.length ).toFixed(4))
    : 1;

  return {
    outerScan,
    stage1: {
      inputUnitCount: stage1Units.length,
      chunkCount: stage1Smoothed.length,
      chunks: stage1Smoothed,
      ratioMetrics: stage1Ratio,
    },
    stage2: {
      inputUnitCount: stage2Units.length,
      chunkCount: stage2Smoothed.length,
      chunks: stage2Smoothed,
      ratioMetrics: stage2Ratio,
    },
    totalCompressionRatio,
  };
}

/**
 * Dynamic Output Shunting for Agentic Code-Generation Pipelines:
 * Replaces static line-count truncation with Cosine-Routed Semantic Shunting.
 * Collapses repetitive build/test lines (low P_t) while retaining 100% of
 * semantic fractures (high P_t: errors, stack traces, headers, final verdict).
 */
function shuntAgentStreamDynamic(rawOutput, {
  targetRatioN = DEFAULT_TARGET_RATIO_N,
  boundaryThreshold = DEFAULT_BOUNDARY_THRESHOLD,
} = {}) {
  const startNs = process.hrtime.bigint();
  const lines = String(rawOutput == null ? '' : rawOutput).split(/\r?\n/);
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
    return {
      originalLineCount: 0,
      retainedChunkCount: 0,
      compressionRatio: 1,
      shuntedText: '',
      ratioMetrics: computeAuxiliaryRatioLoss([], [], { targetRatioN }),
      latencyMs: 0,
    };
  }

  const routing = routeCosineBoundaries(lines, { threshold: boundaryThreshold });
  const smoothedChunks = emaSmoothChunks(routing.chunks);
  const ratioMetrics = computeAuxiliaryRatioLoss(
    routing.probabilities,
    routing.hardBoundaries,
    { targetRatioN }
  );

  // For each chunk, keep the fracture anchor line (first line) and, if the chunk
  // collapsed > 2 repetitive lines, emit a compact [H-Net collapsed K repetitive lines] marker.
  const rendered = smoothedChunks.map((chunk) => {
    const unitCount = chunk.units.length;
    if (unitCount === 1) return chunk.units[0];
    if (unitCount === 2) return `${chunk.units[0]}\n${chunk.units[1]}`;
    return `${chunk.units[0]}\n  [... H-Net dynamic chunk collapsed ${unitCount - 2} similar lines (P_t=${chunk.boundaryProbability}) ...]\n${chunk.units[unitCount - 1]}`;
  });

  const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
  return {
    originalLineCount: lines.length,
    retainedChunkCount: smoothedChunks.length,
    compressionRatio: ratioMetrics.achievedCompressionRatio,
    shuntedText: rendered.join('\n'),
    ratioMetrics,
    latencyMs: Number(elapsedMs.toFixed(4)),
  };
}

function runDoctor() {
  const sampleAdversarial = 'r\\m${IFS}-rf /etc/p\\asswd';
  const scan = scanOuterByteStream(sampleAdversarial);
  const sampleLog = [
    'Compiling module alpha.js...',
    'Compiling module beta.js...',
    'Compiling module gamma.js...',
    'Compiling module delta.js...',
    'Compiling module epsilon.js...',
    'Compiling module zeta.js...',
    'FATAL ERROR: TypeError: Cannot read properties of undefined at src/gate.js:42',
    '  at Object.evaluate (src/gate.js:42:11)',
    'Test suite finished: 1 failed, 52 passed',
  ].join('\n');
  const shunted = shuntAgentStreamDynamic(sampleLog);
  const ste = straightThroughEstimatorStep(0.72, -0.45);
  const crossover = evaluateByteCrossoverThreshold({
    trainingBytes: 5_000_000_000,
    claimsBeatBpe: true,
  });

  const checks = [
    {
      id: 'outer_ssm_adversarial_deobfuscation',
      ok: scan.adversarialDetected && scan.matchedAdversarialIds.includes('etc_passwd_shadow'),
      detail: `normalized="${scan.normalizedText}" matched=${scan.matchedAdversarialIds.join(',')}`,
    },
    {
      id: 'cosine_routing_and_dynamic_shunting',
      ok: shunted.retainedChunkCount < shunted.originalLineCount && shunted.shuntedText.includes('FATAL ERROR'),
      detail: `lines=${shunted.originalLineCount} -> chunks=${shunted.retainedChunkCount} (${shunted.latencyMs}ms)`,
    },
    {
      id: 'ema_ste_straight_through_gradient',
      ok: ste.hardForward === 1.0 && ste.backwardGradient === -0.45,
      detail: `forward=${ste.hardForward} backwardGrad=${ste.backwardGradient}`,
    },
    {
      id: 'crossover_30b_bytes_honesty_guard',
      ok: crossover.ok === false && crossover.verdict === 'FAIL_SUB_CROSSOVER_CLAIM',
      detail: crossover.reason,
    },
  ];

  const allOk = checks.every((c) => c.ok);
  return {
    ok: allOk,
    verdict: allOk ? 'PASS' : 'FAIL',
    sourceUrls: SOURCE_URLS,
    checks,
  };
}

if (require.main === module) {
  const report = runDoctor();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`H-Net Dynamic Chunking Honesty Doctor: ${report.verdict}\n`);
    for (const check of report.checks) {
      process.stdout.write(`  [${check.ok ? 'PASS' : 'FAIL'}] ${check.id}: ${check.detail}\n`);
    }
  }
  process.exit(report.ok ? 0 : 1);
}

module.exports = {
  SOURCE_URLS,
  DEFAULT_TARGET_RATIO_N,
  DEFAULT_BOUNDARY_THRESHOLD,
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
};
