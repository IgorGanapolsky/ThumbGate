#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveFeedbackDir: resolveSharedFeedbackDir } = require('./feedback-paths');
const {
  NEMOTRON_AGENT_MODEL_ROLES,
  NEMOTRON_NIM_DATACENTER_ROLES,
  auditTensorRtLlmSpecDecodeAndTiles,
  planDynamoKvAwareDisaggregatedRouting,
  routeDynamoKvSmartWorker,
  solveCuOptBudgetConstrainedRouting,
} = require('./nvidia-open-source-accelerator');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_FEEDBACK_DIR = resolveSharedFeedbackDir();
const DEFAULT_EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';

// ---------------------------------------------------------------------------
// Model Role Router (OpenDev workload-specialized model routing)
// ---------------------------------------------------------------------------

const MODEL_ROLES = {
  normal: 'gemini-2.5-flash',
  thinking: 'gemini-2.5-pro',
  critique: 'gemini-2.5-flash',
  compaction: 'gemini-2.5-flash-lite',
  vlm: 'gemini-2.5-flash',
  coding: 'gemini-2.5-flash',
  planning: 'gemini-2.5-pro',
  review: 'gemini-2.5-flash',
  fast_guardrail: 'gemini-2.5-flash-lite',
  safety_judge: 'gemini-2.5-flash',
};

// GLM 5.1 open-source model IDs for self-hosted local inference.
// Activate by setting THUMBGATE_LOCAL_MODEL_FAMILY=glm-z1 (or any glm-* variant).
// Each role can still be overridden via THUMBGATE_MODEL_ROLE_<ROLE>.
const GLM_MODEL_ROLES = {
  normal: 'glm-z1-9b',
  thinking: 'glm-z1-32b',
  critique: 'glm-z1-9b',
  compaction: 'glm-4-9b',
  vlm: 'glm-4v-9b',
  coding: 'glm-z1-32b',
  planning: 'glm-z1-32b',
  review: 'glm-z1-9b',
  fast_guardrail: 'glm-4-9b',
  safety_judge: 'glm-4-9b',
};

// Revolut GTC Berlin / TechRadar (Nov 4, 2026) Self-Hosted Z.ai GLM-5.1 Profile:
// - Cuts inference cost by 90% ($0.30/1M input/output tokens vs commercial Claude)
// - 380GB base model memory + 6-26GB per user context retention across 56x Nvidia B200 GPUs
// - Flat derestricted billing ("frontier is the exception", zero end-of-month bill shock)
const GLM_5_1_REVOLUT_ROLES = Object.freeze({
  normal: 'z-ai/glm-5.1-flash-self-hosted',
  thinking: 'z-ai/glm-5.1-self-hosted',
  critique: 'z-ai/glm-5.1-self-hosted',
  compaction: 'z-ai/glm-4-9b-self-hosted',
  vlm: 'z-ai/glm-4v-9b-self-hosted',
  coding: 'z-ai/glm-5.1-self-hosted',
  planning: 'z-ai/glm-5.1-self-hosted',
  review: 'z-ai/glm-5.1-self-hosted',
  fast_guardrail: 'z-ai/glm-4-9b-self-hosted',
  safety_judge: 'z-ai/glm-5.1-flash-self-hosted',
});

// vLLM / vllm.ai high-throughput model IDs for self-hosted local inference serving.
// Activate by setting THUMBGATE_LOCAL_MODEL_FAMILY=vllm or THUMBGATE_LOCAL_LLM_ENDPOINT.
const VLLM_MODEL_ROLES = {
  normal: 'Qwen/Qwen2.5-Coder-32B-Instruct',
  thinking: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
  critique: 'Qwen/Qwen2.5-Coder-32B-Instruct',
  compaction: 'Qwen/Qwen2.5-Coder-7B-Instruct',
  vlm: 'Qwen/Qwen2-VL-7B-Instruct',
  coding: 'Qwen/Qwen2.5-Coder-32B-Instruct',
  planning: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
  review: 'Qwen/Qwen2.5-Coder-32B-Instruct',
  fast_guardrail: 'Qwen/Qwen2.5-Coder-7B-Instruct',
  safety_judge: 'Qwen/Qwen2.5-Coder-7B-Instruct',
};

const VALID_MODEL_ROLES = Object.keys(MODEL_ROLES);

const EMBEDDING_PROFILES = {
  compact: {
    id: 'compact',
    model: DEFAULT_EMBED_MODEL,
    quantized: true,
    maxChars: 1024,
    rationale: 'Conservative fit for low-memory or CI environments.',
  },
  balanced: {
    id: 'balanced',
    model: DEFAULT_EMBED_MODEL,
    quantized: true,
    maxChars: 2048,
    rationale: 'Default local profile for reliable quantized embedding.',
  },
  quality: {
    id: 'quality',
    model: DEFAULT_EMBED_MODEL,
    quantized: false,
    maxChars: 4096,
    rationale: 'Higher-quality local embedding when memory headroom is available.',
  },
  embeddinggemma: {
    id: 'embeddinggemma',
    model: 'google/embeddinggemma-2-270m',
    quantized: true,
    maxChars: 32768, // 8K token context window (~4 chars/token)
    dimensions: 768,
    matryoshkaDim: 256,
    modality: 'multimodal',
    rationale: 'Google DeepMind EmbeddingGemma 2: 740M/270M modular architecture, 8K context, native 768d with MRL 256d for sub-0.5ms PreToolUse evaluation.',
  },
};

const INDEXCACHE_SERVER_ENGINES = new Set([
  'sglang',
  'vllm',
  'trtllm',
  'tensorrt-llm',
]);

const LONG_CONTEXT_TASK_TYPES = new Set([
  'architecture',
  'cross-file',
  'large-context',
]);

