'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  detectHardware,
  detectInferenceBackend,
  recommendInferenceBackend,
  resolveEmbeddingProfile,
  writeModelFitReport,
  resolveModelRole,
  GLM_MODEL_ROLES,
  MODEL_ROLES,
  VALID_MODEL_ROLES,
} = require('../scripts/local-model-profile');

test('detectHardware respects env overrides', () => {
  const hardware = detectHardware({
    THUMBGATE_RAM_BYTES_OVERRIDE: String(6 * 1024 ** 3),
    THUMBGATE_CPU_COUNT_OVERRIDE: '4',
    THUMBGATE_PLATFORM_OVERRIDE: 'linux',
    THUMBGATE_ARCH_OVERRIDE: 'x64',
    CI: 'true',
  });

  assert.equal(hardware.ramGb, 6);
  assert.equal(hardware.cpuCount, 4);
  assert.equal(hardware.platform, 'linux');
  assert.equal(hardware.arch, 'x64');
  assert.equal(hardware.ci, true);
});

test('resolveEmbeddingProfile chooses compact profile on low-memory hardware', () => {
  const resolved = resolveEmbeddingProfile({
    THUMBGATE_RAM_BYTES_OVERRIDE: String(4 * 1024 ** 3),
    THUMBGATE_CPU_COUNT_OVERRIDE: '4',
  });

  assert.equal(resolved.selectedProfile.id, 'compact');
  assert.equal(resolved.selectedProfile.quantized, true);
});

test('resolveEmbeddingProfile honors explicit env overrides', () => {
  const resolved = resolveEmbeddingProfile({
    THUMBGATE_MODEL_FIT_PROFILE: 'quality',
    THUMBGATE_EMBED_MODEL: 'custom/model',
    THUMBGATE_EMBED_QUANTIZED: 'false',
    THUMBGATE_EMBED_MAX_CHARS: '1234',
    THUMBGATE_RAM_BYTES_OVERRIDE: String(32 * 1024 ** 3),
    THUMBGATE_CPU_COUNT_OVERRIDE: '10',
  });

  assert.equal(resolved.source, 'profile_override');
  assert.equal(resolved.selectedProfile.id, 'quality');
  assert.equal(resolved.selectedProfile.model, 'custom/model');
  assert.equal(resolved.selectedProfile.quantized, false);
  assert.equal(resolved.selectedProfile.maxChars, 1234);
});

test('writeModelFitReport persists machine-readable evidence', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-fit-proof-'));
  try {
    const { reportPath, report } = writeModelFitReport(tmpDir, {
      resolved: resolveEmbeddingProfile({
        THUMBGATE_RAM_BYTES_OVERRIDE: String(12 * 1024 ** 3),
        THUMBGATE_CPU_COUNT_OVERRIDE: '8',
      }),
    });

    assert.ok(fs.existsSync(reportPath), 'model-fit report should be written');
    const payload = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(payload.summary, report.summary);
    assert.equal(typeof payload.hardware.ramGb, 'number');
    assert.equal(typeof payload.selectedProfile.maxChars, 'number');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveModelRole returns correct model for each role', () => {
  for (const role of VALID_MODEL_ROLES) {
    const result = resolveModelRole(role, {});
    assert.equal(result.role, role);
    assert.equal(result.provider, 'gemini');
    assert.ok(typeof result.model === 'string' && result.model.length > 0);
    assert.equal(result.model, MODEL_ROLES[role]);
  }
});

test('resolveModelRole compaction role uses lighter model than normal', () => {
  const normal = resolveModelRole('normal', {});
  const compaction = resolveModelRole('compaction', {});
  assert.notEqual(compaction.model, normal.model);
  assert.ok(compaction.model.includes('lite'), 'compaction model should be a lite variant');
});

test('resolveModelRole respects env override', () => {
  const result = resolveModelRole('normal', { THUMBGATE_MODEL_ROLE_NORMAL: 'gemini-custom-model' });
  assert.equal(result.model, 'gemini-custom-model');
});

