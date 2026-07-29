#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveFeedbackDir: resolveSharedFeedbackDir } = require('./feedback-paths');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_FEEDBACK_DIR = resolveSharedFeedbackDir();
const DEFAULT_EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_LOCAL_LLM_ENDPOINT = 'http://127.0.0.1:8000/v1';
const DEFAULT_LOCAL_INFERENCE_SAMPLES = 3;
const DEFAULT_LOCAL_INFERENCE_TIMEOUT_MS = 30000;
const DEFAULT_INTERACTIVE_LATENCY_MS = 8000;

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

// GLM 5.1 open-source model IDs for self-hosted local inference.
// Activate by setting THUMBGATE_LOCAL_MODEL_FAMILY=glm-z1 (or any glm-* variant).
// Each role can still be overridden via THUMBGATE_MODEL_ROLE_<ROLE>.
const GLM_MODEL_ROLES = {
  normal: 'glm-z1-9b',
  thinking: 'glm-z1-32b',
  critique: 'glm-z1-9b',
  compaction: 'glm-4-9b',
  vlm: 'glm-4v-9b',
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

function normalizeEndpoint(value) {
  const endpoint = String(value || DEFAULT_LOCAL_LLM_ENDPOINT).trim();
  return endpoint.replace(/\/+$/, '');
}

function clampInteger(value, fallback, min, max) {
  const parsed = Math.floor(parseNumber(value, fallback));
  return Math.max(min, Math.min(max, parsed));
}

function resolveLocalInferenceConfig(env = process.env, overrides = {}) {
  const endpoint = normalizeEndpoint(
    overrides.endpoint
      || env.THUMBGATE_LOCAL_LLM_ENDPOINT
      || env.THUMBGATE_OMLX_BASE_URL
      || env.THUMBGATE_LOCAL_MODEL_ENDPOINT,
  );
  const model = String(
    overrides.model
      || env.THUMBGATE_OMLX_MODEL
      || env.THUMBGATE_LOCAL_MODEL
      || env.THUMBGATE_MODEL_ID
      || '',
  ).trim();
  const samples = clampInteger(
    overrides.samples ?? env.THUMBGATE_LOCAL_INFERENCE_SAMPLES,
    DEFAULT_LOCAL_INFERENCE_SAMPLES,
    1,
    10,
  );
  const timeoutMs = clampInteger(
    overrides.timeoutMs ?? env.THUMBGATE_LOCAL_INFERENCE_TIMEOUT_MS,
    DEFAULT_LOCAL_INFERENCE_TIMEOUT_MS,
    1000,
    120000,
  );
  const maxInteractiveLatencyMs = clampInteger(
    overrides.maxInteractiveLatencyMs ?? env.THUMBGATE_LOCAL_INTERACTIVE_LATENCY_MS,
    DEFAULT_INTERACTIVE_LATENCY_MS,
    250,
    120000,
  );
  const apiKey = String(
    overrides.apiKey
      || env.THUMBGATE_OMLX_API_KEY
      || env.THUMBGATE_LOCAL_LLM_API_KEY
      || '',
  ).trim();

  return {
    endpoint,
    model,
    samples,
    timeoutMs,
    maxInteractiveLatencyMs,
    authorizationConfigured: Boolean(apiKey),
  };
}

function resolveLocalAuthorization(env = process.env, overrides = {}) {
  const apiKey = String(
    overrides.apiKey
      || env.THUMBGATE_OMLX_API_KEY
      || env.THUMBGATE_LOCAL_LLM_API_KEY
      || '',
  ).trim();
  return apiKey ? `Bearer ${apiKey}` : '';
}

async function fetchJson(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const body = await response.text();
    let payload = {};
    if (body) {
      try {
        payload = JSON.parse(body);
      } catch {
        throw new Error(`non_json_response:${response.status}`);
      }
    }
    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }
    return { status: response.status, payload };
  } finally {
    clearTimeout(timeout);
  }
}

function percentile(values, pct) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function extractAssistantText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join(' ')
    .trim();
}

