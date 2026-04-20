#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { getRuntimeDir, resolveProjectDir } = require('./feedback-paths');

const FIXED_GH_BINARIES = [
  '/usr/bin/gh',
  '/usr/local/bin/gh',
  '/opt/homebrew/bin/gh',
];
const FIXED_GIT_BINARIES = [
  '/usr/bin/git',
  '/usr/local/bin/git',
  '/opt/homebrew/bin/git',
];

const CONTEXT_CACHE_MAX_AGE_MS = 120000;

function contextCachePath(options = {}) {
  return path.join(getRuntimeDir(options), 'statusline-context.json');
}

function readContextCache(options = {}) {
  try {
    return JSON.parse(fs.readFileSync(contextCachePath(options), 'utf8'));
  } catch {
    return null;
  }
}

function writeContextCache(payload, options = {}) {
  const targetPath = contextCachePath(options);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2) + '\n');
  return targetPath;
}

function isFreshCache(cache, now = Date.now()) {
  if (!cache || !cache.updatedAt) {
    return false;
  }

  const updatedAt = Date.parse(cache.updatedAt);
  if (!Number.isFinite(updatedAt)) {
    return false;
  }

  return (now - updatedAt) <= CONTEXT_CACHE_MAX_AGE_MS;
}

function resolveGhBinary(accessSync = fs.accessSync) {
  for (const candidate of FIXED_GH_BINARIES) {
    try {
      accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function resolveGitBinary(options = {}) {
  const env = options.env || process.env;
  const configuredBinary = String(env.THUMBGATE_GIT_BIN || '').trim();
  const candidates = configuredBinary
    ? [configuredBinary, ...FIXED_GIT_BINARIES]
    : FIXED_GIT_BINARIES;

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs || 400,
  });

  if (result.status !== 0) {
    return '';
  }

  return String(result.stdout || '').trim();
}

function getBranchName(projectDir) {
  if (!projectDir) {
    return '';
  }

  const gitBinary = resolveGitBinary();
  if (!gitBinary) {
    return '';
  }

  return runCommand(gitBinary, ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: projectDir, timeoutMs: 300 });
}

function inferWorkItemLabel(branchName = '') {
  const normalized = String(branchName || '').trim();
  if (!normalized) {
    return '';
  }

  const explicitMatch = normalized.match(/(?:^|[/-])(AB#\d+)(?:$|[/-])/i);
  if (explicitMatch) {
    return explicitMatch[1].toUpperCase();
  }

  const numericMatch = normalized.match(/(?:^|[/-])(\d{4,})(?:$|[/-])/);
  if (!numericMatch) {
    return '';
  }

  return `AB#${numericMatch[1]}`;
}

function getPrNumber(projectDir, options = {}) {
  if (!projectDir) {
    return '';
  }

  const ghBinary = options.ghBinary || resolveGhBinary(options.accessSync);
  if (!ghBinary) {
    return '';
  }

  const prNumber = runCommand(
    ghBinary,
    ['pr', 'view', '--json', 'number', '--jq', '.number'],
    { cwd: projectDir, timeoutMs: options.timeoutMs || 1000 }
  );
  return /^\d+$/.test(prNumber) ? prNumber : '';
}

function getStatuslineContext(options = {}) {
  const env = options.env || process.env;
  if (env._TEST_THUMBGATE_STATUSLINE_CONTEXT_JSON) {
    return JSON.parse(env._TEST_THUMBGATE_STATUSLINE_CONTEXT_JSON);
  }

  const projectDir = resolveProjectDir({ env, cwd: options.cwd || process.cwd() });
  const cache = readContextCache({ env, home: options.homeDir });
  const branchName = (env.THUMBGATE_STATUSLINE_BRANCH || '').trim() || getBranchName(projectDir);
  const workItemLabel = (env.THUMBGATE_STATUSLINE_WORK_ITEM || '').trim() || inferWorkItemLabel(branchName);

  let prNumber = (env.THUMBGATE_STATUSLINE_PR_NUMBER || '').trim();
  if (!prNumber && cache && cache.projectDir === projectDir && cache.branchName === branchName && isFreshCache(cache)) {
    prNumber = String(cache.prNumber || '').trim();
  }
  if (!prNumber) {
    prNumber = getPrNumber(projectDir, options);
  }

  const payload = {
    branchName,
    workItemLabel,
    prNumber,
    prLabel: prNumber ? `PR #${prNumber}` : '',
    projectDir,
    updatedAt: new Date().toISOString(),
  };
  writeContextCache(payload, { env, home: options.homeDir });
  return payload;
}

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  return invokedPath ? path.resolve(invokedPath) === __filename : false;
}

if (isCliInvocation()) {
  try {
    process.stdout.write(JSON.stringify(getStatuslineContext()));
  } catch {
    process.exit(0);
  }
}

module.exports = {
  CONTEXT_CACHE_MAX_AGE_MS,
  contextCachePath,
  getBranchName,
  getPrNumber,
  getStatuslineContext,
  inferWorkItemLabel,
  isFreshCache,
  readContextCache,
  resolveGhBinary,
  resolveGitBinary,
  writeContextCache,
};