test('resolveModelRole throws on unknown role', () => {
  assert.throws(() => resolveModelRole('nonexistent', {}), /Unknown model role/);
});

test('GLM_MODEL_ROLES covers all valid roles and uses lite variant for compaction', () => {
  for (const role of VALID_MODEL_ROLES) {
    assert.ok(typeof GLM_MODEL_ROLES[role] === 'string' && GLM_MODEL_ROLES[role].length > 0,
      `GLM_MODEL_ROLES missing role: ${role}`);
  }
  assert.ok(GLM_MODEL_ROLES.compaction.includes('4-9b') || GLM_MODEL_ROLES.compaction.includes('lite'),
    'compaction should use a lighter GLM model');
  assert.notEqual(GLM_MODEL_ROLES.normal, GLM_MODEL_ROLES.thinking,
    'thinking role should use a larger model than normal');
});

test('resolveModelRole returns local provider and GLM model IDs when GLM family is set', () => {
  const env = { THUMBGATE_LOCAL_MODEL_FAMILY: 'glm-z1' };
  for (const role of VALID_MODEL_ROLES) {
    const result = resolveModelRole(role, env);
    assert.equal(result.provider, 'local', `role ${role} should have local provider`);
    assert.equal(result.model, GLM_MODEL_ROLES[role], `role ${role} should use GLM model ID`);
  }
});

test('resolveModelRole env override takes precedence over GLM defaults', () => {
  const result = resolveModelRole('normal', {
    THUMBGATE_LOCAL_MODEL_FAMILY: 'glm-z1',
    THUMBGATE_MODEL_ROLE_NORMAL: 'glm-custom-fine-tune',
  });
  assert.equal(result.provider, 'local');
  assert.equal(result.model, 'glm-custom-fine-tune');
});

test('detectInferenceBackend defaults to managed API and is not IndexCache-eligible', () => {
  const backend = detectInferenceBackend({});
  assert.equal(backend.providerMode, 'managed');
  assert.equal(backend.id, 'managed-api');
  assert.equal(backend.indexCacheEligible, false);
  assert.equal(backend.indexCacheEnabled, false);
});

test('detectInferenceBackend recognizes local sparse-attention backend with IndexCache readiness', () => {
  const backend = detectInferenceBackend({
    THUMBGATE_PROVIDER_MODE: 'local',
    THUMBGATE_LOCAL_MODEL_FAMILY: 'deepseek-r1',
    THUMBGATE_LOCAL_MODEL_SERVER: 'sglang',
    THUMBGATE_INDEXCACHE_ENABLED: 'true',
  });

  assert.equal(backend.providerMode, 'local');
  assert.equal(backend.id, 'local-deepseek-r1-sparse');
  assert.equal(backend.indexCacheEligible, true);
  assert.equal(backend.indexCacheEnabled, true);
  assert.equal(backend.longContextOptimized, true);
});

test('recommendInferenceBackend highlights IndexCache eligibility for long-context local sparse workloads', () => {
  const recommendation = recommendInferenceBackend({
    type: 'large-context',
    contextTokens: 180000,
    tags: ['xmemory'],
  }, {
    THUMBGATE_PROVIDER_MODE: 'local',
    THUMBGATE_LOCAL_MODEL_FAMILY: 'glm-4.5',
    THUMBGATE_LOCAL_MODEL_SERVER: 'vllm',
  });

  assert.equal(recommendation.workloadClass, 'long_context');
  assert.equal(recommendation.recommendationClass, 'indexcache_eligible');
  assert.equal(recommendation.backend.indexCacheEligible, true);
});

test('detectInferenceBackend recognizes Vertex AI provider mode via explicit env', () => {
  const backend = detectInferenceBackend({
    THUMBGATE_PROVIDER_MODE: 'vertex',
  });

  assert.equal(backend.providerMode, 'vertex');
  assert.equal(backend.id, 'vertex-api');
  assert.ok(backend.label.includes('Vertex AI'));
  assert.ok(backend.rationale.includes('compliant enterprise Gemini'));
});

