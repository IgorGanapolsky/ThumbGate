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
  MODEL_ROLES,
  VALID_MODEL_ROLES,
} = require('../scripts/local-model-profile');

test('detectHardware respects env overrides', () => {
  const hardware = detectHardware({
    RLHF_RAM_BYTES_OVERRIDE: String(6 * 1024 ** 3),
    RLHF_CPU_COUNT_OVERRIDE: '4',
    RLHF_PLATFORM_OVERRIDE: 'linux',
    RLHF_ARCH_OVERRIDE: 'x64',
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
    RLHF_RAM_BYTES_OVERRIDE: String(4 * 1024 ** 3),
    RLHF_CPU_COUNT_OVERRIDE: '4',
  });

  assert.equal(resolved.selectedProfile.id, 'compact');
  assert.equal(resolved.selectedProfile.quantized, true);
});

test('resolveEmbeddingProfile honors explicit env overrides', () => {
  const resolved = resolveEmbeddingProfile({
    RLHF_MODEL_FIT_PROFILE: 'quality',
    RLHF_EMBED_MODEL: 'custom/model',
    RLHF_EMBED_QUANTIZED: 'false',
    RLHF_EMBED_MAX_CHARS: '1234',
    RLHF_RAM_BYTES_OVERRIDE: String(32 * 1024 ** 3),
    RLHF_CPU_COUNT_OVERRIDE: '10',
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
        RLHF_RAM_BYTES_OVERRIDE: String(12 * 1024 ** 3),
        RLHF_CPU_COUNT_OVERRIDE: '8',
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
  const result = resolveModelRole('normal', { RLHF_MODEL_ROLE_NORMAL: 'gemini-custom-model' });
  assert.equal(result.model, 'gemini-custom-model');
});

test('resolveModelRole throws on unknown role', () => {
  assert.throws(() => resolveModelRole('nonexistent', {}), /Unknown model role/);
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
    RLHF_PROVIDER_MODE: 'local',
    RLHF_LOCAL_MODEL_FAMILY: 'deepseek-r1',
    RLHF_LOCAL_MODEL_SERVER: 'sglang',
    RLHF_INDEXCACHE_ENABLED: 'true',
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
    RLHF_PROVIDER_MODE: 'local',
    RLHF_LOCAL_MODEL_FAMILY: 'glm-4.5',
    RLHF_LOCAL_MODEL_SERVER: 'vllm',
  });

  assert.equal(recommendation.workloadClass, 'long_context');
  assert.equal(recommendation.recommendationClass, 'indexcache_eligible');
  assert.equal(recommendation.backend.indexCacheEligible, true);
});