function evaluateLocalInferenceBenchmark(samples, options = {}) {
  const maxInteractiveLatencyMs = clampInteger(
    options.maxInteractiveLatencyMs,
    DEFAULT_INTERACTIVE_LATENCY_MS,
    250,
    120000,
  );
  const successful = samples.filter((sample) => sample.ok);
  const contractPassing = successful.filter((sample) => sample.contractOk);
  const latencies = successful.map((sample) => sample.latencyMs);
  const totalOutputTokens = successful.reduce(
    (sum, sample) => sum + Number(sample.outputTokens || 0),
    0,
  );
  const totalLatencyMs = latencies.reduce((sum, value) => sum + value, 0);
  const successRate = samples.length > 0 ? successful.length / samples.length : 0;
  const contractPassRate = samples.length > 0
    ? contractPassing.length / samples.length
    : 0;
  const p50LatencyMs = percentile(latencies, 50);
  const p95LatencyMs = percentile(latencies, 95);
  const tokensPerSecond = totalLatencyMs > 0
    ? totalOutputTokens / (totalLatencyMs / 1000)
    : null;

  let status = 'unavailable';
  let route = 'managed_fallback';
  let reason = 'local inference did not return a non-empty assistant response for every sample.';
  if (
    successRate === 1
    && contractPassRate === 1
    && p95LatencyMs !== null
    && p95LatencyMs <= maxInteractiveLatencyMs
  ) {
    status = 'interactive_ready';
    route = 'interactive_local';
    reason = `local inference passed every response contract within the ${maxInteractiveLatencyMs}ms interactive latency budget.`;
  } else if (successRate === 1 && contractPassRate === 1) {
    status = 'batch_ready';
    route = 'private_batch_local';
    reason = `local inference passed every response contract, but p95 latency exceeded the ${maxInteractiveLatencyMs}ms interactive budget.`;
  } else if (successRate === 1) {
    status = 'evaluation_only';
    route = 'evaluation_only_local';
    reason = 'local inference returned non-empty responses, but at least one deterministic response contract failed.';
  }

  return {
    status,
    route,
    reason,
    successRate: Number(successRate.toFixed(4)),
    contractPassRate: Number(contractPassRate.toFixed(4)),
    contractPassingSamples: contractPassing.length,
    successfulSamples: successful.length,
    totalSamples: samples.length,
    p50LatencyMs,
    p95LatencyMs,
    maxInteractiveLatencyMs,
    totalOutputTokens,
    tokensPerSecond: tokensPerSecond === null
      ? null
      : Number(tokensPerSecond.toFixed(3)),
    recommendedUses: status === 'interactive_ready'
      ? ['private retrieval', 'classification', 'policy support', 'interactive local chat']
      : status === 'batch_ready'
        ? ['private retrieval', 'offline classification', 'batch policy analysis']
        : status === 'evaluation_only'
          ? ['private experimentation', 'model evaluation']
        : [],
    blockedUses: status === 'interactive_ready'
      ? []
      : status === 'batch_ready'
        ? ['latency-sensitive interactive routing']
        : status === 'evaluation_only'
          ? ['production routing', 'policy decisions', 'autonomous actions']
        : ['production routing'],
  };
}

function localInferenceProofExitCode(result) {
  return String(result?.evaluation?.status || '').endsWith('_ready') ? 0 : 1;
}

