#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const DEFAULT_BASE_BRANCH = 'main';
const DEFAULT_RELEASE_SENSITIVE_GLOBS = [
  'package.json',
  'package-lock.json',
  'server.json',
  '.github/workflows/ci.yml',
  '.github/workflows/publish-*.yml',
  'scripts/publish-decision.js',
  'scripts/pr-manager.js',
  'scripts/gates-engine.js',
  'scripts/tool-registry.js',
  'src/api/server.js',
  'adapters/mcp/server-stdio.js',
  'config/gates/**',
  'config/mcp-allowlists.json',
];

function normalizePosix(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .trim();
}

function normalizeGlob(glob) {
  return normalizePosix(glob).replace(/\/+$/, '');
}

function sanitizeGlobList(globs) {
  if (!Array.isArray(globs)) return [];
  return [...new Set(globs.map((glob) => normalizeGlob(glob)).filter(Boolean))];
}

function globToRegExp(glob) {
  const normalized = normalizeGlob(glob);
  let pattern = '^';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === '*') {
      if (next === '*') {
        pattern += '.*';
        i += 1;
      } else {
        pattern += '[^/]*';
      }
      continue;
    }
    if ('\\^$+?.()|{}[]'.includes(char)) {
      pattern += `\\${char}`;
      continue;
    }
    pattern += char;
  }
  pattern += '$';
  return new RegExp(pattern);
}

function matchesAnyGlob(filePath, globs) {
  const normalized = sanitizeGlobList(globs);
  if (!filePath || normalized.length === 0) return false;
  return normalized.some((glob) => {
    try {
      return globToRegExp(glob).test(normalizePosix(filePath));
    } catch {
      return false;
    }
  });
}

