#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir() || '';

function buildFeedbackPathsFromDir(dirPath) {
  return {
    FEEDBACK_DIR: dirPath,
    FEEDBACK_LOG_PATH: path.join(dirPath, 'feedback-log.jsonl'),
    DIAGNOSTIC_LOG_PATH: path.join(dirPath, 'diagnostic-log.jsonl'),
    MEMORY_LOG_PATH: path.join(dirPath, 'memory-log.jsonl'),
    REJECTION_LEDGER_PATH: path.join(dirPath, 'rejection-ledger.jsonl'),
    SUMMARY_PATH: path.join(dirPath, 'feedback-summary.json'),
    PREVENTION_RULES_PATH: path.join(dirPath, 'prevention-rules.md'),
  };
}

function uniquePaths(paths = []) {
  const seen = new Set();
  const unique = [];

  for (const candidate of paths) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    unique.push(candidate);
  }

  return unique;
}

function dirExists(dirPath) {
  try {
    return Boolean(dirPath && fs.existsSync(dirPath));
  } catch {
    return false;
  }
}

function getHomeDir(options = {}) {
  const env = options.env || process.env;
  return options.home || env.HOME || env.USERPROFILE || HOME;
}

function normalizeDir(dirPath) {
  if (!dirPath) return null;
  try {
    return path.resolve(String(dirPath));
  } catch {
    return null;
  }
}

function isWithinDir(candidate, parent) {
  const normalizedCandidate = normalizeDir(candidate);
  const normalizedParent = normalizeDir(parent);
  if (!normalizedCandidate || !normalizedParent) return false;
  const relative = path.relative(normalizedParent, normalizedCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function getRuntimeDir(options = {}) {
  return path.join(getHomeDir(options), '.thumbgate', 'runtime');
}

function getActiveProjectStatePath(options = {}) {
  return path.join(getRuntimeDir(options), 'active-project.json');
}

function isTransientProjectDir(dirPath, options = {}) {
  const normalizedDir = normalizeDir(dirPath);
  if (!normalizedDir) return true;
  if (!dirExists(normalizedDir)) return true;

  const runtimeDir = getRuntimeDir(options);
  if (isWithinDir(normalizedDir, runtimeDir)) return true;

  return normalizedDir.includes(`${path.sep}.npm${path.sep}_npx${path.sep}`)
    || /thumbgate-published-cli-/i.test(normalizedDir);
}

function readActiveProjectState(options = {}) {
  const statePath = getActiveProjectStatePath(options);
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!parsed || !parsed.projectDir) return null;
    if (isTransientProjectDir(parsed.projectDir, options)) return null;
    return {
      ...parsed,
      projectDir: normalizeDir(parsed.projectDir),
    };
  } catch {
    return null;
  }
}

function writeActiveProjectState(projectDir, options = {}) {
  const normalizedDir = normalizeDir(projectDir);
  if (isTransientProjectDir(normalizedDir, options)) return null;

  const payload = {
    projectDir: normalizedDir,
    projectName: path.basename(normalizedDir) || 'default',
    updatedAt: new Date().toISOString(),
  };

  const statePath = getActiveProjectStatePath(options);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(payload, null, 2));
  return payload;
}

function resolveProjectDir(options = {}) {
  const env = options.env || process.env;
  const stored = options.includeStored === false ? null : readActiveProjectState(options);
  const candidates = uniquePaths([
    options.projectDir,
    env.THUMBGATE_PROJECT_DIR,
    env.CLAUDE_PROJECT_DIR,
    env.INIT_CWD,
    options.cwd,
    env.PWD,
    stored && stored.projectDir,
    process.cwd(),
  ]);

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!isTransientProjectDir(candidate, options)) {
      return normalizeDir(candidate);
    }
  }

  return normalizeDir(options.cwd || env.PWD || PROJECT_ROOT) || PROJECT_ROOT;
}

function getProjectName(cwd = process.cwd()) {
  return path.basename(cwd || PROJECT_ROOT) || 'default';
}

function hasExplicitProjectScope(options = {}) {
  const env = options.env || process.env;
  return Boolean(
    env.THUMBGATE_PROJECT_DIR
    || env.CLAUDE_PROJECT_DIR
    || readActiveProjectState(options)
  );
}

