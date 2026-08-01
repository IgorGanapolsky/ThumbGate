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

  // MCP hosts and desktop launchers commonly start global servers from `/` or
  // the user's home directory. Those are launcher contexts, not projects. If
  // they win resolution they create `projects/default` / `~/.thumbgate` split
  // stores and make the same lesson corpus depend on which client started the
  // process. A durable active-project state is a better signal.
  if (normalizedDir === path.parse(normalizedDir).root) return true;
  const homeDir = normalizeDir(getHomeDir(options));
  if (homeDir && normalizedDir === homeDir) return true;

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
  // An injected cwd is authoritative for callers that resolve on behalf of a
  // different process. Mixing in this Node process's cwd can silently route a
  // global launcher back into ThumbGate's own checkout during diagnostics.
  const cwdCandidates = uniquePaths(options.cwd
    ? [options.cwd]
    : [env.PWD, process.cwd()]);
  const isTransientExecution = cwdCandidates.length > 0
    && cwdCandidates.every((candidate) => isTransientProjectDir(candidate, options));
  const candidates = uniquePaths([
    options.projectDir,
    env.THUMBGATE_PROJECT_DIR,
    env.CLAUDE_PROJECT_DIR,
    isTransientExecution && stored && stored.projectDir,
    env.INIT_CWD,
    ...cwdCandidates,
    !isTransientExecution && stored && stored.projectDir,
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

function hasDirectProjectScope(options = {}) {
  const env = options.env || process.env;
  return Boolean(
    options.explicitProjectDir
    || env.THUMBGATE_PROJECT_DIR
    || env.CLAUDE_PROJECT_DIR
  );
}

function hasExplicitProjectScope(options = {}) {
  return Boolean(hasDirectProjectScope(options) || readActiveProjectState(options));
}

function getExplicitFeedbackDir(options = {}) {
  const env = options.env || process.env;
  if (options.feedbackDir) return options.feedbackDir;
  if (options.skipExplicitFeedbackDir) return null;
  // An explicit storage root is the strongest storage instruction. Project
  // metadata may still identify the project, but it must not redirect writes
  // out of an isolated test/runtime directory.
  if (env.THUMBGATE_FEEDBACK_DIR) {
    return env.THUMBGATE_FEEDBACK_DIR;
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
  const projectDir = resolveProjectDir(options);
  // A real project always owns one stable local store. Directory existence is
  // not a routing signal: using it caused a project to start in a basename-only
  // global store and then silently switch roots after `.thumbgate` was created.
  if (!isTransientProjectDir(projectDir, options)) return localThumbgate;

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
  hasDirectProjectScope,
  hasExplicitProjectScope,
  readActiveProjectState,
  listFallbackFeedbackDirs,
  listFeedbackArtifactPaths,
  resolveProjectDir,
  resolveFallbackArtifactPath,
  resolveFeedbackDir,
  writeActiveProjectState,
};
