#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const DEFAULT_BASE_BRANCH = 'main';
const FIXED_GIT_BIN_CANDIDATES = [
  '/usr/bin/git',
  '/opt/homebrew/bin/git',
  '/usr/local/bin/git',
];
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;
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

function resolveGitBinary() {
  for (const candidate of FIXED_GIT_BIN_CANDIDATES) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error('Unable to locate git in fixed system paths');
}

const GIT_BIN = resolveGitBinary();

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

function isSafeGitRevision(revision) {
  const normalized = String(revision || '').trim();
  if (!normalized) return false;
  if (normalized.startsWith('-')) return false;
  if (normalized.includes('..') || normalized.includes('//') || normalized.includes('@{')) return false;
  if (normalized.endsWith('.') || normalized.endsWith('/')) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(normalized)) return false;
  return true;
}

function isSafeGitObjectId(objectId) {
  return /^[0-9a-f]{40}$/i.test(String(objectId || '').trim());
}

function assertSafeGitObjectId(objectId, label = 'object id') {
  const normalized = String(objectId || '').trim().toLowerCase();
  if (!isSafeGitObjectId(normalized)) {
    throw new Error(`Unsafe git ${label}: ${objectId}`);
  }
  return normalized;
}

function assertSafeGitRevision(revision, label = 'revision') {
  const normalized = String(revision || '').trim();
  if (!isSafeGitRevision(normalized)) {
    throw new Error(`Unsafe git ${label}: ${revision}`);
  }
  return normalized;
}

function resolveGitDirEntry(repoRoot, gitEntryPath) {
  let stat;
  try {
    stat = fs.statSync(gitEntryPath);
  } catch {
    return null;
  }

  if (stat.isDirectory()) {
    return gitEntryPath;
  }

  if (!stat.isFile()) {
    return null;
  }

  const pointer = fs.readFileSync(gitEntryPath, 'utf8').trim();
  const separatorIndex = pointer.indexOf(':');
  if (separatorIndex < 0 || pointer.slice(0, separatorIndex).trim().toLowerCase() !== 'gitdir') {
    return null;
  }

  const gitDirValue = pointer.slice(separatorIndex + 1).trim();
  if (!gitDirValue) {
    return null;
  }

  return path.resolve(repoRoot, gitDirValue);
}

function findGitRepoMetadata(repoPath) {
  let currentPath = path.resolve(repoPath || process.cwd());

  try {
    if (!fs.statSync(currentPath).isDirectory()) {
      currentPath = path.dirname(currentPath);
    }
  } catch {
    currentPath = path.dirname(currentPath);
  }

  while (true) {
    const gitDir = resolveGitDirEntry(currentPath, path.join(currentPath, '.git'));
    if (gitDir) {
      return { repoRoot: currentPath, gitDir };
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }

  throw new Error(`Not a git repository: ${repoPath}`);
}

function gitShowTopLevel(repoPath) {
  return findGitRepoMetadata(repoPath).repoRoot;
}

function gitDirPath(repoPath) {
  return findGitRepoMetadata(repoPath).gitDir;
}

function readGitRefFile(gitDir, refName) {
  const refSegments = refName?.split('/').filter(Boolean);
  if (!Array.isArray(refSegments) || refSegments.length === 0) {
    return null;
  }

  const refPath = path.join(gitDir, ...refSegments);
  try {
    const value = fs.readFileSync(refPath, 'utf8').trim();
    return isSafeGitObjectId(value) ? assertSafeGitObjectId(value) : null;
  } catch {
    return null;
  }
}

function readPackedGitRef(gitDir, refName) {
  try {
    const packedRefs = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
    for (const line of packedRefs.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('^')) continue;
      const [objectId, name] = trimmed.split(/\s+/, 2);
      if (name === refName && isSafeGitObjectId(objectId)) {
        return assertSafeGitObjectId(objectId);
      }
    }
  } catch {
    return null;
  }
  return null;
}

function readGitRefSha(gitDir, refName) {
  if (!refName?.startsWith('refs/')) return null;
  return readGitRefFile(gitDir, refName) || readPackedGitRef(gitDir, refName);
}

function readGitHeadState(repoPath) {
  const gitDir = gitDirPath(repoPath);
  const headValue = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();

  if (headValue.startsWith('ref:')) {
    const refName = headValue.slice(4).trim();
    return {
      refName,
      objectId: readGitRefSha(gitDir, refName),
    };
  }

  if (isSafeGitObjectId(headValue)) {
    return {
      refName: null,
      objectId: assertSafeGitObjectId(headValue, 'HEAD sha'),
    };
  }

  return {
    refName: null,
    objectId: null,
  };
}