function getExplicitFeedbackDir(options = {}) {
  const env = options.env || process.env;
  if (options.feedbackDir) return options.feedbackDir;
  if (options.skipExplicitFeedbackDir) return null;
  if (env.THUMBGATE_FEEDBACK_DIR && !hasExplicitProjectScope(options)) {
    return env.THUMBGATE_FEEDBACK_DIR;
  }
  if (hasExplicitProjectScope(options)) {
    return null;
  }
  if (env.RAILWAY_VOLUME_MOUNT_PATH) {
    return path.join(env.RAILWAY_VOLUME_MOUNT_PATH, 'feedback');
  }
  return null;
}

function getThumbgateFeedbackDir(options = {}) {
  const projectDir = resolveProjectDir(options);
  return path.join(projectDir, '.thumbgate');
}

function getFallbackFeedbackDir(options = {}) {
  const env = options.env || process.env;
  if (env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR) return env._TEST_THUMBGATE_FALLBACK_FEEDBACK_DIR;
  if (env.THUMBGATE_FALLBACK_FEEDBACK_DIR) return env.THUMBGATE_FALLBACK_FEEDBACK_DIR;
  const projectDir = resolveProjectDir(options);
  return path.join(projectDir, '.thumbgate-compat');
}

function getLegacyFeedbackDir(options = {}) {
  const env = options.env || process.env;
  if (env._TEST_LEGACY_FEEDBACK_DIR) return env._TEST_LEGACY_FEEDBACK_DIR;
  if (env.THUMBGATE_LEGACY_FEEDBACK_DIR) return env.THUMBGATE_LEGACY_FEEDBACK_DIR;
  const projectDir = resolveProjectDir(options);
  return path.join(projectDir, '.claude', 'memory', 'feedback');
}

function getGlobalFeedbackDir(options = {}) {
  const projectDir = resolveProjectDir(options);
  return path.join(getHomeDir(options), '.thumbgate', 'projects', getProjectName(projectDir));
}

function resolveFeedbackDir(options = {}) {
  const explicit = getExplicitFeedbackDir(options);
  if (explicit) return explicit;

  const localThumbgate = getThumbgateFeedbackDir(options);
  if (dirExists(localThumbgate)) return localThumbgate;

  const localFallback = getFallbackFeedbackDir(options);
  if (dirExists(localFallback)) return localFallback;

  const localLegacy = getLegacyFeedbackDir(options);
  if (dirExists(localLegacy)) return localLegacy;

  return getGlobalFeedbackDir(options);
}

function getFeedbackPaths(options = {}) {
  return buildFeedbackPathsFromDir(resolveFeedbackDir(options));
}

function listFallbackFeedbackDirs(options = {}) {
  const activeDir = path.resolve(resolveFeedbackDir(options));
  return uniquePaths([
    getFallbackFeedbackDir(options),
    getLegacyFeedbackDir(options),
  ]).filter((dirPath) => path.resolve(dirPath) !== activeDir);
}

function listFeedbackArtifactPaths(fileName, options = {}) {
  if (!fileName) return [];
  const activeDir = resolveFeedbackDir(options);
  return uniquePaths([
    path.join(activeDir, fileName),
    ...listFallbackFeedbackDirs(options).map((dirPath) => path.join(dirPath, fileName)),
  ]);
}

function resolveFallbackArtifactPath(fileName, options = {}) {
  const fallbackPaths = listFallbackFeedbackDirs(options).map((dirPath) => path.join(dirPath, fileName));
  for (const candidate of fallbackPaths) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return fallbackPaths[0] || null;
}

module.exports = {
  PROJECT_ROOT,
  HOME,
  buildFeedbackPathsFromDir,
  getActiveProjectStatePath,
  getFeedbackPaths,
  getGlobalFeedbackDir,
  getHomeDir,
  getLegacyFeedbackDir,
  getFallbackFeedbackDir,
  getRuntimeDir,
  getThumbgateFeedbackDir,
  hasExplicitProjectScope,
  readActiveProjectState,
  listFallbackFeedbackDirs,
  listFeedbackArtifactPaths,
  resolveProjectDir,
  resolveFallbackArtifactPath,
  resolveFeedbackDir,
  writeActiveProjectState,
};
