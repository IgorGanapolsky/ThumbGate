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