function resolveGitRevisionToCommitSha(repoPath, revision) {
  const safeRevision = assertSafeGitRevision(revision, 'revision');
  if (safeRevision === 'HEAD') {
    return gitHeadSha(repoPath);
  }
  if (isSafeGitObjectId(safeRevision)) {
    return safeRevision.toLowerCase();
  }

  const gitDir = path.resolve(repoPath, gitDirPath(repoPath));
  if (safeRevision.startsWith('refs/')) {
    return readGitRefSha(gitDir, safeRevision);
  }
  if (safeRevision.startsWith('origin/')) {
    return readGitRefSha(gitDir, `refs/remotes/${safeRevision}`);
  }
  return readGitRefSha(gitDir, `refs/heads/${safeRevision}`) || readGitRefSha(gitDir, `refs/remotes/origin/${safeRevision}`);
}

function gitVerifyRef(repoPath, ref) {
  const commitSha = resolveGitRevisionToCommitSha(repoPath, ref);
  if (!commitSha) {
    throw new Error(`Unknown git ref: ${ref}`);
  }
  return assertSafeGitObjectId(commitSha, 'commit sha');
}

function gitCurrentBranch(repoPath) {
  const headState = readGitHeadState(repoPath);
  if (headState.refName?.startsWith('refs/heads/')) {
    return headState.refName.slice('refs/heads/'.length);
  }
  if (headState.refName?.startsWith('refs/remotes/')) {
    return headState.refName.slice('refs/remotes/'.length);
  }
  if (headState.objectId) {
    return 'HEAD';
  }
  throw new Error('Unable to resolve current branch');
}

function gitHeadSha(repoPath) {
  const headState = readGitHeadState(repoPath);
  if (headState.objectId) {
    return headState.objectId;
  }
  throw new Error('Unable to resolve HEAD commit');
}

function assertSafeRepoRelativePath(filePath, label = 'path') {
  const normalized = normalizePosix(filePath);
  if (!normalized || normalized.startsWith('-') || normalized.startsWith('.git')) {
    throw new Error(`Unsafe repo-relative ${label}: ${filePath}`);
  }
  if (normalized.includes('..') || normalized.includes('//')) {
    throw new Error(`Unsafe repo-relative ${label}: ${filePath}`);
  }
  return normalized;
}

