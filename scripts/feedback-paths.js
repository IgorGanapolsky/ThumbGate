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

function getProjectName(cwd = process.cwd()) {
  return path.basename(cwd || PROJECT_ROOT) || 'default';
}

function getExplicitFeedbackDir(options = {}) {
  const env = options.env || process.env;
  if (options.feedbackDir) return options.feedbackDir;
  if (env.THUMBGATE_FEEDBACK_DIR) return env.THUMBGATE_FEEDBACK_DIR;
  if (env.RAILWAY_VOLUME_MOUNT_PATH) {
    return path.join(env.RAILWAY_VOLUME_MOUNT_PATH, 'feedback');
  }
  return null;
}

function getThumbgateFeedbackDir(options = {}) {
  const cwd = options.cwd || process.cwd();
  return path.join(cwd, '.thumbgate');
}

function getRlhfFeedbackDir(options = {}) {
  const env = options.env || process.env;
  if (env._TEST_RLHF_FEEDBACK_DIR) return env._TEST_RLHF_FEEDBACK_DIR;
  if (env.THUMBGATE_RLHF_FEEDBACK_DIR) return env.THUMBGATE_RLHF_FEEDBACK_DIR;
  const cwd = options.cwd || process.cwd();
  return path.join(cwd, '.rlhf');
}

function getLegacyFeedbackDir(options = {}) {
  const env = options.env || process.env;
  if (env._TEST_LEGACY_FEEDBACK_DIR) return env._TEST_LEGACY_FEEDBACK_DIR;
  if (env.THUMBGATE_LEGACY_FEEDBACK_DIR) return env.THUMBGATE_LEGACY_FEEDBACK_DIR;
  const cwd = options.cwd || process.cwd();
  return path.join(cwd, '.claude', 'memory', 'feedback');
}

function getGlobalFeedbackDir(options = {}) {
  const cwd = options.cwd || process.cwd();
  const home = options.home || HOME;
  return path.join(home, '.thumbgate', 'projects', getProjectName(cwd));
}

function resolveFeedbackDir(options = {}) {
  const explicit = getExplicitFeedbackDir(options);
  if (explicit) return explicit;

  const localThumbgate = getThumbgateFeedbackDir(options);
  if (dirExists(localThumbgate)) return localThumbgate;

  const localRlhf = getRlhfFeedbackDir(options);
  if (dirExists(localRlhf)) return localRlhf;

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
    getRlhfFeedbackDir(options),
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
  getFeedbackPaths,
  getGlobalFeedbackDir,
  getLegacyFeedbackDir,
  getRlhfFeedbackDir,
  getThumbgateFeedbackDir,
  listFallbackFeedbackDirs,
  listFeedbackArtifactPaths,
  resolveFallbackArtifactPath,
  resolveFeedbackDir,
};
