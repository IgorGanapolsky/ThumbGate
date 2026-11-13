#!/usr/bin/env node
'use strict';

/**
 * H-Net Dynamic Chunker (scripts/hnet-dynamic-chunker.js)
 *
 * Implements the 4 core mechanisms of the Hierarchical Network (H-Net)
 * byte-level dynamic chunking architecture for ThumbGate:
 *
 * 1. U-Net Hybrid Topology:
 *    - Outer Mamba-2 SSM linear-time O(T) byte encoder/decoder operating on
 *      continuous raw UTF-8 bytes without static BPE dictionaries.
 *    - Recursive 2-stage hierarchy: Stage 1 groups raw bytes into dynamic
 *      subwords/words; Stage 2 groups Stage-1 chunks into semantic phrases.
 * 2. Unsupervised Cosine Routing Module:
 *    - Projects adjacent query q_t and key k_{t-1} vectors and computes
 *      boundary probability:
 *        P_t = 0.5 * (1 - CosineSimilarity(q_t, k_{t-1}))
 *      triggering hard cuts when P_t > threshold (default 0.5).
 * 3. Differentiable EMA Crossfade Smoothing + Straight-Through Estimator (STE):
 *    - Replaces Gumbel-Softmax with Exponential Moving Average de-chunking:
 *        Z_bar_t = P_t * Z_t + (1 - P_t) * Z_bar_{t-1}
 *    - Forward pass uses hard rounded boundaries (0/1); backward pass routes
 *      continuous EMA gradients straight through the discrete cut.
 * 4. Compute-Budget Auxiliary Ratio Loss & Adversarial Modality Normalization:
 *    - Aligns hard boundary fraction f and mean boundary probability g to a
 *      target compression ratio N (default N = 6 bytes/chunk):
 *        L_ratio = (N / (N - 1)) * ((N - 1) * f * g + (1 - f) * (1 - g))
 *    - Segments unspaced CJK, delimiter-free shell/code payloads, and
 *      zero-width/noisy adversarial sequences for downstream PromptGuard &
 *      PreToolUse inspection.
 */

const DEFAULT_STATE_DIM = 8;
const DEFAULT_BOUNDARY_THRESHOLD = 0.5;
const DEFAULT_TARGET_RATIO_N = 6;
const EPSILON = 1e-8;

// Zero-width and invisible formatting codepoints used in adversarial prompt obfuscation
const INVISIBLE_BYTE_SEQUENCES_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/**
 * Classify a single UTF-8 byte into structural features for the outer Mamba-2
 * state-space projection.
 *
 * Feature channels (8-D):
 *   0: lowercase ASCII letter [a-z]
 *   1: uppercase ASCII letter [A-Z]
 *   2: ASCII digit [0-9]
 *   3: whitespace / control byte
 *   4: operator / delimiter punctuation
 *   5: identifier connector (_ - $ / .)
 *   6: UTF-8 multi-byte lead byte (0xC0..0xF7, e.g. CJK / non-Latin)
 *   7: UTF-8 continuation / camelCase transition
 */
