#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_FEEDBACK_DIR = path.join(PROJECT_ROOT, '.claude', 'memory', 'feedback');
const DEFAULT_EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';

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

function resolveFeedbackDir(explicitDir) {
  return explicitDir || process.env.RLHF_FEEDBACK_DIR || DEFAULT_FEEDBACK_DIR;
}

function detectHardware(env = process.env) {
  const totalMemBytes = parseNumber(env.RLHF_RAM_BYTES_OVERRIDE, os.totalmem());
  const ramGb = Math.round((totalMemBytes / (1024 ** 3)) * 10) / 10;
  const cpuCount = Math.max(1, Math.floor(parseNumber(env.RLHF_CPU_COUNT_OVERRIDE, os.cpus().length || 1)));
  const platform = env.RLHF_PLATFORM_OVERRIDE || process.platform;
  const arch = env.RLHF_ARCH_OVERRIDE || process.arch;
  const ci = parseBoolean(env.CI, false);
  const accelerator = env.RLHF_ACCELERATOR
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
  const requestedProfile = String(env.RLHF_MODEL_FIT_PROFILE || 'auto').trim().toLowerCase();

  const baseProfile = requestedProfile !== 'auto' && EMBEDDING_PROFILES[requestedProfile]
    ? EMBEDDING_PROFILES[requestedProfile]
    : pickAutoProfile(hardware);

  const profile = cloneProfile(baseProfile);
  const source = requestedProfile !== 'auto' && EMBEDDING_PROFILES[requestedProfile]
    ? 'profile_override'
    : 'auto';

  if (env.RLHF_EMBED_MODEL) {
    profile.model = String(env.RLHF_EMBED_MODEL).trim();
  }
  profile.quantized = parseBoolean(env.RLHF_EMBED_QUANTIZED, profile.quantized);
  profile.maxChars = Math.max(256, Math.floor(parseNumber(env.RLHF_EMBED_MAX_CHARS, profile.maxChars)));

  const fallback = cloneProfile(EMBEDDING_PROFILES.balanced);
  fallback.id = 'fallback';

  return {
    source,
    hardware,
    selectedProfile: profile,
    fallbackProfile: fallback,
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

module.exports = {
  DEFAULT_EMBED_MODEL,
  DEFAULT_FEEDBACK_DIR,
  EMBEDDING_PROFILES,
  detectHardware,
  resolveEmbeddingProfile,
  buildModelFitReport,
  writeModelFitReport,
  getModelFitReportPath,
  resolveFeedbackDir,
};

if (require.main === module) {
  const report = buildModelFitReport();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