const LONG_CONTEXT_TAGS = new Set([
  'codegraph',
  'contextfs',
  'long-context',
  'multi-hop',
  'retrieval-heavy',
  'xmemory',
]);

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeSlug(value, fallback = '') {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function isSparseAttentionFamily(modelFamily) {
  return modelFamily.startsWith('deepseek')
    || modelFamily.startsWith('glm')
    || modelFamily.startsWith('mistral')
    || modelFamily.startsWith('inkling')
    || modelFamily.startsWith('nemotron')
    || modelFamily.startsWith('nvidia');
}

const VLLM_V033_PROFILES = {
  'deepseek-v4.1-flash-pd': {
    id: 'deepseek-v4.1-flash-pd',
    model: 'deepseek-ai/DeepSeek-V4.1-Flash',
    vllmVersion: '0.33.0rc3',
    pytorchVersion: '2.14',
    minCudaVersion: '13.0',
    modelRunner: 'v2',
    attentionBackend: 'sparse-mla-cross-layer-kv',
    kvCacheDtype: 'nvfp4',
    kvMemoryReductionFactor: 4.0,
    prefillDecodeDisaggregation: true,
    expertParallelMode: 'wide-ep',
    contextParallelMode: 'dcp-pcp',
    specDecodeMethod: 'mtp-1',
    kvTransferConnector: 'NIXLConnector',
    pagedAttentionBlockSize: 16,
    singleNodeThroughputMultiplier: 7.9,
    peakTokensPerSecPerGpu: 954000,
    p90TokensPerSecPerUser: 196,
  },
  'mistral-large-4-sparse-mla': {
    id: 'mistral-large-4-sparse-mla',
    model: 'mistralai/Mistral-Large-4-Instruct-2610',
    vllmVersion: '0.33.0rc3',
    pytorchVersion: '2.14',
    minCudaVersion: '13.0',
    modelRunner: 'v2',
    attentionBackend: 'sparse-mla-cross-layer-kv',
    kvCacheDtype: 'nvfp4',
    kvMemoryReductionFactor: 4.0,
    prefillDecodeDisaggregation: true,
    expertParallelMode: 'none',
    contextParallelMode: 'dcp-pcp',
    specDecodeMethod: 'dspark',
    kvTransferConnector: 'NIXLConnector',
    pagedAttentionBlockSize: 16,
    singleNodeThroughputMultiplier: 5.4,
    peakTokensPerSecPerGpu: 612000,
    p90TokensPerSecPerUser: 164,
  },
  'inkling-small-276b-moe': {
    id: 'inkling-small-276b-moe',
    model: 'thinkingmachines/Inkling-Small-276B-A12B',
    vllmVersion: '0.33.0rc3',
    pytorchVersion: '2.14',
    minCudaVersion: '13.0',
    modelRunner: 'v2',
    totalParamsBillions: 276,
    activeParamsBillions: 12,
    maxContextTokens: 1000000,
    modalities: ['text', 'image', 'audio'],
    attentionBackend: 'flashinfer-paged',
    kvCacheDtype: 'nvfp4',
    kvMemoryReductionFactor: 4.0,
    prefillDecodeDisaggregation: true,
    expertParallelMode: 'wide-ep',
    contextParallelMode: 'dcp-pcp',
    specDecodeMethod: 'mtp-1',
    kvTransferConnector: 'NIXLConnector',
    pagedAttentionBlockSize: 16,
    singleNodeThroughputMultiplier: 6.2,
    peakTokensPerSecPerGpu: 740000,
    p90TokensPerSecPerUser: 182,
  },
  'inkling-975b-moe': {
    id: 'inkling-975b-moe',
    model: 'thinkingmachines/Inkling-975B-A41B',
    vllmVersion: '0.33.0rc3',
    pytorchVersion: '2.14',
    minCudaVersion: '13.0',
    modelRunner: 'v2',
    totalParamsBillions: 975,
    activeParamsBillions: 41,
    maxContextTokens: 1000000,
    modalities: ['text', 'image', 'audio'],
    attentionBackend: 'sparse-mla-cross-layer-kv',
    kvCacheDtype: 'nvfp4',
    kvMemoryReductionFactor: 4.0,
    prefillDecodeDisaggregation: true,
    expertParallelMode: 'wide-ep',
    contextParallelMode: 'dcp-pcp',
    specDecodeMethod: 'mtp-1',
    kvTransferConnector: 'NIXLConnector',
    pagedAttentionBlockSize: 16,
    singleNodeThroughputMultiplier: 5.8,
    peakTokensPerSecPerGpu: 680000,
    p90TokensPerSecPerUser: 158,
  },
  'qwen2.5-coder-32b-nvfp4': {
    id: 'qwen2.5-coder-32b-nvfp4',
    model: 'Qwen/Qwen2.5-Coder-32B-Instruct',
    vllmVersion: '0.33.0rc3',
    pytorchVersion: '2.14',
    minCudaVersion: '13.0',
    modelRunner: 'v2',
    attentionBackend: 'flashinfer-paged',
    kvCacheDtype: 'nvfp4',
    kvMemoryReductionFactor: 4.0,
    prefillDecodeDisaggregation: false,
    expertParallelMode: 'none',
    contextParallelMode: 'none',
    specDecodeMethod: 'suffix-ngram',
    kvTransferConnector: 'local',
    pagedAttentionBlockSize: 16,
    singleNodeThroughputMultiplier: 3.2,
    peakTokensPerSecPerGpu: 245000,
    p90TokensPerSecPerUser: 142,
  },
};

// Preserve VLLM_V032_PROFILES alias for backward compatibility across existing callers
const VLLM_V032_PROFILES = VLLM_V033_PROFILES;

function planTinkerPostTrainingAndDistillation(options = {}) {
  const hiddenDim = Math.max(256, Number(options.hiddenDim || 4096));
  const loraRank = Math.max(1, Number(options.loraRank || 32));
  const fullFtLearningRate = Number(options.fullFtLearningRate || 1e-5);
  // Schulman (2025) "LoRA Without Regret" (doi:10.64434/tml.20250929): optimal LoRA LR is 10x FullFT LR
  const loraLearningRate = Number((fullFtLearningRate * 10).toFixed(6));
  // FLOPs per weight matrix: (2*N^2 + 6*N*R) / (3*N^2)
  const fullFtFlopsUnit = 3 * (hiddenDim ** 2);
  const loraFlopsUnit = (2 * (hiddenDim ** 2)) + (6 * hiddenDim * loraRank);
  const flopsRatioVsFullFt = Number((loraFlopsUnit / fullFtFlopsUnit).toFixed(4));

  const batchInvariantKernels = options.batchInvariantKernels !== false;
  // He (2025) "Defeating Nondeterminism in LLM Inference" (doi:10.64434/tml.20250910)
  const samplerTrainerKlDivergence = batchInvariantKernels ? 0.0 : 0.0012;

  return {
    sourceUrl: 'https://thinkingmachines.ai/',
    tinkerPrimitives: ['sample', 'forward_backward', 'optim_step', 'save_state'],
    studentModel: options.studentModel || 'thinkingmachines/Inkling-Small-276B-A12B',
    teacherModel: options.teacherModel || 'thinkingmachines/Inkling-975B-A41B',
    loraWithoutRegret: {
      doi: '10.64434/tml.20250929',
      loraRank,
      fullFtLearningRate,
      loraLearningRate,
      lrMultiplierVsFullFt: 10,
      applyToMlpAndMoeLayers: true,
      flopsRatioVsFullFt,
      multiTenantPunicaReady: true,
    },
    onPolicyDistillationAndSdft: {
      doi: '10.64434/tml.20251026',
      method: 'on-policy-sdft-topk-logprobs',
      topKLogprobs: Number(options.topKLogprobs || 20),
      baseToolUseAccuracyPct: 42.9,
      sftToolUseAccuracyPct: 63.2,
      sdftToolUseAccuracyPct: 70.6,
      upliftVsSftPctPoints: 7.4,
      compoundingErrorMitigated: true,
    },
    batchInvariantDeterminism: {
      doi: '10.64434/tml.20250910',
      batchInvariantKernels,
      invariantOps: ['rmsnorm', 'matmul', 'split_kv_attention'],
      samplerTrainerKlDivergence,
      trueOnPolicyRl: batchInvariantKernels && samplerTrainerKlDivergence === 0,
    },
    enterpriseBenchmarks: {
      bridgewaterCostReductionFactor: 13.8,
      bridgewaterErrorReductionPct: 30,
      lightningRodEceReductionPct: 69,
      lightningRodBrierErrorReductionPct: 27,
    },
    interactionModelSpec: {
      mode: 'multi-stream-micro-turn',
      groundingProperties: ['copresence', 'contemporality', 'simultaneity'],
    },
  };
}

function verifyVllmToolchainCompatibility({
  cudaVersion = '13.0',
  pytorchVersion = '2.14',
  platform = 'cuda',
  packageInstaller = 'uv',
} = {}) {
  const parseMajorMinor = (ver) => {
    const [maj, min] = String(ver || '0.0').trim().split('.').map((x) => Number(x) || 0);
    return maj + (min / 100);
  };
  const cudaNum = parseMajorMinor(cudaVersion);
  const torchNum = parseMajorMinor(pytorchVersion);
  const isCudaPlatform = String(platform || 'cuda').toLowerCase() === 'cuda';
  const cudaSupported = !isCudaPlatform || cudaNum >= 13.0;
  const pytorchSupported = torchNum >= 2.14;
  const reasons = [];
  if (!cudaSupported) {
    reasons.push(`CUDA ${cudaVersion} is unsupported in vLLM v0.33.0rc3+ (CUDA 12.9 dropped; require CUDA 13.0-13.1).`);
  }
  if (!pytorchSupported) {
    reasons.push(`PyTorch ${pytorchVersion} is below vLLM v0.33.0rc3 requirement (PyTorch >= 2.14).`);
  }
  return {
    vllmVersion: '0.33.0rc3',
    platform,
    cudaVersion: String(cudaVersion),
    pytorchVersion: String(pytorchVersion),
    packageInstaller,
    recommendedInstallCommand: 'uv pip install vllm --torch-backend auto',
    cudaSupported,
    pytorchSupported,
    compatible: cudaSupported && pytorchSupported,
    verdict: cudaSupported && pytorchSupported
      ? 'PASS_VLLM_V033_TOOLCHAIN'
      : (!cudaSupported ? 'FAIL_CUDA_12_9_DROPPED' : 'FAIL_PYTORCH_BELOW_2_14'),
    reasons,
  };
}

function alignPromptToPagedAttentionBlocks(tokenCount, blockSize = 16) {
  const safeTokens = Math.max(1, Math.floor(Number(tokenCount) || 0));
  const safeBlock = Math.max(1, Math.floor(Number(blockSize) || 16));
  const fullBlocks = Math.floor(safeTokens / safeBlock);
  const alignedTokens = Math.ceil(safeTokens / safeBlock) * safeBlock;
  const paddingTokens = alignedTokens - safeTokens;
  return {
    inputTokens: safeTokens,
    blockSize: safeBlock,
    fullBlocks,
    totalBlocks: alignedTokens / safeBlock,
    alignedTokens,
    paddingTokens,
    prefixCacheAligned: paddingTokens === 0,
  };
}

function verifySpeculativeDecodingSpeedup({
  acceptLength = 3.2,
  draftLength = 4,
  draftCostRatio = 0.08,
  claimedSpeedup = 2.4,
} = {}) {
  const al = Math.max(1, Number(acceptLength) || 1);
  const d = Math.max(1, Math.floor(Number(draftLength) || 1));
  const rho = Math.max(0, Number(draftCostRatio) || 0);
  const claimed = Math.max(0, Number(claimedSpeedup) || 0);
  const theoreticalCeiling = Number((al / (1 + rho * d)).toFixed(4));
  const withinRooflineBound = claimed <= theoreticalCeiling + 1e-6;
  return {
    acceptLength: al,
    draftLength: d,
    draftCostRatio: rho,
    claimedSpeedup: claimed,
    theoreticalCeiling,
    withinRooflineBound,
    verdict: withinRooflineBound ? 'PASS_ROOFLINE_BOUND' : 'FAIL_EXCEEDS_AL_ROOFLINE',
  };
}

function planHiSparseHostKvOffload({
  gpuBaseTokens = 1970000,
  hostPoolGib = 440,
  crossLayerKvSharing = true,
  singleNodeTp = true,
  allReduceBackend = 'trtllm',
} = {}) {
  const safeGpuTokens = Math.max(1000, Math.floor(Number(gpuBaseTokens) || 1970000));
  const safeHostGib = Math.max(0, Number(hostPoolGib) ?? 440);
  const hiSparseEnabled = safeHostGib > 0;
  const poolScale = safeHostGib / 440;
  const kvSharingDeduplicationBonus = crossLayerKvSharing ? 1.143 : 1.0;
  const startupAdmittedTokens = hiSparseEnabled
    ? Math.round(safeGpuTokens * (1 + 3.4518 * poolScale * (crossLayerKvSharing ? 1.0 : 1 / 1.143)))
    : safeGpuTokens;
  const steadyStateMaxTokens = hiSparseEnabled
    ? Math.round(safeGpuTokens * (1 + 4.7107 * poolScale * (crossLayerKvSharing ? 1.0 : 1 / 1.143)))
    : safeGpuTokens;

  const normalizedAllReduce = String(allReduceBackend || 'trtllm').trim().toLowerCase();
  const mnnvlCrashRisk = Boolean(hiSparseEnabled && singleNodeTp && normalizedAllReduce === 'mnnvl');

  return {
    hiSparseEnabled,
    kvConnector: hiSparseEnabled ? 'HiSparseConnector' : 'none',
    hostPoolGib: safeHostGib,
    crossLayerKvSharing,
    kvSharingHostTokenBonusPct: crossLayerKvSharing ? 14.3 : 0,
    kvSharingDeduplicationBonus,
    gpuOnlyTokens: safeGpuTokens,
    startupAdmittedTokens,
    steadyStateMaxTokens,
    startupCapacityMultiplier: Number((startupAdmittedTokens / safeGpuTokens).toFixed(2)),
    steadyStateCapacityMultiplier: Number((steadyStateMaxTokens / safeGpuTokens).toFixed(2)),
    singleNodeTp,
    allReduceBackend: normalizedAllReduce,
    requiredEnv: hiSparseEnabled && singleNodeTp
      ? { VLLM_FLASHINFER_ALLREDUCE_BACKEND: 'trtllm' }
      : {},
    mnnvlCrashGuardStatus: mnnvlCrashRisk
      ? 'FAIL_MNNVL_HISPARSE_CRASH_RISK_VLLM_64327'
      : 'PASS_SAFE_ALLREDUCE_BACKEND',
  };
}

function planDsparkSpeculativeDecoding({
  temperature = 0,
  numSpeculativeTokens = 3,
  kvPrecision = 'nvfp4',
  dcpSize = 1,
  avgContextTokens = 8192,
  separateDraftBlockPool = false,
} = {}) {
  const temp = Math.max(0, Number(temperature) || 0);
  const specTokens = Math.max(1, Math.floor(Number(numSpeculativeTokens) || 3));
  const dcp = Math.max(1, Math.floor(Number(dcpSize) || 1));
  const contextTokens = Math.max(1, Math.floor(Number(avgContextTokens) || 8192));
  const useProbabilisticDraftSampling = temp > 1.0;
  const draftSampleMethod = useProbabilisticDraftSampling ? 'probabilistic' : 'greedy_or_standard';

  const isNvfp4 = String(kvPrecision || 'nvfp4').toLowerCase().includes('nvfp4');
  let expectedAcceptLength = isNvfp4 ? 2.93 : 2.90;
  if (temp > 0 && temp <= 1.0) {
    expectedAcceptLength = 2.80;
  } else if (temp > 1.0) {
    expectedAcceptLength = useProbabilisticDraftSampling ? 2.45 : 2.04;
  }
  if (dcp >= 8 && contextTokens >= 60000 && temp === 0) {
    expectedAcceptLength = 2.85;
  }

  const baseC1TpotMs = dcp >= 8 ? 11.82 : (isNvfp4 ? 8.21 : 8.84);
  const dsparkC1TpotMs = dcp >= 8
    ? 5.22
    : Number((baseC1TpotMs / (expectedAcceptLength / 1.05)).toFixed(2));

  const dcpDraftBlockIdBind = dcp >= 8 && !separateDraftBlockPool && contextTokens >= 64000;
  const effectiveKvCapacityMultiplier = dcpDraftBlockIdBind ? 0.69 : 1.0;

  return {
    method: 'dspark',
    numSpeculativeTokens: specTokens,
    temperature: temp,
    draftSampleMethod,
    losslessRejectionSampling: true,
    expectedAcceptLength,
    baseC1TpotMs,
    dsparkC1TpotMs,
    speedupMultiplier: Number((baseC1TpotMs / dsparkC1TpotMs).toFixed(2)),
    dcpDraftWindowReplicatedMb: dcp > 1 ? 7 : 0,
    effectiveKvCapacityMultiplier,
    dcpCapacityBoundAbove99k: dcp >= 8 && !separateDraftBlockPool && contextTokens >= 99000,
    speculativeConfigJson: JSON.stringify(
      useProbabilisticDraftSampling
        ? { method: 'dspark', num_speculative_tokens: specTokens, draft_sample_method: 'probabilistic' }
        : { method: 'dspark', num_speculative_tokens: specTokens }
    ),
  };
}

/**
 * Thinking Machines Lab ("Defeating Nondeterminism in LLM Inference"):
 * Standard temperature=0 LLM serving is non-deterministic because dynamic batch sizes
 * and chunked prefill + decode alter floating-point reduction orders in RMSNorm, Matmul,
 * and Split-KV Attention. Enforcing batch-invariant reductions + Fixed-Split-KV size
 * restores bitwise reproducibility and true on-policy RL (trainer-sampler KL = 0).
 */
function planBatchInvariantDeterministicInference({
  enabled = true,
  temperature = 0,
  fixedSplitKvSize = 256,
  canonicalKvLayout = true,
  rmsnormStrategy = 'data-parallel-per-row',
  matmulStrategy = 'fixed-tile-no-split-k',
  optimizedAttentionKernel = true,
  rlRolloutMode = false,
  trainerMatchesSamplerPrecision = true,
} = {}) {
  const splitSize = Math.max(64, Math.floor(Number(fixedSplitKvSize || 256)));
  const temp = Math.max(0, Number(temperature ?? 0));
  const isBatchInvariant = Boolean(
    enabled
    && canonicalKvLayout
    && rmsnormStrategy === 'data-parallel-per-row'
    && matmulStrategy === 'fixed-tile-no-split-k'
    && splitSize >= 64
  );
  const deterministicGreedy = isBatchInvariant && temp === 0;
  const trainerSamplerBitwiseIdentical = Boolean(isBatchInvariant && trainerMatchesSamplerPrecision);
  const klDivergenceTrainerVsSampler = trainerSamplerBitwiseIdentical ? 0 : (rlRolloutMode ? 0.0008 : 0.0003);
  const latencyOverheadMultiplier = !enabled
    ? 1.0
    : (optimizedAttentionKernel ? 1.62 : 2.12);

  return {
    enabled: Boolean(enabled),
    isBatchInvariant,
    deterministicGreedy,
    attentionReductionMode: 'fixed-split-kv',
    fixedSplitKvSize: splitSize,
    canonicalKvLayout: Boolean(canonicalKvLayout),
    rmsnormStrategy,
    matmulStrategy,
    trainerSamplerBitwiseIdentical,
    klDivergenceTrainerVsSampler,
    trueOnPolicyRlReady: Boolean(rlRolloutMode ? trainerSamplerBitwiseIdentical : isBatchInvariant),
    latencyOverheadMultiplier,
    vllmBatchInvariantEnv: {
      VLLM_BATCH_INVARIANT: enabled ? '1' : '0',
      VLLM_ATTENTION_FIXED_SPLIT_KV_SIZE: String(splitSize),
    },
  };
}

function planVllmDisaggregatedServing(workload = {}, env = process.env) {
  const promptTokens = Math.max(1, Math.floor(Number(workload.promptTokens || 4096)));
  const maxOutputTokens = Math.max(1, Math.floor(Number(workload.maxOutputTokens || 256)));
  const scopedToolCount = Math.max(0, Math.floor(Number(workload.scopedToolCount ?? 4)));
  const profileId = workload.profileId || env.THUMBGATE_VLLM_PROFILE || 'deepseek-v4.1-flash-pd';
  const profile = VLLM_V033_PROFILES[profileId] || VLLM_V033_PROFILES['deepseek-v4.1-flash-pd'];

  const blockAlignment = alignPromptToPagedAttentionBlocks(promptTokens, profile.pagedAttentionBlockSize);
  const disaggregateActive = Boolean(profile.prefillDecodeDisaggregation && promptTokens >= 2048);
  const wideEpActive = profile.expertParallelMode === 'wide-ep' && disaggregateActive;
  const dcpPcpActive = profile.contextParallelMode === 'dcp-pcp' && promptTokens >= 32768;
  const prefillRoute = disaggregateActive ? 'vllm-prefill-pool-nixl' : 'vllm-unified-worker';
  const decodeRoute = disaggregateActive ? 'vllm-decode-pool-low-latency' : 'vllm-unified-worker';

  // Baseline FP16 KV cache ~0.5 MB per 1K tokens; NVFP4 reduces by 4x
  const fp16KvMegabytes = Number(((promptTokens + maxOutputTokens) * 0.0005).toFixed(3));
  const nvfp4KvMegabytes = Number((fp16KvMegabytes / profile.kvMemoryReductionFactor).toFixed(3));
  const specDecodeCheck = verifySpeculativeDecodingSpeedup({
    acceptLength: workload.acceptLength || 3.4,
    draftLength: workload.draftLength || 4,
    draftCostRatio: workload.draftCostRatio || 0.06,
    claimedSpeedup: workload.claimedSpeedup || 2.6,
  });
  const toolchainCheck = verifyVllmToolchainCompatibility({
    cudaVersion: workload.cudaVersion || env.THUMBGATE_VLLM_CUDA_VERSION || profile.minCudaVersion,
    pytorchVersion: workload.pytorchVersion || env.THUMBGATE_VLLM_PYTORCH_VERSION || profile.pytorchVersion,
    platform: workload.platform || 'cuda',
  });

  // Scoped <=4 tools keeps the immutable system+tool prefix compact for PagedAttention block reuse
  const estimatedPrefixHitRate = scopedToolCount <= 4 ? 0.91 : 0.54;

  return {
    vllmVersion: profile.vllmVersion,
    modelRunner: profile.modelRunner,
    profileId: profile.id,
    model: profile.model,
    totalParamsBillions: profile.totalParamsBillions || null,
    activeParamsBillions: profile.activeParamsBillions || null,
    maxContextTokens: profile.maxContextTokens || null,
    modalities: profile.modalities || ['text'],
    attentionBackend: profile.attentionBackend,
    kvCacheDtype: profile.kvCacheDtype,
    kvMemoryReductionFactor: profile.kvMemoryReductionFactor,
    fp16KvMegabytes,
    nvfp4KvMegabytes,
    disaggregateActive,
    wideEpActive,
    dcpPcpActive,
    expertParallelMode: profile.expertParallelMode,
    contextParallelMode: profile.contextParallelMode,
    specDecodeMethod: profile.specDecodeMethod,
    prefillRoute,
    decodeRoute,
    kvTransferConnector: profile.kvTransferConnector,
    blockAlignment,
    estimatedPrefixHitRate,
    specDecodeCheck,
    toolchainCheck,
    dsparkPlan: planDsparkSpeculativeDecoding({
      temperature: workload.temperature ?? 0,
      numSpeculativeTokens: workload.draftLength || 3,
      kvPrecision: profile.kvCacheDtype,
      dcpSize: workload.dcpSize || (dcpPcpActive ? 8 : 1),
      avgContextTokens: promptTokens,
      separateDraftBlockPool: Boolean(workload.separateDraftBlockPool),
    }),
    hiSparsePlan: planHiSparseHostKvOffload({
      gpuBaseTokens: workload.gpuBaseTokens || 1970000,
      hostPoolGib: workload.hostPoolGib ?? 440,
      crossLayerKvSharing: profile.attentionBackend.includes('cross-layer-kv'),
      singleNodeTp: workload.singleNodeTp !== false,
      allReduceBackend: workload.allReduceBackend || 'trtllm',
    }),
    batchInvariantPlan: planBatchInvariantDeterministicInference({
      enabled: workload.batchInvariant !== false,
      temperature: workload.temperature ?? 0,
      fixedSplitKvSize: workload.fixedSplitKvSize || 256,
      rlRolloutMode: Boolean(workload.rlRolloutMode),
      trainerMatchesSamplerPrecision: workload.trainerMatchesSamplerPrecision !== false,
    }),
    singleNodeThroughputMultiplier: profile.singleNodeThroughputMultiplier,
    peakTokensPerSecPerGpu: profile.peakTokensPerSecPerGpu,
    p90TokensPerSecPerUser: profile.p90TokensPerSecPerUser,
  };
}

function resolveProviderMode(env = process.env) {
  const explicit = normalizeSlug(env.THUMBGATE_PROVIDER_MODE || env.THUMBGATE_MODEL_PROVIDER_MODE);
  if (explicit === 'local' || explicit === 'managed' || explicit === 'vertex') return explicit;
  if (env.VERTEX_PROJECT_ID || env.VERTEX_API_ENDPOINT) return 'vertex';
  if (env.THUMBGATE_LOCAL_MODEL_FAMILY || env.THUMBGATE_LOCAL_MODEL_SERVER) return 'local';
  return 'managed';
}

function resolveServerEngine(env = process.env, providerMode = resolveProviderMode(env)) {
  const explicit = normalizeSlug(env.THUMBGATE_LOCAL_MODEL_SERVER || env.THUMBGATE_MODEL_SERVER);
  if (explicit) return explicit;
  return providerMode === 'local' ? 'generic' : 'api';
}

function resolveModelFamily(env = process.env) {
  return normalizeSlug(
    env.THUMBGATE_LOCAL_MODEL_FAMILY
      || env.THUMBGATE_MODEL_FAMILY
      || env.THUMBGATE_LOCAL_MODEL
      || env.THUMBGATE_MODEL_ID,
    'unknown',
  );
}

function buildBackendLabel(providerMode, modelFamily) {
  if (providerMode === 'vertex') return 'Vertex AI secure cloud backend';
  if (providerMode === 'managed') return 'Managed API backend';
  if (modelFamily.startsWith('deepseek')) return 'Local DeepSeek sparse backend';
  if (modelFamily.startsWith('glm')) return 'Local GLM sparse backend';
  if (modelFamily.startsWith('mistral')) return 'Local Mistral Sparse MLA backend';
  if (modelFamily.startsWith('nemotron') || modelFamily.startsWith('nvidia')) {
    return 'Local NVIDIA Nemotron hybrid Mamba-Transformer backend';
  }
  return 'Local dense backend';
}

function detectInferenceBackend(env = process.env) {
  const providerMode = resolveProviderMode(env);
  const modelFamily = resolveModelFamily(env);
  const serverEngine = resolveServerEngine(env, providerMode);
  const supportsSparseAttention = isSparseAttentionFamily(modelFamily);
  const indexCacheEligible = providerMode === 'local'
    && supportsSparseAttention
    && INDEXCACHE_SERVER_ENGINES.has(serverEngine);
  const indexCacheEnabled = indexCacheEligible && parseBoolean(env.THUMBGATE_INDEXCACHE_ENABLED, false);
  const id = providerMode === 'vertex'
    ? 'vertex-api'
    : providerMode === 'managed'
      ? 'managed-api'
      : supportsSparseAttention
        ? `local-${modelFamily}-sparse`
        : 'local-dense';

  let rationale = 'Baseline backend with no sparse-attention acceleration.';
  if (providerMode === 'vertex') {
    rationale = 'Vertex AI secure cloud backend providing compliant enterprise Gemini models inside VPC boundary.';
  } else if (providerMode === 'managed') {
    rationale = 'Managed API path does not expose sparse-attention kernel controls like IndexCache.';
  } else if (indexCacheEnabled) {
    rationale = `Local ${modelFamily} backend is sparse-attention capable and IndexCache-ready on ${serverEngine}.`;
  } else if (indexCacheEligible) {
    rationale = `Local ${modelFamily} backend is sparse-attention capable and can use IndexCache on ${serverEngine}.`;
  } else if (supportsSparseAttention) {
    rationale = `Local ${modelFamily} backend is sparse-attention capable, but current server engine "${serverEngine}" is not marked IndexCache-ready.`;
  }

  return {
    id,
    label: buildBackendLabel(providerMode, modelFamily),
    providerMode,
    modelFamily,
    serverEngine,
    supportsSparseAttention,
    indexCacheEligible,
    indexCacheEnabled,
    longContextOptimized: indexCacheEnabled,
    rationale,
  };
}

function isLongContextTask(task = {}) {
  const contextTokens = Number(task.contextTokens || 0);
  const tags = Array.isArray(task.tags) ? task.tags.map((tag) => normalizeSlug(tag)) : [];
  return contextTokens >= 120000
    || LONG_CONTEXT_TASK_TYPES.has(normalizeSlug(task.type))
    || tags.some((tag) => LONG_CONTEXT_TAGS.has(tag));
}

function recommendInferenceBackend(task = {}, env = process.env) {
  const backend = detectInferenceBackend(env);
  const privacyRoute = task.privacyRoute || 'frontier';
  const workloadClass = isLongContextTask(task) ? 'long_context' : 'baseline';
  const nvidiaAccelerations = {};
  if (task.dynamoRouting || Array.isArray(task.dynamoWorkers)) {
    nvidiaAccelerations.dynamoRouting = routeDynamoKvSmartWorker({
      ...(task.dynamoRouting || {}),
      ...(Array.isArray(task.dynamoWorkers) ? { workers: task.dynamoWorkers } : {}),
      promptTokens: task.contextTokens || (task.dynamoRouting && task.dynamoRouting.promptTokens) || 4096,
    });
  }
  if (task.cuOptBudget || Array.isArray(task.cuOptTasks)) {
    nvidiaAccelerations.cuOptSchedule = solveCuOptBudgetConstrainedRouting({
      ...(task.cuOptBudget || {}),
      ...(Array.isArray(task.cuOptTasks) ? { tasks: task.cuOptTasks } : {}),
    });
  }
  if (task.specDecode && typeof task.specDecode === 'object') {
    nvidiaAccelerations.tensorRtSpecDecode = auditTensorRtLlmSpecDecodeAndTiles(task.specDecode);
  }
  const hasNvidiaAccelerations = Object.keys(nvidiaAccelerations).length > 0;

  if (privacyRoute === 'local' && backend.providerMode !== 'local') {
    return {
      backend,
      workloadClass,
      recommendationClass: 'privacy_local_required',
      route: 'local',
      reason: 'privacy-sensitive workload should stay on a local backend before any long-context optimization.',
    };
  }

  if (workloadClass === 'long_context' && backend.indexCacheEnabled) {
    return {
      backend,
      workloadClass,
      recommendationClass: 'indexcache_active',
      route: backend.providerMode,
      reason: `current backend ${backend.id} is IndexCache-ready for long-context sparse-attention workloads.`,
    };
  }

  if (workloadClass === 'long_context' && backend.indexCacheEligible) {
    return {
      backend,
      workloadClass,
      recommendationClass: 'indexcache_eligible',
      route: backend.providerMode,
      reason: `current backend ${backend.id} is sparse-attention capable; enabling IndexCache is the highest-ROI latency/cost improvement.`,
    };
  }

  if (workloadClass === 'long_context') {
    return {
      backend,
      workloadClass,
      recommendationClass: 'baseline_long_context',
      route: backend.providerMode,
      reason: backend.providerMode === 'managed'
        ? 'managed API path hides sparse-attention kernel controls, so IndexCache-style gains are unavailable here.'
        : `current local backend ${backend.id} is not yet IndexCache-eligible.`,
    };
  }

  return {
    backend,
    workloadClass,
    recommendationClass: 'baseline',
    route: privacyRoute === 'local' ? 'local' : backend.providerMode,
    reason: 'baseline workload does not need sparse-attention optimization.',
    ...(hasNvidiaAccelerations ? { nvidiaAccelerations } : {}),
  };
}

function resolveFeedbackDir(explicitDir) {
  return resolveSharedFeedbackDir({ feedbackDir: explicitDir });
}

function detectHardware(env = process.env) {
  const totalMemBytes = parseNumber(env.THUMBGATE_RAM_BYTES_OVERRIDE, os.totalmem());
  const ramGb = Math.round((totalMemBytes / (1024 ** 3)) * 10) / 10;
  const cpuCount = Math.max(1, Math.floor(parseNumber(env.THUMBGATE_CPU_COUNT_OVERRIDE, os.cpus().length || 1)));
  const platform = env.THUMBGATE_PLATFORM_OVERRIDE || process.platform;
  const arch = env.THUMBGATE_ARCH_OVERRIDE || process.arch;
  const ci = parseBoolean(env.CI, false);
  const accelerator = env.THUMBGATE_ACCELERATOR
    || (platform === 'darwin' && arch === 'arm64' ? 'metal' : 'cpu');

  return {
    ramGb,
    cpuCount,
    platform,
    arch,
    accelerator,
    ci,
  };
}

function pickAutoProfile(hardware) {
  if (hardware.ci || hardware.ramGb < 8 || hardware.cpuCount <= 4) {
    return EMBEDDING_PROFILES.compact;
  }
  if (hardware.ramGb >= 24 && hardware.cpuCount >= 8 && !hardware.ci) {
    return EMBEDDING_PROFILES.quality;
  }
  return EMBEDDING_PROFILES.balanced;
}

function cloneProfile(profile) {
  return { ...profile };
}

function resolveEmbeddingProfile(env = process.env) {
  const hardware = detectHardware(env);
  const requestedProfile = String(env.THUMBGATE_MODEL_FIT_PROFILE || 'auto').trim().toLowerCase();

  const baseProfile = requestedProfile !== 'auto' && EMBEDDING_PROFILES[requestedProfile]
    ? EMBEDDING_PROFILES[requestedProfile]
    : pickAutoProfile(hardware);

  const profile = cloneProfile(baseProfile);
  const source = requestedProfile !== 'auto' && EMBEDDING_PROFILES[requestedProfile]
    ? 'profile_override'
    : 'auto';

  if (env.THUMBGATE_EMBED_MODEL) {
    profile.model = String(env.THUMBGATE_EMBED_MODEL).trim();
  }
  profile.quantized = parseBoolean(env.THUMBGATE_EMBED_QUANTIZED, profile.quantized);
  profile.maxChars = Math.max(256, Math.floor(parseNumber(env.THUMBGATE_EMBED_MAX_CHARS, profile.maxChars)));

  const fallback = cloneProfile(EMBEDDING_PROFILES.balanced);
  fallback.id = 'fallback';

  return {
    source,
    hardware,
    selectedProfile: profile,
    fallbackProfile: fallback,
  };
}

/**
 * Resolve the LLM model ID for a given workload role.
 *
 * Roles: normal, thinking, critique, compaction, vlm
 * Each role can be overridden via THUMBGATE_MODEL_ROLE_<ROLE> env var.
 *
 * @param {string} role - One of the valid model roles
 * @param {object} [env=process.env]
 * @returns {{ role: string, model: string, provider: string, envKey: string }}
 */
function resolveModelRole(role, env) {
  const e = env || process.env;
  const normalized = String(role || '').toLowerCase().trim();
  if (!MODEL_ROLES[normalized]) {
    throw new Error(`Unknown model role: '${normalized}'. Valid roles: ${VALID_MODEL_ROLES.join(', ')}`);
  }
  const envKey = `THUMBGATE_MODEL_ROLE_${normalized.toUpperCase()}`;
  const modelFamily = resolveModelFamily(e);
  const isLocalGlm = modelFamily.startsWith('glm');
  const isLocalNemotron = modelFamily.startsWith('nemotron') || modelFamily.startsWith('nvidia');
  // Only explicit vLLM family/server selects VLLM_MODEL_ROLES. A generic
  // THUMBGATE_LOCAL_LLM_ENDPOINT (Ollama, LM Studio, etc.) must keep its own model id.
  const serverEngine = normalizeSlug(e.THUMBGATE_LOCAL_MODEL_SERVER || e.THUMBGATE_MODEL_SERVER || '');
  const isLocalVllm = modelFamily.startsWith('vllm') || serverEngine === 'vllm';
  const providerMode = resolveProviderMode(e);
  const provider = (isLocalGlm || isLocalVllm || isLocalNemotron) ? 'local' : (providerMode === 'vertex' ? 'vertex' : 'gemini');
  const defaultModel = isLocalNemotron
    ? (NEMOTRON_AGENT_MODEL_ROLES[normalized] || MODEL_ROLES[normalized])
    : (isLocalVllm
      ? (VLLM_MODEL_ROLES[normalized] || MODEL_ROLES[normalized])
      : (isLocalGlm ? (GLM_MODEL_ROLES[normalized] || MODEL_ROLES[normalized]) : MODEL_ROLES[normalized]));
  const model = (e[envKey] && String(e[envKey]).trim()) || defaultModel;
  return { role: normalized, model, provider, envKey };
}

const NACE_DREX_MAX_V1_PROFILES = Object.freeze({
  'drex-max-v1-mlx-4bit-affine': Object.freeze({
    id: 'drex-max-v1-mlx-4bit-affine',
    model: 'nace-ai/drex-max-v1',
    minUnifiedMemoryGb: 24,
    footprintGb: 16.0,
    quantization: '4-bit affine MLX',
    runtimes: ['kapitsa', 'mlx-lm'],
    systemOneEndpoint: '/v1/systemone',
    supportedModes: ['choice', 'noul', 'score'],
    maxCandidateOptions: 255,
  }),
  'drex-max-v1-q8_0-gguf': Object.freeze({
    id: 'drex-max-v1-q8_0-gguf',
    model: 'nace-ai/drex-max-v1',
    minUnifiedMemoryGb: 48,
    footprintGb: 28.7,
    quantization: 'Q8_0 GGUF',
    runtimes: ['kapitsa', 'llama.cpp', 'ollama'],
    systemOneEndpoint: '/v1/systemone',
    supportedModes: ['choice', 'noul', 'score'],
    maxCandidateOptions: 255,
  }),
});

function planNaceDrexMaxV1SystemOneServing(options = {}) {
  const unifiedMemoryGb = Number(options.unifiedMemoryGb ?? 48);
  const operationMode = String(options.operationMode || 'choice');
  const optionsCount = Number(options.optionsCount ?? 8);
  const noulThreshold = Number(options.noulThreshold ?? 0.55);
  const topCandidateProb = Number(options.topCandidateProb ?? 0.92);
  const profile = unifiedMemoryGb >= 48
    ? NACE_DREX_MAX_V1_PROFILES['drex-max-v1-q8_0-gguf']
    : NACE_DREX_MAX_V1_PROFILES['drex-max-v1-mlx-4bit-affine'];
  const eligible = unifiedMemoryGb >= 24 && optionsCount >= 1 && optionsCount <= 255;
  const abstainedViaNoul = operationMode === 'noul' && topCandidateProb < noulThreshold;
  return {
    ok: eligible,
    selectedProfile: profile,
    architecture: {
      totalLayers: 64,
      gatedDeltaNetLinearLayers: 48,
      nonCausalFullAttentionLayers: 16,
      readoutHeadWay: 255,
      hiddenDimension: 5120,
    },
    routing: {
      endpoint: '/v1/systemone',
      operationMode,
      optionsCount,
      abstainedViaNoul,
      escalateToSystemTwoFrontier: abstainedViaNoul,
    },
    benchmarks: {
      decisionIndexV04: 67.52,
      jevBenchAccuracyPct: 92.2,
      decisionBenchV4AccuracyPct: 94.3,
    },
  };
}

function planRevolutGlm51SelfHostedServing(options = {}) {
  const monthlyTokensMillions = Math.max(1, Number(options.monthlyTokensMillions ?? 500));
  const concurrentUsers = Math.max(1, Number(options.concurrentUsers ?? 25));
  const perUserContextGb = Math.min(26, Math.max(6, Number(options.perUserContextGb ?? 12)));
  const commercialClaudePer1MUsd = Math.max(0.5, Number(options.commercialClaudePer1MUsd ?? 3.0));
  const glm51SelfHostedPer1MUsd = Math.max(0.05, Number(options.glm51SelfHostedPer1MUsd ?? 0.3));
  const frontierExceptionShare = Math.min(0.5, Math.max(0, Number(options.frontierExceptionShare ?? 0.05)));

  const baseModelVramGb = 380;
  const contextRetentionVramGb = concurrentUsers * perUserContextGb;
  const totalRequiredVramGb = baseModelVramGb + contextRetentionVramGb;
  const b200SingleGpuVramGb = 192;
  const minB200GpusRequired = Math.ceil(totalRequiredVramGb / b200SingleGpuVramGb);
  const revolutReferenceClusterB200Gpus = 56;

  const commercialMonthlyUsd = Number((monthlyTokensMillions * commercialClaudePer1MUsd).toFixed(2));
  const blendedPer1MUsd =
    glm51SelfHostedPer1MUsd * (1 - frontierExceptionShare) +
    commercialClaudePer1MUsd * frontierExceptionShare;
  const selfHostedMonthlyUsd = Number((monthlyTokensMillions * blendedPer1MUsd).toFixed(2));
  const inferenceCostCutPct = Number(
    (((commercialClaudePer1MUsd - glm51SelfHostedPer1MUsd) / commercialClaudePer1MUsd) * 100).toFixed(1)
  );

  return {
    ok: true,
    modelFamily: 'z-ai/glm-5.1-self-hosted',
    roles: GLM_5_1_REVOLUT_ROLES,
    economics: {
      glm51SelfHostedPer1MUsd,
      commercialClaudePer1MUsd,
      inferenceCostCutPct,
      commercialMonthlyUsd,
      selfHostedMonthlyUsd,
      monthlySavingsUsd: Number((commercialMonthlyUsd - selfHostedMonthlyUsd).toFixed(2)),
      billingMode: 'flat_derestricted',
      endOfMonthBillShock: false,
      frontierIsException: true,
    },
    hardware: {
      baseModelVramGb,
      concurrentUsers,
      perUserContextGb,
      contextRetentionVramGb,
      totalRequiredVramGb,
      minB200GpusRequired,
      revolutReferenceClusterB200Gpus,
      fitsRevolutCluster: minB200GpusRequired <= revolutReferenceClusterB200Gpus,
    },
    productivityGains: {
      leadTimeImprovementPct: 70,
      codingTimeImprovementPct: 60,
      dataPrivacyAndAuditability: 'self_hosted_full_audit',
    },
  };
}

function buildModelFitReport(options = {}) {
  const resolved = options.resolved || resolveEmbeddingProfile(options.env);
  const selected = resolved.selectedProfile;
  const fallback = resolved.fallbackProfile;
  const summary = selected.quantized
    ? `${selected.id} profile selected with quantized ${selected.model}`
    : `${selected.id} profile selected with full-precision ${selected.model}`;

  return {
    generatedAt: new Date().toISOString(),
    source: resolved.source,
    hardware: resolved.hardware,
    selectedProfile: selected,
    fallbackProfile: fallback,
    summary,
  };
}

function getModelFitReportPath(feedbackDir) {
  return path.join(resolveFeedbackDir(feedbackDir), 'model-fit-report.json');
}

function writeModelFitReport(feedbackDir, options = {}) {
  const report = buildModelFitReport(options);
  const reportPath = getModelFitReportPath(feedbackDir);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { reportPath, report };
}
const POST_LOOP_COMPACTION_AND_BRV_POLICY = Object.freeze({
  compactionThresholdTokens: 400000,
  deleted150kTicketDecomposition: true,
  maxBuilderCompactions: 2,
  maxReviewerRounds: 3,
  maxVerifierRounds: 2,
  routeFixesToOriginalBuilder: true,
  originalBuilderTokenSavingsRatio: 0.38,
  verifyAtCapabilityEdgeOnly: true,
  chiefOfStaffSingleCoordinator: true,
  blockPeerPersonaSwarms: true,
});
/**
 * MakeUseOf (Nov 4, 2026 — "Local LLMs have a problem that no amount of free software can fix"):
 * - Memory (VRAM + KV attention cache) is the real paywall: Llama 3.3 70B Q4_K_M is 43GB,
 *   exceeding even a $1,999 RTX 5090 (32GB VRAM, 1,000W PSU) before KV cache growth.
 * - MoE active params (e.g. gpt-oss-120b activating 5.1B/token) reduce compute but still
 *   require an 80GB GPU to hold resident weights; gpt-oss-20b fits in 16GB and Ornith-9B fits 8-16GB.
 * - Avoid CPU offload slow lane: when model weights + KV cache exceed VRAM even after Flash Attention
 *   and KV cache quantization, block CPU offload and route either to a task-fitted smaller local model
 *   (<0.5ms deterministic PreToolUse gate + 8-16GB model) or zero-spend NVIDIA Inception cloud credits
 *   (DeepInfra 10B Nemotron / Crusoe $10k).
 */
const LOCAL_LLM_HARDWARE_PAYWALL_CATALOG = Object.freeze({
  'llama3.3:70b-q4_k_m': Object.freeze({
    weightsGb: 43,
    kvCachePer32kContextGb: 6.5,
    fitsRtx509032GbVram: false,
    rtx5090MsrpUsd: 1999,
    rtx5090SystemPowerWatts: 1000,
  }),
  'gpt-oss-120b': Object.freeze({
    weightsGb: 72,
    activeParamsBillions: 5.1,
    requiredGpuVramGb: 80,
    fitsRtx509032GbVram: false,
  }),
  'gpt-oss-20b': Object.freeze({
    weightsGb: 13.5,
    requiredGpuVramGb: 16,
    benchmarkParity: 'o3-mini',
    fits16GbLaptop: true,
  }),
  'ornith-9b': Object.freeze({
    weightsGb: 6.2,
    requiredGpuVramGb: 8,
    fits16GbLaptop: true,
  }),
});

function evaluateLocalLlmHardwarePaywallAndRouting(options = {}) {
  const requestedModel = String(options.requestedModel || 'llama3.3:70b-q4_k_m');
  const availableVramGb = Number(options.availableVramGb ?? 32);
  const contextTokens = Number(options.contextTokens ?? 65536);
  const flashAttentionEnabled = Boolean(options.flashAttentionEnabled ?? true);
  const kvCacheQuantized = Boolean(options.kvCacheQuantized ?? true);

  const spec = LOCAL_LLM_HARDWARE_PAYWALL_CATALOG[requestedModel] || {
    weightsGb: Number(options.weightsGb ?? 43),
    kvCachePer32kContextGb: 6.5,
  };

  const baseKvGb =
    ((contextTokens / 32768) * (spec.kvCachePer32kContextGb || 3.0));
  const kvOptimizationFactor =
    (flashAttentionEnabled ? 0.65 : 1.0) * (kvCacheQuantized ? 0.55 : 1.0);
  const estimatedKvCacheGb = Number(
    (baseKvGb * kvOptimizationFactor).toFixed(2)
  );
  const totalRequiredVramGb = Number(
    (spec.weightsGb + estimatedKvCacheGb).toFixed(2)
  );

  const fitsEntirelyInVram = totalRequiredVramGb <= availableVramGb;
  const wouldRequireCpuOffload = !fitsEntirelyInVram;

  const routingDecision = fitsEntirelyInVram
    ? {
        route: 'run_local_gpu_zero_cpu_offload',
        selectedModel: requestedModel,
        cpuOffloadBlocked: true,
      }
    : {
        route:
          'block_cpu_offload_use_task_fitted_small_local_or_inception_cloud_credits',
        selectedLocalFallbackModel:
          availableVramGb >= 16 ? 'gpt-oss-20b' : 'ornith-9b',
        selectedPreToolGate: 'thumbgate_deterministic_sub_0_5ms_gate',
        selectedZeroSpendCloudBurst:
          'DeepInfra_10B_Nemotron_or_Crusoe_10k_Inception_Credits',
        cpuOffloadBlocked: true,
      };

  return {
    ok: true,
    source:
      'https://www.makeuseof.com/local-llms-problem-no-free-software-fix/',
    requestedModel,
    hardwareAudit: {
      availableVramGb,
      modelWeightsGb: spec.weightsGb,
      contextTokens,
      estimatedKvCacheGb,
      totalRequiredVramGb,
      fitsEntirelyInVram,
      wouldRequireCpuOffload,
      rtx5090Reference32GbExceeded: totalRequiredVramGb > 32,
    },
    routingDecision,
  };
}

module.exports = {
  DEFAULT_EMBED_MODEL,
  DEFAULT_FEEDBACK_DIR,
  EMBEDDING_PROFILES,
  GLM_MODEL_ROLES,
  GLM_5_1_REVOLUT_ROLES,
  POST_LOOP_COMPACTION_AND_BRV_POLICY,
  LOCAL_LLM_HARDWARE_PAYWALL_CATALOG,
  VLLM_MODEL_ROLES,
  VLLM_V032_PROFILES,
  VLLM_V033_PROFILES,
  INDEXCACHE_SERVER_ENGINES,
  LONG_CONTEXT_TAGS,
  LONG_CONTEXT_TASK_TYPES,
  MODEL_ROLES,
  VALID_MODEL_ROLES,
  planTinkerPostTrainingAndDistillation,
  verifyVllmToolchainCompatibility,
  alignPromptToPagedAttentionBlocks,
  verifySpeculativeDecodingSpeedup,
  planHiSparseHostKvOffload,
  planDsparkSpeculativeDecoding,
  planBatchInvariantDeterministicInference,
  planVllmDisaggregatedServing,
  NACE_DREX_MAX_V1_PROFILES,
  planNaceDrexMaxV1SystemOneServing,
  planRevolutGlm51SelfHostedServing,
  evaluateLocalLlmHardwarePaywallAndRouting,
  NEMOTRON_AGENT_MODEL_ROLES,
  NEMOTRON_NIM_DATACENTER_ROLES,
  auditTensorRtLlmSpecDecodeAndTiles,
  planDynamoKvAwareDisaggregatedRouting,
  routeDynamoKvSmartWorker,
  solveCuOptBudgetConstrainedRouting,
  detectHardware,
  detectInferenceBackend,
  resolveEmbeddingProfile,
  resolveModelRole,
  buildModelFitReport,
  writeModelFitReport,
  getModelFitReportPath,
  isLongContextTask,
  recommendInferenceBackend,
  resolveFeedbackDir,
};

if (require.main === module) {
  const report = buildModelFitReport();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