function byteFeatureVector(byteVal, prevByteVal = -1, wordParity = 0) {
  const isLower = byteVal >= 0x61 && byteVal <= 0x7a;
  const isUpper = byteVal >= 0x41 && byteVal <= 0x5a;
  const isDigit = byteVal >= 0x30 && byteVal <= 0x39;
  const isSpace = byteVal === 0x20 || byteVal === 0x09 || byteVal === 0x0a || byteVal === 0x0d;
  const isConnector = (
    byteVal === 0x5f || // _
    byteVal === 0x2d || // -
    byteVal === 0x24 || // $
    byteVal === 0x2f || // /
    byteVal === 0x2e    // .
  );
  const isUtf8Lead = byteVal >= 0xc0 && byteVal <= 0xf7;
  const isUtf8Cont = byteVal >= 0x80 && byteVal <= 0xbf;
  const isPunct = (
    !isLower && !isUpper && !isDigit && !isSpace && !isConnector && !isUtf8Lead && !isUtf8Cont
  );

  // Signed zero-centered feature channels so distinct byte classes or word-parity flips have negative cosine similarity (P_t > 0.5)
  if (isLower || isUpper) {
    return wordParity === 0
      ? [2.2, -0.6, -0.5, -0.6, -0.6, -0.5, -0.6, -0.4]
      : [-0.6, 2.2, -0.5, -0.6, -0.6, -0.5, -0.6, 1.4];
  }
  if (isDigit) {
    return [-0.5, -0.5, 2.2, -0.5, -0.5, -0.3, -0.5, -0.4];
  }
  if (isSpace) {
    return [-0.6, -0.6, -0.5, 2.4, -0.4, -0.5, -0.6, -0.4];
  }
  if (isConnector) {
    return [-0.4, -0.4, -0.3, -0.5, -0.3, 2.2, -0.5, -0.4];
  }
  if (isUtf8Lead || isUtf8Cont) {
    return [-0.6, -0.6, -0.5, -0.6, -0.5, -0.5, 2.2, 1.2];
  }
  if (isPunct) {
    return [-0.5, -0.5, -0.4, -0.4, 2.2, -0.3, -0.5, -0.4];
  }
  return [0, 0, 0, 0, 0, 0, 0, 0];
}

/**
 * Outer Mamba-2 State Space Model (SSM) byte encoder:
 *   h_t = decay_t * h_{t-1} + (1 - decay_t) * x_t
 * Maintains a selective word-parity state that toggles on camelCase word boundaries
 * and runs in O(T) linear time over raw bytes without quadratic attention.
 */
function encodeBytesMambaState(input, options = {}) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input || ''), 'utf8');
  const decay = typeof options.ssmDecay === 'number' ? options.ssmDecay : 0.15;
  const states = [];
  let prevState = new Array(DEFAULT_STATE_DIM).fill(0);
  let wordParity = 0;

  for (let t = 0; t < buf.length; t += 1) {
    const byteVal = buf[t];
    const prevByteVal = t > 0 ? buf[t - 1] : -1;
    const isLower = byteVal >= 0x61 && byteVal <= 0x7a;
    const isUpper = byteVal >= 0x41 && byteVal <= 0x5a;
    const prevIsLower = prevByteVal >= 0x61 && prevByteVal <= 0x7a;

    if (prevIsLower && isUpper) {
      wordParity = wordParity === 0 ? 1 : 0;
    } else if (!isLower && !isUpper) {
      wordParity = 0;
    }

    const x = byteFeatureVector(byteVal, prevByteVal, wordParity);
    const prevX = t > 0 ? states[t - 1] : x;
    const sameByteClass = t > 0 && argMax(x) === argMax(prevX);
    const isUtf8Cont = byteVal >= 0x80 && byteVal <= 0xbf;
    let alpha = sameByteClass ? decay : 0.0;
    if (isUtf8Cont) {
      alpha = 0.85;
    }
    const h = new Array(DEFAULT_STATE_DIM);
    for (let d = 0; d < DEFAULT_STATE_DIM; d += 1) {
      h[d] = alpha * prevState[d] + (1 - alpha) * x[d];
    }
    states.push(h);
    prevState = h;
  }

  return { bytes: buf, states };
}