test('detectInferenceBackend automatically resolves Vertex AI via GCP project env', () => {
  const backend = detectInferenceBackend({
    VERTEX_PROJECT_ID: 'enterprise-gcp-project',
  });

  assert.equal(backend.providerMode, 'vertex');
  assert.equal(backend.id, 'vertex-api');
});

test('resolveModelRole maps provider to vertex when Vertex AI is active', () => {
  const result = resolveModelRole('normal', {
    THUMBGATE_PROVIDER_MODE: 'vertex',
  });

  assert.equal(result.provider, 'vertex');
  assert.equal(result.model, MODEL_ROLES.normal);
});

test('resolveModelRole maps provider to local and uses VLLM_MODEL_ROLES when vllm model family is active', () => {
  const { VLLM_MODEL_ROLES } = require('../scripts/local-model-profile');
  const result = resolveModelRole('thinking', {
    THUMBGATE_LOCAL_MODEL_FAMILY: 'vllm',
  });

  assert.equal(result.provider, 'local');
  assert.equal(result.model, VLLM_MODEL_ROLES.thinking);
  assert.equal(result.model, 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B');
});


test('resolveModelRole does not select VLLM_MODEL_ROLES from bare LOCAL_LLM_ENDPOINT', () => {
  const { resolveModelRole, MODEL_ROLES } = require('../scripts/local-model-profile');
  const result = resolveModelRole('normal', {
    THUMBGATE_LOCAL_LLM_ENDPOINT: 'http://127.0.0.1:11434/v1',
    THUMBGATE_LOCAL_LLM_MODEL: 'qwen2.5:3b',
    THUMBGATE_MODEL_ROLE_NORMAL: 'qwen2.5:3b',
  });
  // Endpoint alone is not vLLM family — keep explicit/default non-vLLM model.
  assert.notEqual(result.model, 'Qwen/Qwen2.5-Coder-32B-Instruct');
  assert.equal(result.model, 'qwen2.5:3b');
});

test('planHiSparseHostKvOffload computes 4.45x startup / 5.71x steady-state capacity and blocks single-node MNNVL crash (vllm#64327)', () => {
  const { planHiSparseHostKvOffload } = require('../scripts/local-model-profile');
  const safePlan = planHiSparseHostKvOffload({
    gpuBaseTokens: 1970000,
    hostPoolGib: 440,
    crossLayerKvSharing: true,
    singleNodeTp: true,
    allReduceBackend: 'trtllm',
  });
  assert.equal(safePlan.hiSparseEnabled, true);
  assert.equal(safePlan.kvConnector, 'HiSparseConnector');
  assert.equal(safePlan.kvSharingHostTokenBonusPct, 14.3);
  assert.equal(safePlan.startupCapacityMultiplier, 4.45);
  assert.equal(safePlan.steadyStateCapacityMultiplier, 5.71);
  assert.equal(safePlan.requiredEnv.VLLM_FLASHINFER_ALLREDUCE_BACKEND, 'trtllm');
  assert.equal(safePlan.mnnvlCrashGuardStatus, 'PASS_SAFE_ALLREDUCE_BACKEND');

  const crashRiskPlan = planHiSparseHostKvOffload({
    gpuBaseTokens: 1970000,
    hostPoolGib: 440,
    crossLayerKvSharing: true,
    singleNodeTp: true,
    allReduceBackend: 'mnnvl',
  });
  assert.equal(crashRiskPlan.mnnvlCrashGuardStatus, 'FAIL_MNNVL_HISPARSE_CRASH_RISK_VLLM_64327');
});

test('planDsparkSpeculativeDecoding selects probabilistic draft sampling at T>1.0 and models DCP8 0.69x KV capacity bound', () => {
  const { planDsparkSpeculativeDecoding } = require('../scripts/local-model-profile');
  const greedy = planDsparkSpeculativeDecoding({
    temperature: 0,
    numSpeculativeTokens: 3,
    kvPrecision: 'nvfp4',
    dcpSize: 1,
    avgContextTokens: 8192,
  });
  assert.equal(greedy.draftSampleMethod, 'greedy_or_standard');
  assert.equal(greedy.expectedAcceptLength, 2.93);
  assert.equal(greedy.effectiveKvCapacityMultiplier, 1.0);

  const highTempDcp = planDsparkSpeculativeDecoding({
    temperature: 1.5,
    numSpeculativeTokens: 3,
    kvPrecision: 'nvfp4',
    dcpSize: 8,
    avgContextTokens: 100000,
    separateDraftBlockPool: false,
  });
  assert.equal(highTempDcp.draftSampleMethod, 'probabilistic');
  assert.equal(highTempDcp.expectedAcceptLength, 2.45);
  assert.equal(highTempDcp.dcpDraftWindowReplicatedMb, 7);
  assert.equal(highTempDcp.effectiveKvCapacityMultiplier, 0.69);
  assert.equal(highTempDcp.dcpCapacityBoundAbove99k, true);
  assert.ok(highTempDcp.speculativeConfigJson.includes('"draft_sample_method":"probabilistic"'));
});

test('planBatchInvariantDeterministicInference enforces Fixed-Split-KV and KL=0 trainer-sampler identity (Thinking Machines Lab)', () => {
  const { planBatchInvariantDeterministicInference } = require('../scripts/local-model-profile');
  const { evaluateLoraWithoutRegretPlan } = require('../scripts/post-training-governance');
  const {
    buildOnPolicyDistillationPlan,
    planInteractionModelSplit,
  } = require('../scripts/student-consistent-training');

  const invariant = planBatchInvariantDeterministicInference({
    enabled: true,
    temperature: 0,
    fixedSplitKvSize: 256,
    rlRolloutMode: true,
    trainerMatchesSamplerPrecision: true,
  });
  assert.equal(invariant.isBatchInvariant, true);
  assert.equal(invariant.deterministicGreedy, true);
  assert.equal(invariant.attentionReductionMode, 'fixed-split-kv');
  assert.equal(invariant.fixedSplitKvSize, 256);
  assert.equal(invariant.trainerSamplerBitwiseIdentical, true);
  assert.equal(invariant.klDivergenceTrainerVsSampler, 0);
  assert.equal(invariant.trueOnPolicyRlReady, true);
  assert.equal(invariant.vllmBatchInvariantEnv.VLLM_BATCH_INVARIANT, '1');

  const loraGood = evaluateLoraWithoutRegretPlan({
    mode: 'grpo',
    rank: 8,
    rlEpisodes: 2000,
    fullFtLearningRate: 0.00002,
  });
  assert.equal(loraGood.decision, 'allow');
  assert.equal(loraGood.hasMlpModules, true);
  assert.equal(loraGood.lrRatioToFullFt, 10);
  assert.equal(loraGood.flopsMultiplierVsFullFt, 0.667);

  const loraAttentionOnly = evaluateLoraWithoutRegretPlan({
    mode: 'sft',
    rank: 4,
    targetModules: ['q_proj', 'v_proj'],
    loraLearningRate: 0.00002,
    fullFtLearningRate: 0.00002,
  });
  assert.equal(loraAttentionOnly.decision, 'warn');
  assert.ok(loraAttentionOnly.issues.includes('attention_only_lora_underperforms_include_mlp_or_moe'));
  assert.ok(loraAttentionOnly.issues.includes('suboptimal_lora_lr_ratio_expected_10x_to_15x_full_ft'));

  const distill = buildOnPolicyDistillationPlan({ sequenceLengthTokens: 2048 });
  assert.equal(distill.method, 'on_policy_distillation_reverse_kl');
  assert.equal(distill.requiresGroundTruthVerifier, false);
  assert.equal(distill.supervisionDensityMultiplier, 2048);

  const split = planInteractionModelSplit({ targetMicroTurnLatencyMs: 200 });
  assert.equal(split.interactionLayer.targetTtftMs, 200);
  assert.equal(split.backgroundLayer.maxScopedToolsPerWorker, 4);
});