function gitReadBlobAtCommit(repoPath, commitSha, filePath) {
  const safeCommitSha = assertSafeGitObjectId(commitSha, 'commit sha');
  const safeFilePath = assertSafeRepoRelativePath(filePath, 'file path');
  const treeEntry = execFileSync(GIT_BIN, ['ls-tree', safeCommitSha, '--', safeFilePath], {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const match = /^\d+\s+blob\s+([0-9a-f]{40})\t/.exec(treeEntry);
  if (!match?.[1]) {
    throw new Error(`Unable to resolve blob for ${safeFilePath} at ${safeCommitSha}`);
  }

  const blobSha = assertSafeGitObjectId(match[1], 'blob sha');
  return execFileSync(GIT_BIN, ['cat-file', 'blob', blobSha], {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function gitShowPackageJsonAtRef(repoPath, ref) {
  const safeCommitSha = assertSafeGitObjectId(gitVerifyRef(repoPath, ref), 'commit sha');
  return gitReadBlobAtCommit(repoPath, safeCommitSha, 'package.json').trim();
}

function gitDiffNameOnlyAgainstBase(repoPath, baseRef) {
  const safeBaseCommitSha = assertSafeGitObjectId(gitVerifyRef(repoPath, baseRef), 'base commit sha');
  return execFileSync(GIT_BIN, ['diff', '--name-only', `${safeBaseCommitSha}...HEAD`, '--'], {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function gitMergeBaseIsAncestor(repoPath, commit, ref) {
  const safeCommitSha = assertSafeGitObjectId(gitVerifyRef(repoPath, commit), 'ancestor commit sha');
  const safeRefCommitSha = assertSafeGitObjectId(gitVerifyRef(repoPath, ref), 'descendant commit sha');
  return spawnSync(GIT_BIN, ['merge-base', '--is-ancestor', safeCommitSha, safeRefCommitSha], {
    cwd: repoPath,
    encoding: 'utf8',
  });
}

function resolveRepoRoot(repoPath = process.cwd()) {
  try {
    return gitShowTopLevel(repoPath);
  } catch {
    return null;
  }
}

function gitRefExists(repoPath, ref) {
  if (!repoPath || !ref) return false;
  try {
    gitVerifyRef(repoPath, ref);
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
  const result = spawnSync(GIT_BIN, ['fetch', '--no-tags', '--depth=64', 'origin'], {
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
  try {
    return gitCurrentBranch(repoPath) || null;
  } catch {
    return null;
  }
}

function getHeadSha(repoPath) {
  try {
    return gitHeadSha(repoPath) || null;
  } catch {
    return null;
  }
}

function readPackageVersion(repoPath, ref = 'HEAD') {
  try {
    let raw;
    if (ref === 'HEAD') {
      raw = fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8');
    } else {
      raw = gitShowPackageJsonAtRef(repoPath, ref);
    }
    return JSON.parse(raw).version || null;
  } catch {
    return null;
  }
}

function parseSemver(version) {
  const match = SEMVER_PATTERN.exec(String(version || '').trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.').filter(Boolean) : [],
  };
}

function isNumericIdentifier(value) {
  return /^\d+$/.test(String(value || ''));
}

function comparePrerelease(left = [], right = []) {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];

    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;

    const leftIsNumeric = isNumericIdentifier(leftIdentifier);
    const rightIsNumeric = isNumericIdentifier(rightIdentifier);

    if (leftIsNumeric && rightIsNumeric) {
      const leftValue = Number(leftIdentifier);
      const rightValue = Number(rightIdentifier);
      if (leftValue > rightValue) return 1;
      if (leftValue < rightValue) return -1;
      continue;
    }

    if (leftIsNumeric !== rightIsNumeric) {
      return leftIsNumeric ? -1 : 1;
    }

    const lexical = String(leftIdentifier).localeCompare(String(rightIdentifier));
    if (lexical !== 0) return lexical > 0 ? 1 : -1;
  }

  return 0;
}

function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

function listChangedFilesAgainstBase(repoPath, baseBranch = DEFAULT_BASE_BRANCH, { fetchIfMissing = false } = {}) {
  const baseRef = resolveBaseRef(repoPath, baseBranch, { fetchIfMissing });
  if (!baseRef) return [];
  try {
    const diff = gitDiffNameOnlyAgainstBase(repoPath, baseRef);
    return diff.split('\n').map((line) => normalizePosix(line)).filter(Boolean);
  } catch {
    return [];
  }
}

function findReleaseSensitiveFiles(files, globs = DEFAULT_RELEASE_SENSITIVE_GLOBS) {
  return (Array.isArray(files) ? files : []).filter((filePath) => matchesAnyGlob(filePath, globs));
}

function isHeadReachableFrom(repoPath, ref, commit = 'HEAD') {
  if (!repoPath || !ref) return false;
  try {
    const result = gitMergeBaseIsAncestor(repoPath, commit, ref);
    return result.status === 0;
  } catch {
    return false;
  }
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
  const hasReleaseSensitiveFiles = releaseSensitiveFiles.length > 0;
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

  if (options.requirePrForReleaseSensitive && hasReleaseSensitiveFiles && currentBranch && currentBranch !== baseBranch && !openPr) {
    blockers.push(buildBlocker(
      'release_sensitive_changes_require_pr',
      `Release-sensitive changes on ${currentBranch} require an open pull request before continuing.`,
      { releaseSensitiveFiles }
    ));
  }

  if (options.requireVersionNotBehindBase && hasReleaseSensitiveFiles && versionComparison !== null && versionComparison < 0) {
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

function resolveCiBranchName(env = process.env) {
  const branchName = String(env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || '').trim();
  return branchName || undefined;
}

function runCli(env = process.env, argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  const result = evaluateOperationalIntegrity({
    repoPath: args.repoPath,
    baseBranch: args.baseBranch || env.DEFAULT_BRANCH || DEFAULT_BASE_BRANCH,
    currentBranch: resolveCiBranchName(env),
    requirePrForReleaseSensitive: args.requirePrForReleaseSensitive,
    requireVersionNotBehindBase: args.requireVersionNotBehindBase,
    fetchBase: args.fetchBase,
  });

  const lines = [];
  const hasReleaseSensitiveFiles = Array.isArray(result.releaseSensitiveFiles) && result.releaseSensitiveFiles.length > 0;
  const openPrNumber = result.openPr?.number;
  lines.push(`Operational integrity: ${result.ok ? 'ok' : 'blocked'}`);
  lines.push(`Base branch: ${result.baseBranch}`);
  lines.push(`Current branch: ${result.currentBranch || 'unknown'}`);
  if (result.packageVersion) {
    lines.push(`package.json version: ${result.packageVersion}`);
  }
  if (result.baseVersion) {
    lines.push(`${result.baseBranch} version: ${result.baseVersion}`);
  }
  if (hasReleaseSensitiveFiles) {
    lines.push(`Release-sensitive files: ${result.releaseSensitiveFiles.join(', ')}`);
  }
  if (openPrNumber) {
    const openPrSuffix = result.openPr?.url ? ` ${result.openPr.url}` : '';
    lines.push(`Open PR: #${openPrNumber}${openPrSuffix}`);
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

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
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
  assertSafeGitObjectId,
  gitVerifyRef,
  isSafeBranchName,
  isSafeGitObjectId,
  isSafeGitRevision,
  isHeadReachableFrom,
  listChangedFilesAgainstBase,
  normalizeGlob,
  normalizePosix,
  parseSemver,
  readPackageVersion,
  resolveBaseRef,
  resolveCiBranchName,
  resolveRepoRoot,
  runCli,
  sanitizeGlobList,
};