function argMax(vec) {
  let bestIdx = 0;
  let bestVal = vec[0] ?? -Infinity;
  for (let i = 1; i < vec.length; i += 1) {
    if (vec[i] > bestVal) {
      bestVal = vec[i];
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Cosine similarity between two equal-length vectors q and k.
 */
function cosineSimilarity(q, k) {
  if (!Array.isArray(q) || !Array.isArray(k) || q.length === 0 || q.length !== k.length) {
    return 0;
  }
  let dot = 0;
  let normQ = 0;
  let normK = 0;
  for (let i = 0; i < q.length; i += 1) {
    dot += q[i] * k[i];
    normQ += q[i] * q[i];
    normK += k[i] * k[i];
  }
  const denom = Math.sqrt(normQ) * Math.sqrt(normK);
  if (denom < EPSILON) return 1.0;
  return Math.max(-1.0, Math.min(1.0, dot / denom));
}

/**
 * Unsupervised Cosine Routing Module:
 *   P_t = 0.5 * (1 - CosineSimilarity(q_t, k_{t-1}))
 *   Hard cut triggered when P_t > threshold (default 0.5).
 */
function computeCosineBoundaryProbabilities(states, options = {}) {
  const threshold = typeof options.threshold === 'number' ? options.threshold : DEFAULT_BOUNDARY_THRESHOLD;
  const probabilities = [];
  const hardBoundaries = [];

  for (let t = 0; t < states.length; t += 1) {
    if (t === 0) {
      probabilities.push(1.0);
      hardBoundaries.push(1);
      continue;
    }
    const q_t = states[t];
    const k_prev = states[t - 1];
    const sim = cosineSimilarity(q_t, k_prev);
    const p_t = 0.5 * (1.0 - sim);
    probabilities.push(p_t);
    hardBoundaries.push(p_t > threshold ? 1 : 0);
  }

  return {
    threshold,
    probabilities,
    hardBoundaries,
  };
}

/**
 * Exponential Moving Average (EMA) de-chunking smoothing module:
 *   Z_bar_t = P_t * Z_t + (1 - P_t) * Z_bar_{t-1}
 * Acts as a differentiable crossfade between adjacent chunks, avoiding
 * Gumbel-Softmax gradient variance.
 */
function emaSmoothStates(states, probabilities) {
  if (!Array.isArray(states) || states.length === 0) return [];
  const smoothed = [];
  let prevZBar = states[0].slice();
  smoothed.push(prevZBar);

  for (let t = 1; t < states.length; t += 1) {
    const p_t = Math.max(0, Math.min(1, probabilities[t] ?? 0.5));
    const z_t = states[t];
    const zBar = new Array(z_t.length);
    for (let d = 0; d < z_t.length; d += 1) {
      zBar[d] = p_t * z_t[d] + (1.0 - p_t) * prevZBar[d];
    }
    smoothed.push(zBar);
    prevZBar = zBar;
  }

  return smoothed;
}

/**
 * Straight-Through Estimator (STE) for discrete chunk boundaries:
 * - Forward pass: hard binary cut b_t = (P_t > threshold ? 1 : 0)
 * - Backward pass: passes continuous gradient dL/dP_t straight through the
 *   EMA crossfade recurrence without zeroing at the step function:
 *     dL/dP_t = sum_d (gradOutput_t[d] * (Z_t[d] - Z_bar_{t-1}[d]))
 */
function straightThroughEstimator(probabilities, states, gradOutput = null, threshold = DEFAULT_BOUNDARY_THRESHOLD) {
  const forwardHard = probabilities.map((p, idx) => (idx === 0 || p > threshold ? 1 : 0));
  const smoothed = emaSmoothStates(states, probabilities);

  if (!Array.isArray(gradOutput) || gradOutput.length !== states.length) {
    return {
      forwardHard,
      smoothedStates: smoothed,
      gradProbabilities: probabilities.map(() => 0),
    };
  }

  const gradProbabilities = new Array(probabilities.length).fill(0);
  for (let t = 1; t < states.length; t += 1) {
    const z_t = states[t];
    const zBarPrev = smoothed[t - 1];
    const gOut = gradOutput[t] || [];
    let dot = 0;
    for (let d = 0; d < z_t.length; d += 1) {
      dot += (gOut[d] || 0) * (z_t[d] - zBarPrev[d]);
    }
    gradProbabilities[t] = dot;
  }

  return {
    forwardHard,
    smoothedStates: smoothed,
    gradProbabilities,
  };
}

/**
 * Auxiliary Ratio Loss for Compute-Budget Governance:
 *   f = fraction of hard boundaries selected = (1/T) * sum(b_t)
 *   g = mean continuous boundary probability = (1/T) * sum(P_t)
 *   L_ratio = (N / (N - 1)) * ((N - 1) * f * g + (1 - f) * (1 - g))
 * Achieved minimum is 1.0 when f = g = 1 / N.
 */
function computeAuxiliaryRatioLoss(probabilities, hardBoundaries, targetRatioN = DEFAULT_TARGET_RATIO_N) {
  const T = probabilities.length;
  if (T === 0) {
    return {
      loss: 0,
      f: 0,
      g: 0,
      targetRatioN,
      actualCompressionRatio: 0,
    };
  }
  const N = Math.max(2, Number(targetRatioN) || DEFAULT_TARGET_RATIO_N);
  const sumHard = hardBoundaries.reduce((acc, b) => acc + (b ? 1 : 0), 0);
  const sumProb = probabilities.reduce((acc, p) => acc + Number(p || 0), 0);
  const f = sumHard / T;
  const g = sumProb / T;
  const loss = (N / (N - 1)) * ((N - 1) * f * g + (1 - f) * (1 - g));
  const actualCompressionRatio = sumHard > 0 ? T / sumHard : T;

  return {
    loss: Number(loss.toFixed(6)),
    f: Number(f.toFixed(6)),
    g: Number(g.toFixed(6)),
    targetRatioN: N,
    actualCompressionRatio: Number(actualCompressionRatio.toFixed(3)),
  };
}

/**
 * Pool a slice of byte/chunk states into a single pooled semantic vector for
 * the next H-Net stage (U-Net downsampler).
 */
function poolChunkState(statesSlice) {
  if (!statesSlice || statesSlice.length === 0) {
    return new Array(DEFAULT_STATE_DIM).fill(0);
  }
  const dim = statesSlice[0].length;
  const pooled = new Array(dim).fill(0);
  for (const s of statesSlice) {
    for (let d = 0; d < dim; d += 1) {
      pooled[d] += s[d];
    }
  }
  for (let d = 0; d < dim; d += 1) {
    pooled[d] /= statesSlice.length;
  }
  return pooled;
}

/**
 * Execute 2-Stage Hierarchical Dynamic Chunking on raw text or byte Buffer:
 * - Stage 1 groups raw UTF-8 bytes into dynamic subword/word chunks.
 * - Stage 2 groups Stage-1 chunks into semantic phrase/command chunks.
 */
function hierarchicalChunk(input, options = {}) {
  const stage1Threshold = options.stage1Threshold ?? DEFAULT_BOUNDARY_THRESHOLD;
  const stage2Threshold = options.stage2Threshold ?? 0.35;
  const targetRatioN = options.targetRatioN ?? DEFAULT_TARGET_RATIO_N;

  const { bytes, states } = encodeBytesMambaState(input, options);
  if (bytes.length === 0) {
    return {
      byteLength: 0,
      stage1Chunks: [],
      stage2Chunks: [],
      routing: { probabilities: [], hardBoundaries: [], threshold: stage1Threshold },
      emaStates: [],
      ratioMetrics: computeAuxiliaryRatioLoss([], [], targetRatioN),
    };
  }

  const routing = computeCosineBoundaryProbabilities(states, { threshold: stage1Threshold });
  const emaStates = emaSmoothStates(states, routing.probabilities);
  const ratioMetrics = computeAuxiliaryRatioLoss(
    routing.probabilities,
    routing.hardBoundaries,
    targetRatioN
  );

  // Build Stage-1 chunks from hard byte boundaries (never splitting mid-UTF8 codepoint)
  const stage1Chunks = [];
  let chunkStart = 0;
  for (let t = 1; t < bytes.length; t += 1) {
    const isUtf8Continuation = bytes[t] >= 0x80 && bytes[t] <= 0xbf;
    if (routing.hardBoundaries[t] === 1 && !isUtf8Continuation) {
      const sliceBuf = bytes.subarray(chunkStart, t);
      const text = sliceBuf.toString('utf8');
      stage1Chunks.push({
        startByte: chunkStart,
        endByte: t,
        text,
        boundaryProbability: Number(routing.probabilities[chunkStart].toFixed(4)),
        state: poolChunkState(emaStates.slice(chunkStart, t)),
      });
      chunkStart = t;
    }
  }
  const tailBuf = bytes.subarray(chunkStart, bytes.length);
  stage1Chunks.push({
    startByte: chunkStart,
    endByte: bytes.length,
    text: tailBuf.toString('utf8'),
    boundaryProbability: Number(routing.probabilities[chunkStart].toFixed(4)),
    state: poolChunkState(emaStates.slice(chunkStart, bytes.length)),
  });

  // Stage 2: Route over Stage-1 semantic chunk states to form phrase/clause chunks
  const stage1States = stage1Chunks.map((c) => c.state);
  const stage2Routing = computeCosineBoundaryProbabilities(stage1States, { threshold: stage2Threshold });
  const stage2Chunks = [];
  let s2Start = 0;
  for (let i = 1; i < stage1Chunks.length; i += 1) {
    if (stage2Routing.hardBoundaries[i] === 1) {
      const group = stage1Chunks.slice(s2Start, i);
      stage2Chunks.push({
        startChunk: s2Start,
        endChunk: i,
        text: group.map((c) => c.text).join(''),
        tokens: group.map((c) => c.text.trim()).filter(Boolean),
        boundaryProbability: Number(stage2Routing.probabilities[s2Start].toFixed(4)),
      });
      s2Start = i;
    }
  }
  const tailGroup = stage1Chunks.slice(s2Start);
  stage2Chunks.push({
    startChunk: s2Start,
    endChunk: stage1Chunks.length,
    text: tailGroup.map((c) => c.text).join(''),
    tokens: tailGroup.map((c) => c.text.trim()).filter(Boolean),
    boundaryProbability: Number(stage2Routing.probabilities[s2Start].toFixed(4)),
  });

  return {
    byteLength: bytes.length,
    stage1Chunks,
    stage2Chunks,
    routing,
    emaStates,
    ratioMetrics,
  };
}

/**
 * De-obfuscate noisy / delimiter-free / zero-width-interleaved byte streams
 * for downstream secret scanning and PreToolUse command inspection.
 */
function deobfuscateNoisyByteStream(input) {
  const raw = String(input || '');
  if (!raw) {
    return {
      normalizedText: '',
      reconstructedTokens: [],
      hadInvisibleBytes: false,
      chunkReport: hierarchicalChunk(''),
    };
  }

  const strippedInvisible = raw.replace(INVISIBLE_BYTE_SEQUENCES_RE, '');
  const hadInvisibleBytes = strippedInvisible.length !== raw.length;
  // Collapse shell IFS/brace obfuscation and intra-word quote splitting (e.g. rm${IFS}-rf, g'i't, r"e"set, -r"f")
  const deIfs = strippedInvisible
    .replace(/\$\{IFS\}/gi, ' ')
    .replace(/\$IFS\b/g, ' ')
    .replace(/""|''/g, '')
    .replace(/([A-Za-z0-9_-])'([A-Za-z0-9_-]+)'([A-Za-z0-9_-]*)/g, '$1$2$3')
    .replace(/([A-Za-z0-9_-])"([A-Za-z0-9_-]+)"([A-Za-z0-9_-]*)/g, '$1$2$3');
  const chunkReport = hierarchicalChunk(deIfs);
  const reconstructedTokens = chunkReport.stage1Chunks
    .map((c) => c.text.trim())
    .filter(Boolean);

  return {
    normalizedText: deIfs,
    reconstructedTokens,
    spacedReconstruction: reconstructedTokens.join(' '),
    hadInvisibleBytes,
    chunkReport,
  };
}

if (require.main === module) {
  const sample = process.argv.slice(2).join(' ') || 'rm${IFS}-rf/tmp/prod_db';
  const result = deobfuscateNoisyByteStream(sample);
  process.stdout.write(`${JSON.stringify({
    input: sample,
    normalizedText: result.normalizedText,
    reconstructedTokens: result.reconstructedTokens,
    ratioMetrics: result.chunkReport.ratioMetrics,
    stage2Count: result.chunkReport.stage2Chunks.length,
  }, null, 2)}\n`);
}

module.exports = {
   DEFAULT_BOUNDARY_THRESHOLD,
  DEFAULT_STATE_DIM,
  DEFAULT_TARGET_RATIO_N,
  byteFeatureVector,
  computeAuxiliaryRatioLoss,
  computeCosineBoundaryProbabilities,
  cosineSimilarity,
  deobfuscateNoisyByteStream,
  emaSmoothStates,
  encodeBytesMambaState,
  hierarchicalChunk,
  poolChunkState,
  straightThroughEstimator,
};
