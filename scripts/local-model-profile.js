#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveFeedbackDir: resolveSharedFeedbackDir } = require('./feedback-paths');

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
  return modelFamily.startsWith('deepseek') || modelFamily.startsWith('glm');
}

function resolveProviderMode(env = process.env) {
  const explicit = normalizeSlug(env.THUMBGATE_PROVIDER_MODE || env.THUMBGATE_MODEL_PROVIDER_MODE);
  if (explicit === 'local' || explicit === 'managed') return explicit;
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
  if (providerMode === 'managed') return 'Managed API backend';
  if (modelFamily.startsWith('deepseek')) return 'Local DeepSeek sparse backend';
  if (modelFamily.startsWith('glm')) return 'Local GLM sparse backend';
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
  const id = providerMode === 'managed'
    ? 'managed-api'
    : supportsSparseAttention
      ? `local-${modelFamily}-sparse`
      : 'local-dense';

  let rationale = 'Baseline backend with no sparse-attention acceleration.';
  if (providerMode === 'managed') {
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
  return {
    id: profile.id,
    model: profile.model,
    quantized: profile.quantized,
    maxChars: profile.maxChars,
    rationale: profile.rationale,
  };
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
  const model = (e[envKey] && String(e[envKey]).trim()) || MODEL_ROLES[normalized];
  return { role: normalized, model, provider: 'gemini', envKey };
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

module.exports = {
  DEFAULT_EMBED_MODEL,
  DEFAULT_FEEDBACK_DIR,
  EMBEDDING_PROFILES,
  INDEXCACHE_SERVER_ENGINES,
  LONG_CONTEXT_TAGS,
  LONG_CONTEXT_TASK_TYPES,
  MODEL_ROLES,
  VALID_MODEL_ROLES,
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