function runGit(repoPath, args) {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function tryRunGit(repoPath, args) {
  try {
    return runGit(repoPath, args);
  } catch {
    return '';
  }
}

function resolveRepoRoot(repoPath = process.cwd()) {
  try {
    return runGit(repoPath, ['rev-parse', '--show-toplevel']);
  } catch {
    return null;
  }
}

function gitRefExists(repoPath, ref) {
  if (!repoPath || !ref) return false;
  try {
    execFileSync('git', ['rev-parse', '--verify', ref], {
      cwd: repoPath,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function isSafeBranchName(branchName) {
  const normalized = String(branchName || '').trim();
  if (!normalized) return false;
  if (normalized.startsWith('-')) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(normalized)) return false;
  if (normalized.includes('..') || normalized.includes('//') || normalized.includes('@{')) return false;
  if (normalized.endsWith('.') || normalized.endsWith('/')) return false;
  return true;
}

function fetchBaseBranch(repoPath, baseBranch) {
  if (!repoPath || !isSafeBranchName(baseBranch)) return false;
  // Fetch the remote tracking refs without passing user-controlled branch names to git.
  const result = spawnSync('git', ['fetch', '--no-tags', '--depth=64', 'origin'], {
    cwd: repoPath,
    encoding: 'utf8',
  });
  return result.status === 0;
}

function resolveBaseRef(repoPath, baseBranch = DEFAULT_BASE_BRANCH, { fetchIfMissing = false } = {}) {
  if (!isSafeBranchName(baseBranch)) return null;
  const remoteRef = `refs/remotes/origin/${baseBranch}`;
  if (gitRefExists(repoPath, remoteRef)) {
    return `origin/${baseBranch}`;
  }
  if (fetchIfMissing) {
    fetchBaseBranch(repoPath, baseBranch);
    if (gitRefExists(repoPath, remoteRef)) {
      return `origin/${baseBranch}`;
    }
  }
  if (gitRefExists(repoPath, baseBranch)) {
    return baseBranch;
  }
  return null;
}

function getCurrentBranch(repoPath) {
  return tryRunGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']) || null;
}

function getHeadSha(repoPath) {
  return tryRunGit(repoPath, ['rev-parse', 'HEAD']) || null;
}

function readPackageVersion(repoPath, ref = 'HEAD') {
  try {
    let raw;
    if (ref === 'HEAD') {
      raw = fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8');
    } else {
      raw = runGit(repoPath, ['show', `${ref}:package.json`]);
    }
    return JSON.parse(raw).version || null;
  } catch {
    return null;
  }
}

function parseSemver(version) {
  const match = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return match.slice(1).map((part) => Number(part));
}

function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

function listChangedFilesAgainstBase(repoPath, baseBranch = DEFAULT_BASE_BRANCH, { fetchIfMissing = false } = {}) {
  const baseRef = resolveBaseRef(repoPath, baseBranch, { fetchIfMissing });
  if (!baseRef) return [];
  const diff = tryRunGit(repoPath, ['diff', '--name-only', `${baseRef}...HEAD`]);
  return diff.split('\n').map((line) => normalizePosix(line)).filter(Boolean);
}

function findReleaseSensitiveFiles(files, globs = DEFAULT_RELEASE_SENSITIVE_GLOBS) {
  return (Array.isArray(files) ? files : []).filter((filePath) => matchesAnyGlob(filePath, globs));
}

function isHeadReachableFrom(repoPath, ref, commit = 'HEAD') {
  if (!repoPath || !ref) return false;
  const result = spawnSync('git', ['merge-base', '--is-ancestor', commit, ref], {
    cwd: repoPath,
    encoding: 'utf8',
  });
  return result.status === 0;
}

function runGh(args) {
  return spawnSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function findOpenPrForBranch({ branchName, runner = runGh } = {}) {
  const normalizedBranch = String(branchName || '').trim();
  if (!normalizedBranch) return null;
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    return null;
  }
  const result = runner(['pr', 'list', '--head', normalizedBranch, '--state', 'open', '--json', 'number,state,isDraft,url']);
  if (!result || result.status !== 0) {
    return null;
  }
  try {
    const prs = JSON.parse(result.stdout || '[]');
    return Array.isArray(prs) && prs.length > 0 ? prs[0] : null;
  } catch {
    return null;
  }
}

function classifyCommand(command) {
  const text = String(command || '').trim();
  return {
    text,
    isPrCreate: /\bgh\s+pr\s+create\b/i.test(text),
    isPrMerge: /\bgh\s+pr\s+merge\b/i.test(text),
    isPublish: /\b(?:npm|yarn|pnpm)\s+publish\b/i.test(text),
    isReleaseCreate: /\bgh\s+release\s+create\b/i.test(text),
    isTagCreate: /\bgit\s+tag\b/i.test(text),
  };
}

function buildBlocker(code, message, extra = {}) {
  return { code, message, ...extra };
}

function evaluateOperationalIntegrity(options = {}) {
  const repoRoot = options.repoPath ? resolveRepoRoot(options.repoPath) : resolveRepoRoot(process.cwd());
  const baseBranch = String(options.baseBranch || DEFAULT_BASE_BRANCH).trim() || DEFAULT_BASE_BRANCH;
  const currentBranch = String(options.currentBranch || (repoRoot ? getCurrentBranch(repoRoot) : '')).trim() || null;
  const baseRef = repoRoot ? resolveBaseRef(repoRoot, baseBranch, { fetchIfMissing: options.fetchBase === true }) : null;
  const changedFiles = Array.isArray(options.changedFiles)
    ? options.changedFiles.map((filePath) => normalizePosix(filePath)).filter(Boolean)
    : (repoRoot ? listChangedFilesAgainstBase(repoRoot, baseBranch, { fetchIfMissing: options.fetchBase === true }) : []);
  const releaseSensitiveGlobs = sanitizeGlobList(options.releaseSensitiveGlobs || DEFAULT_RELEASE_SENSITIVE_GLOBS);
  const releaseSensitiveFiles = findReleaseSensitiveFiles(changedFiles, releaseSensitiveGlobs);
  const packageVersion = options.packageVersion !== undefined
    ? options.packageVersion
    : (repoRoot ? readPackageVersion(repoRoot, 'HEAD') : null);
  const baseVersion = options.baseVersion !== undefined
    ? options.baseVersion
    : (repoRoot && baseRef ? readPackageVersion(repoRoot, baseRef) : null);
  const versionComparison = packageVersion && baseVersion ? compareSemver(packageVersion, baseVersion) : null;
  const headSha = options.headSha || (repoRoot ? getHeadSha(repoRoot) : null);
  const headOnBase = options.headOnBase !== undefined
    ? options.headOnBase
    : Boolean(repoRoot && baseRef && headSha && isHeadReachableFrom(repoRoot, baseRef, headSha));
  const branchGovernance = options.branchGovernance && typeof options.branchGovernance === 'object'
    ? options.branchGovernance
    : null;
  const openPr = options.openPr !== undefined
    ? options.openPr
    : findOpenPrForBranch({ branchName: currentBranch, runner: options.ghRunner || runGh });
  const commandInfo = classifyCommand(options.command || '');
  const blockers = [];

  const requiresGovernance = commandInfo.isPrCreate || commandInfo.isPrMerge || commandInfo.isPublish || commandInfo.isReleaseCreate || commandInfo.isTagCreate;
  const isPublishLike = commandInfo.isPublish || commandInfo.isReleaseCreate || commandInfo.isTagCreate;

  if (requiresGovernance && !branchGovernance) {
    blockers.push(buildBlocker(
      'missing_branch_governance',
      'PR, merge, release, and publish actions require explicit branch governance.'
    ));
  }

  if (branchGovernance && branchGovernance.localOnly === true && requiresGovernance) {
    blockers.push(buildBlocker(
      'local_only_branch',
      'This task is marked local-only. PR, merge, release, and publish actions are blocked.'
    ));
  }

  if (commandInfo.isPrMerge && /--admin\b/i.test(commandInfo.text)) {
    blockers.push(buildBlocker(
      'admin_merge_bypass_forbidden',
      'Admin merge bypass is blocked. Use the normal protected-branch flow or merge queue.'
    ));
  }

  if (commandInfo.isPrMerge && branchGovernance && !branchGovernance.prNumber && !branchGovernance.prUrl) {
    blockers.push(buildBlocker(
      'merge_requires_pr_context',
      'Merging requires explicit PR context (prNumber or prUrl) in branch governance.'
    ));
  }

  if (isPublishLike) {
    if (!branchGovernance || !branchGovernance.releaseVersion) {
      blockers.push(buildBlocker(
        'missing_release_version',
        'Release and publish actions require an explicit releaseVersion in branch governance.'
      ));
    } else if (packageVersion && branchGovernance.releaseVersion !== packageVersion) {
      blockers.push(buildBlocker(
        'release_version_mismatch',
        `Branch governance expects release version ${branchGovernance.releaseVersion}, but package.json is ${packageVersion}.`
      ));
    }

    if (currentBranch && currentBranch !== baseBranch) {
      blockers.push(buildBlocker(
        'publish_requires_base_branch',
        `Release and publish actions must run from ${baseBranch}, not ${currentBranch}.`
      ));
    }

    if (!headOnBase) {
      blockers.push(buildBlocker(
        'publish_requires_mainline_head',
        `Current HEAD is not reachable from ${baseBranch}. Release and publish actions require a mainline commit.`
      ));
    }
  }

  if (options.requirePrForReleaseSensitive && releaseSensitiveFiles.length > 0 && currentBranch && currentBranch !== baseBranch && !openPr) {
    blockers.push(buildBlocker(
      'release_sensitive_changes_require_pr',
      `Release-sensitive changes on ${currentBranch} require an open pull request before continuing.`,
      { releaseSensitiveFiles }
    ));
  }

  if (options.requireVersionNotBehindBase && releaseSensitiveFiles.length > 0 && versionComparison !== null && versionComparison < 0) {
    blockers.push(buildBlocker(
      'version_behind_base',
      `package.json version ${packageVersion} is behind ${baseBranch} version ${baseVersion} while release-sensitive files changed.`,
      { packageVersion, baseVersion }
    ));
  }

  return {
    ok: blockers.length === 0,
    repoRoot,
    baseBranch,
    baseRef,
    currentBranch,
    headSha,
    headOnBase,
    changedFiles,
    releaseSensitiveFiles,
    packageVersion,
    baseVersion,
    versionComparison,
    branchGovernance,
    openPr,
    blockers,
    commandInfo,
  };
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    ci: false,
    fetchBase: false,
    requirePrForReleaseSensitive: false,
    requireVersionNotBehindBase: false,
    repoPath: process.cwd(),
    baseBranch: DEFAULT_BASE_BRANCH,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--ci') {
      options.ci = true;
      options.fetchBase = true;
      options.requirePrForReleaseSensitive = true;
      options.requireVersionNotBehindBase = true;
    } else if (arg === '--fetch-base') {
      options.fetchBase = true;
    } else if (arg === '--require-pr-for-release-sensitive') {
      options.requirePrForReleaseSensitive = true;
    } else if (arg === '--require-version-not-behind-base') {
      options.requireVersionNotBehindBase = true;
    } else if (arg === '--repo-path' && argv[i + 1]) {
      options.repoPath = argv[i + 1];
      i += 1;
    } else if (arg === '--base-branch' && argv[i + 1]) {
      options.baseBranch = argv[i + 1];
      i += 1;
    }
  }

  return options;
}

function runCli(env = process.env, argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  const result = evaluateOperationalIntegrity({
    repoPath: args.repoPath,
    baseBranch: args.baseBranch || env.DEFAULT_BRANCH || DEFAULT_BASE_BRANCH,
    currentBranch: env.GITHUB_REF_NAME || undefined,
    requirePrForReleaseSensitive: args.requirePrForReleaseSensitive,
    requireVersionNotBehindBase: args.requireVersionNotBehindBase,
    fetchBase: args.fetchBase,
  });

  const lines = [];
  lines.push(`Operational integrity: ${result.ok ? 'ok' : 'blocked'}`);
  lines.push(`Base branch: ${result.baseBranch}`);
  lines.push(`Current branch: ${result.currentBranch || 'unknown'}`);
  if (result.packageVersion) {
    lines.push(`package.json version: ${result.packageVersion}`);
  }
  if (result.baseVersion) {
    lines.push(`${result.baseBranch} version: ${result.baseVersion}`);
  }
  if (result.releaseSensitiveFiles.length > 0) {
    lines.push(`Release-sensitive files: ${result.releaseSensitiveFiles.join(', ')}`);
  }
  if (result.openPr && result.openPr.number) {
    lines.push(`Open PR: #${result.openPr.number}${result.openPr.url ? ` ${result.openPr.url}` : ''}`);
  }
  for (const blocker of result.blockers) {
    lines.push(`BLOCKER ${blocker.code}: ${blocker.message}`);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(lines.join('\n'));
  }

  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = runCli();
}

module.exports = {
  DEFAULT_BASE_BRANCH,
  DEFAULT_RELEASE_SENSITIVE_GLOBS,
  classifyCommand,
  compareSemver,
  evaluateOperationalIntegrity,
  findOpenPrForBranch,
  findReleaseSensitiveFiles,
  getCurrentBranch,
  isSafeBranchName,
  listChangedFilesAgainstBase,
  normalizeGlob,
  normalizePosix,
  parseSemver,
  readPackageVersion,
  resolveBaseRef,
  resolveRepoRoot,
  runCli,
  sanitizeGlobList,
};