async function probeLocalInference(options = {}) {
  const env = options.env || process.env;
  const config = resolveLocalInferenceConfig(env, options);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch_unavailable');
  }
  const now = options.now || (() => Date.now());
  const headers = { 'content-type': 'application/json' };
  const authorization = resolveLocalAuthorization(env, options);
  if (authorization) headers.authorization = authorization;

  let model = config.model;
  let models = [];
  try {
    const response = await fetchJson(
      fetchImpl,
      `${config.endpoint}/models`,
      { method: 'GET', headers },
      config.timeoutMs,
    );
    models = Array.isArray(response.payload?.data)
      ? response.payload.data.map((item) => String(item?.id || '')).filter(Boolean)
      : [];
    model = model || models[0] || '';
  } catch (error) {
    return {
      generatedAt: new Date().toISOString(),
      provider: 'openai-compatible-local',
      endpoint: config.endpoint,
      model,
      models,
      authorizationConfigured: config.authorizationConfigured,
      endpointReady: false,
      samples: [],
      evaluation: evaluateLocalInferenceBenchmark([], config),
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!model) {
    return {
      generatedAt: new Date().toISOString(),
      provider: 'openai-compatible-local',
      endpoint: config.endpoint,
      model: '',
      models,
      authorizationConfigured: config.authorizationConfigured,
      endpointReady: true,
      samples: [],
      evaluation: evaluateLocalInferenceBenchmark([], config),
      error: 'models_empty',
    };
  }

  const samples = [];
  for (let index = 0; index < config.samples; index += 1) {
    const startedAt = now();
    try {
      const response = await fetchJson(
        fetchImpl,
        `${config.endpoint}/chat/completions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content: 'You are a deterministic health probe. Output exactly READY and nothing else.',
              },
              {
                role: 'user',
                content: '/no_think\nOutput exactly READY.',
              },
            ],
            temperature: 0,
            max_tokens: 16,
          }),
        },
        config.timeoutMs,
      );
      const text = extractAssistantText(response.payload);
      const latencyMs = Math.max(0, Math.round(now() - startedAt));
      samples.push({
        index: index + 1,
        ok: Boolean(text),
        contractOk: text === 'READY',
        latencyMs,
        outputTokens: Number(
          response.payload?.usage?.completion_tokens
            ?? response.payload?.usage?.output_tokens
            ?? 0,
        ),
        textPreview: text.slice(0, 80),
        error: text ? null : 'empty_assistant_response',
      });
    } catch (error) {
      samples.push({
        index: index + 1,
        ok: false,
        contractOk: false,
        latencyMs: Math.max(0, Math.round(now() - startedAt)),
        outputTokens: 0,
        textPreview: '',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    provider: 'openai-compatible-local',
    endpoint: config.endpoint,
    model,
    models,
    authorizationConfigured: config.authorizationConfigured,
    endpointReady: true,
    samples,
    evaluation: evaluateLocalInferenceBenchmark(samples, config),
  };
}

function isSparseAttentionFamily(modelFamily) {
  return modelFamily.startsWith('deepseek') || modelFamily.startsWith('glm');
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
  const modelFamily = resolveModelFamily(e);
  const isLocalGlm = modelFamily.startsWith('glm');
  const providerMode = resolveProviderMode(e);
  const provider = isLocalGlm ? 'local' : (providerMode === 'vertex' ? 'vertex' : 'gemini');
  const defaultModel = isLocalGlm ? (GLM_MODEL_ROLES[normalized] || MODEL_ROLES[normalized]) : MODEL_ROLES[normalized];
  const model = (e[envKey] && String(e[envKey]).trim()) || defaultModel;
  return { role: normalized, model, provider, envKey };
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
  DEFAULT_INTERACTIVE_LATENCY_MS,
  DEFAULT_LOCAL_INFERENCE_SAMPLES,
  DEFAULT_LOCAL_INFERENCE_TIMEOUT_MS,
  DEFAULT_LOCAL_LLM_ENDPOINT,
  EMBEDDING_PROFILES,
  GLM_MODEL_ROLES,
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
  evaluateLocalInferenceBenchmark,
  localInferenceProofExitCode,
  probeLocalInference,
  recommendInferenceBackend,
  resolveFeedbackDir,
  resolveLocalInferenceConfig,
};

async function main(argv = process.argv.slice(2)) {
  const probe = argv.includes('--probe');
  const samplesArg = argv.find((arg) => arg.startsWith('--samples='));
  const maxLatencyArg = argv.find((arg) => arg.startsWith('--max-interactive-latency-ms='));
  if (!probe) {
    const report = buildModelFitReport();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  const result = await probeLocalInference({
    samples: samplesArg ? samplesArg.split('=', 2)[1] : undefined,
    maxInteractiveLatencyMs: maxLatencyArg
      ? maxLatencyArg.split('=', 2)[1]
      : undefined,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return localInferenceProofExitCode(result);
}

module.exports.main = main;

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(__filename)
) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
