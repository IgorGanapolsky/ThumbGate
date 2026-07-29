'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  detectHardware,
  detectInferenceBackend,
  evaluateLocalInferenceBenchmark,
  localInferenceProofExitCode,
  probeLocalInference,
  recommendInferenceBackend,
  resolveEmbeddingProfile,
  resolveLocalInferenceConfig,
  writeModelFitReport,
  resolveModelRole,
  GLM_MODEL_ROLES,
  MODEL_ROLES,
  VALID_MODEL_ROLES,
} = require('../scripts/local-model-profile');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

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

test('resolveLocalInferenceConfig supports oMLX aliases without exposing the API key', () => {
  const config = resolveLocalInferenceConfig({
    THUMBGATE_OMLX_BASE_URL: 'http://127.0.0.1:8000/v1/',
    THUMBGATE_OMLX_MODEL: 'qwen3-0.6b-4bit',
    THUMBGATE_OMLX_API_KEY: 'runtime-only-secret',
    THUMBGATE_LOCAL_INFERENCE_SAMPLES: '4',
  });

  assert.equal(config.endpoint, 'http://127.0.0.1:8000/v1');
  assert.equal(config.model, 'qwen3-0.6b-4bit');
  assert.equal(config.samples, 4);
  assert.equal(config.authorizationConfigured, true);
  assert.equal('apiKey' in config, false);
  assert.equal(JSON.stringify(config).includes('runtime-only-secret'), false);
});

test('evaluateLocalInferenceBenchmark separates interactive and private batch routes', () => {
  const interactive = evaluateLocalInferenceBenchmark(
    [
      { ok: true, contractOk: true, latencyMs: 900, outputTokens: 9 },
      { ok: true, contractOk: true, latencyMs: 1100, outputTokens: 11 },
    ],
    { maxInteractiveLatencyMs: 1500 },
  );
  assert.equal(interactive.status, 'interactive_ready');
  assert.equal(interactive.route, 'interactive_local');
  assert.equal(interactive.successRate, 1);

  const batch = evaluateLocalInferenceBenchmark(
    [
      { ok: true, contractOk: true, latencyMs: 9000, outputTokens: 9 },
      { ok: true, contractOk: true, latencyMs: 12000, outputTokens: 11 },
    ],
    { maxInteractiveLatencyMs: 1500 },
  );
  assert.equal(batch.status, 'batch_ready');
  assert.equal(batch.route, 'private_batch_local');
  assert.ok(batch.blockedUses.includes('latency-sensitive interactive routing'));
});

test('evaluateLocalInferenceBenchmark does not route contract failures to production', () => {
  const evaluation = evaluateLocalInferenceBenchmark(
    [
      { ok: true, contractOk: false, latencyMs: 400, outputTokens: 8 },
    ],
    { maxInteractiveLatencyMs: 1500 },
  );

  assert.equal(evaluation.status, 'evaluation_only');
  assert.equal(evaluation.route, 'evaluation_only_local');
  assert.equal(evaluation.successRate, 1);
  assert.equal(evaluation.contractPassRate, 0);
  assert.ok(evaluation.blockedUses.includes('autonomous actions'));
  assert.equal(localInferenceProofExitCode({ evaluation }), 1);
  assert.equal(
    localInferenceProofExitCode({
      evaluation: { status: 'interactive_ready' },
    }),
    0,
  );
});

test('probeLocalInference verifies models and non-empty chat responses', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/models')) {
      return jsonResponse({
        data: [{ id: 'qwen3-0.6b-4bit' }],
      });
    }
    return jsonResponse({
      choices: [{ message: { content: 'READY' } }],
      usage: { completion_tokens: 1 },
    });
  };
  const ticks = [1000, 1800, 2000, 2900];
  const proof = await probeLocalInference({
    env: {
      THUMBGATE_OMLX_BASE_URL: 'http://127.0.0.1:8000/v1',
      THUMBGATE_OMLX_MODEL: 'qwen3-0.6b-4bit',
    },
    fetchImpl,
    now: () => ticks.shift(),
    samples: 2,
    maxInteractiveLatencyMs: 1000,
  });

  assert.equal(proof.endpointReady, true);
  assert.equal(proof.model, 'qwen3-0.6b-4bit');
  assert.equal(proof.samples.length, 2);
  assert.equal(proof.samples.every((sample) => sample.contractOk), true);
  assert.equal(proof.evaluation.status, 'interactive_ready');
  assert.equal(proof.evaluation.contractPassRate, 1);
  assert.equal(proof.evaluation.p95LatencyMs, 900);
  assert.equal(calls.length, 3);
  assert.equal(calls.some((call) => call.init.headers.authorization), false);
});

test('probeLocalInference fails closed when the models endpoint is unavailable', async () => {
  const proof = await probeLocalInference({
    env: {},
    fetchImpl: async () => jsonResponse({ error: 'offline' }, 503),
    samples: 1,
  });

  assert.equal(proof.endpointReady, false);
  assert.equal(proof.evaluation.status, 'unavailable');
  assert.equal(proof.evaluation.route, 'managed_fallback');
  assert.equal(proof.error, 'http_503');
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
    assert.equal(
      typeof GLM_MODEL_ROLES[role],
      'string',
      `GLM_MODEL_ROLES must contain a string for role: ${role}`,
    );
    assert.ok(GLM_MODEL_ROLES[role].length > 0, `GLM_MODEL_ROLES missing role: ${role}`);
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
