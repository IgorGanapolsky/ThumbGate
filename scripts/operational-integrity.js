#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { normalizeCommandValue } = require('./harness-tool-names');

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

function canExecuteBinary(candidate) {
  const normalized = String(candidate || '').trim();
  if (!normalized) return false;
  if (normalized.includes(path.sep)) {
    try {
      fs.accessSync(normalized, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  const probe = spawnSync(normalized, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return !probe.error && probe.status === 0;
}

function resolveGitBinary(options = {}) {
  const env = options.env || process.env;
  const allowPathLookup = options.allowPathLookup !== false;
  const configuredCandidates = Array.isArray(options.candidates) && options.candidates.length > 0
    ? options.candidates
    : [
      env.THUMBGATE_GIT_BIN,
      ...FIXED_GIT_BIN_CANDIDATES,
      allowPathLookup ? 'git' : null,
    ];

  for (const candidate of configuredCandidates) {
    if (!canExecuteBinary(candidate)) continue;
    return String(candidate).trim();
  }

  return null;
}

function getGitBinary(options = {}) {
  const gitBin = GIT_BIN || resolveGitBinary(options);
  const required = options.required !== false;
  if (!gitBin && required) {
    throw new Error('Git executable is unavailable in this runtime');
  }
  return gitBin;
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
  const treeEntry = execFileSync(getGitBinary(), ['ls-tree', safeCommitSha, '--', safeFilePath], {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const match = /^\d+\s+blob\s+([0-9a-f]{40})\t/.exec(treeEntry);
  if (!match?.[1]) {
    throw new Error(`Unable to resolve blob for ${safeFilePath} at ${safeCommitSha}`);
  }

  const blobSha = assertSafeGitObjectId(match[1], 'blob sha');
  return execFileSync(getGitBinary(), ['cat-file', 'blob', blobSha], {
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
  return execFileSync(getGitBinary(), ['diff', '--name-only', `${safeBaseCommitSha}...HEAD`, '--'], {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function gitMergeBaseIsAncestor(repoPath, commit, ref) {
  const safeCommitSha = assertSafeGitObjectId(gitVerifyRef(repoPath, commit), 'ancestor commit sha');
  const safeRefCommitSha = assertSafeGitObjectId(gitVerifyRef(repoPath, ref), 'descendant commit sha');
  return spawnSync(getGitBinary(), ['merge-base', '--is-ancestor', safeCommitSha, safeRefCommitSha], {
    cwd: repoPath,
    encoding: 'utf8',
  });
}

function resolveRepoRoot(repoPath = process.cwd()) {
  let target = process.cwd();
  if (typeof repoPath === 'string') {
    target = repoPath;
  } else if (repoPath && typeof repoPath === 'object') {
    const cmd = String(repoPath.command || '');
    const gitCMatch = cmd.match(/(?:^|\s)git(?:\s+-[^\s]+)*\s+-C(?:\s+|=)(?:'([^']+)'|"([^"]+)"|([^\s'"]+))/i);
    const gitCDir = gitCMatch ? (gitCMatch[1] || gitCMatch[2] || gitCMatch[3] || '').trim() : '';
    if (gitCDir) {
      let cPath = gitCDir;
      if (cPath.startsWith('~/')) {
        const homedir = process.env.HOME || '/tmp';
        cPath = path.join(homedir, cPath.slice(2));
      }
      target = path.resolve(repoPath.cwd || process.cwd(), cPath);
    } else {
      target = repoPath.repoPath || repoPath.cwd || process.cwd();
    }
  }
  try {
    return gitShowTopLevel(target);
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
  const gitBin = getGitBinary({ required: false });
  if (!gitBin) return false;
  // Fetch the remote tracking refs without passing user-controlled branch names to git.
  const result = spawnSync(gitBin, ['fetch', '--no-tags', '--depth=64', 'origin'], {
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

function resolveGitHubRepository(env = process.env) {
  const repository = String(env.GITHUB_REPOSITORY || '').trim();
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ? repository : null;
}

function findOpenPrForBranch({ branchName, runner = runGh, env = process.env } = {}) {
  const normalizedBranch = String(branchName || '').trim();
  if (!normalizedBranch) return null;
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (!token) {
    return null;
  }
  const repository = resolveGitHubRepository(env);
  if (!repository) return null;

  // Try REST API first as it is much more robust and doesn't rely on gh CLI's GraphQL auth
  try {
    const owner = repository.split('/')[0];
    const url = `https://api.github.com/repos/${repository}/pulls?head=${encodeURIComponent(owner + ':' + normalizedBranch)}&state=open`;
    const curlConfig = `header = "Authorization: token ${token}"\nheader = "User-Agent: ThumbGate-CI"`;
    const curlResult = spawnSync('curl', [
      '-s',
      '-K', '-',
      url
    ], {
      encoding: 'utf8',
      input: curlConfig
    });

    if (curlResult && curlResult.status === 0) {
      const prs = JSON.parse(curlResult.stdout || '[]');
      if (Array.isArray(prs) && prs.length > 0) {
        return {
          number: prs[0].number,
          state: prs[0].state,
          isDraft: prs[0].draft || false,
          url: prs[0].html_url
        };
      }
    }
  } catch (err) {
    console.warn(`[findOpenPrForBranch] REST fallback failed: ${err.message}`);
  }

  // Fall back to gh CLI
  const args = ['pr', 'list', '--repo', repository, '--head', normalizedBranch, '--state', 'open', '--json', 'number,state,isDraft,url'];
  const result = runner(args);
  if (!result || result.status !== 0) {
    if (result) {
      console.warn(`[findOpenPrForBranch] gh command failed with status ${result.status}. Stderr: ${result.stderr || ''}`);
    } else {
      console.warn(`[findOpenPrForBranch] gh command failed to spawn.`);
    }
    return null;
  }
  try {
    const prs = JSON.parse(result.stdout || '[]');
    return Array.isArray(prs) && prs.length > 0 ? prs[0] : null;
  } catch {
    return null;
  }
}

const WRAPPERS = new Set('sudo doas env command builtin exec nohup time nice ionice setsid stdbuf xargs'.split(' '));
const WRAPPER_FLAGS = new Map([
  ['sudo', new Set(['-u', '-g', '-h', '-p', '-r', '-t', '-C'])], ['doas', new Set(['-u'])],
  ['env', new Set(['-u', '-C', '-S'])], ['nice', new Set(['-n'])], ['ionice', new Set(['-c', '-n', '-p'])],
  ['xargs', new Set(['-n', '-P', '-I', '-L', '-s', '-d'])], ['stdbuf', new Set(['-i', '-o', '-e'])],
]);
const CTRL_KW = new Set('then else elif do while until if { ('.split(' '));
const ASSIGN_KW = new Set(['export', 'local', 'declare', 'typeset']);
const UNSET_KW = new Set(['unset', 'remove-variable', 'rv']);
const READ_FLAGS = new Set(['-p', '-d', '-n', '-N', '-t', '-u']);
const SH_BINS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const PWSH_BINS = new Set(['powershell', 'pwsh']);
const PWSH_FLAGS = new Set('-executionpolicy -ep -windowstyle -w -inputformat -if -outputformat -of -configurationname'.split(' '));
const FIND_ARG_FLAGS = new Set('-name -iname -path -ipath -wholename -iwholename -regex -iregex -lname -ilname -samefile -type -xtype -maxdepth -mindepth -perm -links -user -group -uid -gid -size -inum -amin -atime -cmin -ctime -mmin -mtime -newer -anewer -cnewer -printf -fprintf -fprint -fls'.split(' '));
const RI_VAL_FLAGS = new Set(['-include', '-exclude', '-filter', '-stream', '-credential']);
const RI_PATH_FLAGS = new Set(['-path', '-literalpath', '-lp']);
const GIT_ARG_FLAGS = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix']);
const DEL_EXEC_BINS = new Set('rm unlink shred rmdir rd del erase remove-item ri'.split(' '));
const DIR_DEL_BINS = new Set(['rmdir', 'rd', 'del', 'erase']);
const WIN_SW_RE = /^(?:\/(?:s|q|f|p|a(?::?[a-z-]+)?))+$/i;
const WIN_S_RE = /\/s(?:$|\/|:)/i;
const PWSH_REC_RE = /^-(?:r|rec|recur|recurs|recurse)(?::\$?true)?$/i;
const VAR_ONLY_RE = /^(?:\$\{([A-Za-z_]\w*)(?::-)?\}|\$(?:env:)?([A-Za-z_]\w*)|%([A-Za-z_]\w*)%)([/\\*]*)$/i;
const VAR_HEAD_RE = /^(?:\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)|%([A-Za-z_]\w*)%)[/\\]/;

function fmtInput(cmd, max = 20000) {
  return (Array.isArray(cmd) ? String(normalizeCommandValue(cmd)) : String(cmd || '')).slice(0, max).trim();
}

function isEscSlash(s, i) { return s[i] === '\\' && s[i + 1] === '\\'; }
function isWinQuotedSpan(s, qs) { return qs >= 0 && /^(?:[A-Za-z]:\\|\\\\)/.test(s.slice(qs + 1, qs + 5)); }
function isEscQuote(s, i, qs) {
  return s[i] === '\\' && s[i + 1] === '"' && !isWinQuotedSpan(s, qs) && s.indexOf('"', i + 2) !== -1;
}
function isWinPathBefore(s, i) {
  let k = i - 1;
  while (k >= 0 && !/[\s;|&"']/.test(s[k])) {
    if (s[k] === '\\' || (s[k] === ':' && k > 0 && /[A-Za-z]/.test(s[k - 1]))) return true;
    k -= 1;
  }
  return false;
}

function isEscUnquoted(s, i) {
  return s[i] === '\\' && i + 1 < s.length && /[;&|"' ]/.test(s[i + 1]) && !isWinPathBefore(s, i);
}

function stepQuotedSeg(s, i, q, qs) {
  if (q === '"' && (isEscSlash(s, i) || isEscQuote(s, i, qs))) return { n: i + 1, q, qs };
  return s[i] === q ? { n: i, q: null, qs: -1 } : { n: i, q, qs };
}

function delimLen(s, i) {
  const c = s[i];
  if (c === '\r' || c === '\n' || c === ';') return 1;
  if (c === '&' || c === '|') return s[i + 1] === c ? 2 : 1;
  return 0;
}

function splitSegs(cmd) {
  const s = String(cmd || '');
  const out = [];
  let start = 0;
  let q = null;
  let qs = -1;
  for (let i = 0; i < s.length; i += 1) {
    if (q) { const st = stepQuotedSeg(s, i, q, qs); i = st.n; q = st.q; qs = st.qs; continue; }
    if (isEscUnquoted(s, i)) { i += 1; continue; }
    if (s[i] === '"' || s[i] === '\'') { q = s[i]; qs = i; continue; }
    const dl = delimLen(s, i);
    if (dl > 0) { out.push(s.slice(start, i)); i += dl - 1; start = i + 1; }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

function stepQuotedTok(s, i, b) {
  if (b.q === '"' && isEscSlash(s, i)) { b.v += '\\'; return i + 1; }
  if (b.q === '"' && isEscQuote(s, i, b.qs)) { b.v += '"'; return i + 1; }
  if (s[i] === b.q) { b.q = null; b.qs = -1; return i; }
  b.v += s[i];
  return i;
}

function stepUnquotedTok(s, i, b) {
  const c = s[i];
  if (c === '"' || c === '\'') { b.q = c; b.qs = i; b.hq = true; if (c !== '\'') b.sq = false; return i; }
  b.sq = false;
  if (isEscUnquoted(s, i)) { b.v += s[i + 1]; return i + 1; }
  b.v += c;
  return i;
}

function flushTok(s, end, b, out) {
  if (b.rs === -1) return;
  out.push({ raw: s.slice(b.rs, end), value: b.v, hasQuotes: b.hq, singleQuoted: b.hq && b.sq });
  b.rs = -1; b.v = ''; b.hq = false; b.sq = true;
}

function tokenize(seg) {
  const s = String(seg || '').trim();
  const out = [];
  const b = { rs: -1, v: '', q: null, qs: -1, hq: false, sq: true };
  for (let i = 0; i < s.length; i += 1) {
    if (b.q) { i = stepQuotedTok(s, i, b); continue; }
    if (/\s/.test(s[i])) { flushTok(s, i, b, out); continue; }
    if (b.rs === -1) b.rs = i;
    i = stepUnquotedTok(s, i, b);
  }
  flushTok(s, s.length, b, out);
  return out;
}

function readSubAt(s, i) {
  if (s[i] === '$' && s[i + 1] === '(') {
    let d = 1;
    let c = i + 2;
    while (c < s.length && d > 0) { if (s[c] === '(') d += 1; else if (s[c] === ')') d -= 1; c += 1; }
    return d === 0 ? { inner: s.slice(i + 2, c - 1).trim(), n: i + 1 } : null;
  }
  if (s[i] === '`') {
    const end = s.indexOf('`', i + 1);
    if (end !== -1) return { inner: s.slice(i + 1, end).trim(), n: end };
  }
  return null;
}

function stepSubQuote(c, i, q, qs) {
  if (q === '\'') return c === '\'' ? { q: null, qs: -1 } : { q, qs };
  if (c === '\'' && !q) return { q: '\'', qs: i };
  if (c === '"') return q === '"' ? { q: null, qs: -1 } : { q: '"', qs: i };
  return { q, qs };
}

function extractSubs(cmd) {
  const s = String(cmd || '');
  const out = [];
  let q = null;
  let qs = -1;
  for (let i = 0; i < s.length; i += 1) {
    if (q === '"' && (isEscSlash(s, i) || isEscQuote(s, i, qs))) { i += 1; continue; }
    const wasSq = q === '\'';
    const nxt = stepSubQuote(s[i], i, q, qs);
    q = nxt.q;
    qs = nxt.qs;
    if (wasSq || q === '\'') continue;
    const sub = readSubAt(s, i);
    if (sub) { if (sub.inner) out.push(sub.inner); i = sub.n; }
  }
  return out;
}

function normBin(v) {
  return (String(v || '').replace(/^\\/, '').trim().split(/[/\\]/).pop() || '').toLowerCase().replace(/\.exe$/i, '');
}

function bindVar(name, rhs, st) {
  const k = name.toLowerCase();
  const t = String(rhs || '').trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!t || t.toLowerCase() === '$null') { st.empty.add(k); st.bound.delete(k); } else { st.bound.add(k); st.empty.delete(k); }
}

function recAssign(txt, st) {
  const eq = txt.indexOf('=');
  if (eq <= 0) return false;
  const name = txt.slice(0, eq).trim().replace(/^\$(?:env:)?/i, '');
  if (!/^[A-Za-z_]\w*$/.test(name)) return false;
  bindVar(name, txt.slice(eq + 1), st);
  return true;
}

function recPwshAssign(toks, st) {
  if (toks.length < 2 || toks[1].value !== '=') return false;
  const name = toks[0].value.replace(/^\$(?:env:)?/i, '');
  if (!/^[A-Za-z_]\w*$/.test(name)) return false;
  bindVar(name, toks[2]?.raw || '', st);
  return true;
}

function bindRead(toks, st) {
  let any = false;
  for (let i = 1; i < toks.length; i += 1) {
    const v = toks[i].value;
    if (READ_FLAGS.has(v)) { i += 1; continue; }
    let target = '';
    if (v === '-a') target = toks[++i]?.value || '';
    else if (!v.startsWith('-')) target = v;
    if (target && /^[A-Za-z_]\w*$/.test(target)) { bindVar(target, '1', st); any = true; }
  }
  if (!any) bindVar('reply', '1', st);
}

function bindUnset(toks, st) {
  for (const t of toks.slice(1)) {
    if (!t.value.startsWith('-')) bindVar(t.value.replace(/^\$(?:env:)?/i, ''), '', st);
  }
}

function updateBuiltinState(toks, st) {
  if (toks.length === 0 || recPwshAssign(toks, st)) return true;
  const h = toks[0].value.toLowerCase();
  if (h === 'for' && toks[1] && /^[A-Za-z_]\w*$/.test(toks[1].value)) { bindVar(toks[1].value, '1', st); return true; }
  if (h === 'read') { bindRead(toks, st); return true; }
  if (ASSIGN_KW.has(h)) { for (const t of toks.slice(1)) recAssign(t.value, st); return true; }
  if (h === 'set' && toks[1] && recAssign(toks[1].value, st)) return true;
  if (UNSET_KW.has(h)) { bindUnset(toks, st); return true; }
  return false;
}

function stepEnvOpt(toks, c, st) {
  const cur = toks[c].value;
  if (recAssign(cur, st)) return c + 1;
  if (cur === '-u' && c + 1 < toks.length) { bindVar(toks[c + 1].value, '', st); return c + 2; }
  return -1;
}

function skipWrapperOpts(bin, toks, start, st) {
  const twoArg = WRAPPER_FLAGS.get(bin);
  let c = start;
  while (c < toks.length) {
    const cur = toks[c].value;
    if (cur === '--') return c + 1;
    if (bin === 'env') { const nxt = stepEnvOpt(toks, c, st); if (nxt !== -1) { c = nxt; continue; } }
    if (!cur.startsWith('-')) break;
    c += twoArg?.has(cur) && c + 1 < toks.length ? 2 : 1;
  }
  return c;
}

function stripPrefixes(toks, st) {
  let i = 0;
  while (i < toks.length) {
    const w = toks[i].value;
    if (CTRL_KW.has(w.toLowerCase()) || (/^\$?(?:env:)?[A-Za-z_]\w*=/i.test(toks[i].raw) && recAssign(w, st))) { i += 1; continue; }
    const bin = normBin(w);
    if (!WRAPPERS.has(bin)) break;
    i = skipWrapperOpts(bin, toks, i + 1, st);
  }
  return toks.slice(i);
}

function joinPayload(args) {
  if (args.length === 0) return '';
  return args.length === 1 ? args[0].value.trim() : args.map((t) => t.raw).join(' ').trim();
}

function unwrapCmd(args) {
  for (let i = 0; i < args.length; i += 1) {
    const raw = args[i].value;
    const lo = raw.toLowerCase();
    if (/^\/[abd-jl-z]*[ck]+$/i.test(lo)) return joinPayload(args.slice(i + 1));
    const m = /^\/[abd-jl-z]*[ck]+:?([\s\S]+)$/i.exec(raw);
    if (m && !/^[a-z]+$/i.test(m[1])) { const t = joinPayload(args.slice(i + 1)); return t ? `${m[1]} ${t}` : m[1].trim(); }
    if (!lo.startsWith('/')) break;
  }
  return null;
}

function unwrapPwsh(args) {
  for (let i = 0; i < args.length; i += 1) {
    const lo = args[i].value.toLowerCase();
    if (lo === '-command' || lo === '-c') return joinPayload(args.slice(i + 1));
    if (lo === '-file' || lo === '-f' || lo.startsWith('-enc')) return null;
    if (PWSH_FLAGS.has(lo)) { i += 1; continue; }
    if (!lo.startsWith('-')) return joinPayload(args.slice(i));
  }
  return null;
}

function unwrapSh(args) {
  for (let i = 0; i < args.length; i += 1) {
    const v = args[i].value;
    if ((v === '-o' || v === '+o') && i + 1 < args.length) { i += 1; continue; }
    if (/^-[A-ABD-Za-bd-z]*c[A-Za-z]*$/.test(v) && i + 1 < args.length) return args[i + 1].value.trim();
    if (!v.startsWith('-') && !v.startsWith('+')) break;
  }
  return null;
}

function unwrapShell(bin, args) {
  if (bin === 'cmd') return unwrapCmd(args);
  if (PWSH_BINS.has(bin)) return unwrapPwsh(args);
  return SH_BINS.has(bin) ? unwrapSh(args) : null;
}

function isBadTarget(tok, st) {
  if (!tok) return false;
  if (tok.hasQuotes && /^[/\\]*$/.test(tok.value)) return true;
  if (tok.singleQuoted) return false;
  const m1 = VAR_ONLY_RE.exec(tok.value);
  if (m1) { const k = (m1[1] || m1[2] || m1[3] || '').toLowerCase(); return Boolean(k) && (!st.bound.has(k) || st.empty.has(k)); }
  const m2 = VAR_HEAD_RE.exec(tok.value);
  if (m2) { const k = (m2[1] || m2[2] || m2[3] || '').toLowerCase(); return Boolean(k) && st.empty.has(k); }
  return false;
}

function applyRmFlag(v, f) {
  if (v === '--recursive') f.r = true;
  else if (v === '--force') f.f = true;
  else if (!v.startsWith('--')) { if (/[rR]/.test(v)) f.r = true; if (/f/.test(v)) f.f = true; }
}

function checkRm(args, st) {
  const f = { r: false, f: false };
  let dd = false;
  for (const t of args) {
    const v = t.value;
    if (!dd && v === '--') { dd = true; continue; }
    if (!dd && /^-(?:recurse)(?::\$?true)?$/i.test(v)) return true;
    if (!dd && v.startsWith('-') && v.length > 1 && !v.startsWith('-$')) { applyRmFlag(v, f); continue; }
    if (isBadTarget(t, st)) return true;
  }
  return f.r && f.f;
}

function checkFindExec(slice, depth, st) {
  const s = stripPrefixes(slice, st);
  if (s.length === 0) return false;
  const bin = normBin(s[0].value);
  if (DEL_EXEC_BINS.has(bin)) return true;
  const nested = unwrapShell(bin, s.slice(1));
  return Boolean(nested && depth < 4 && evalCmd(nested, depth + 1, st));
}

function findExecEnd(args, start) {
  let end = start;
  while (end < args.length && args[end].value !== ';' && args[end].value !== '+') end += 1;
  return end;
}

function checkFind(args, depth, st) {
  for (let i = 0; i < args.length; i += 1) {
    const lo = args[i].value.toLowerCase();
    if (FIND_ARG_FLAGS.has(lo)) { i += 1; continue; }
    if (lo === '-delete') return true;
    if (lo === '-exec' || lo === '-execdir' || lo === '-ok' || lo === '-okdir') {
      const end = findExecEnd(args, i + 1);
      if (checkFindExec(args.slice(i + 1, end), depth, st)) return true;
      i = end;
    }
  }
  return false;
}

function checkDirDel(args, st) {
  for (const t of args) {
    const v = t.value;
    const sw = WIN_SW_RE.test(v);
    if ((sw && WIN_S_RE.test(v)) || PWSH_REC_RE.test(v)) return true;
    if (!v.startsWith('-') && !sw && isBadTarget(t, st)) return true;
  }
  return false;
}

function checkRemoveItem(args, st) {
  for (let i = 0; i < args.length; i += 1) {
    const v = args[i].value;
    const lo = v.toLowerCase();
    if (PWSH_REC_RE.test(v)) return true;
    if (RI_VAL_FLAGS.has(lo)) { i += 1; continue; }
    if (RI_PATH_FLAGS.has(lo)) { if (isBadTarget(args[++i], st)) return true; continue; }
    if (!v.startsWith('-') && isBadTarget(args[i], st)) return true;
  }
  return false;
}

function applyGitFlag(v, f) {
  if (v === '--force') f.f = true;
  else if (v === '--dry-run') f.n = true;
  else if (!v.startsWith('--')) { if (/f/.test(v)) f.f = true; if (/n/.test(v)) f.n = true; }
}

function checkGitClean(tail, st) {
  const f = { f: false, n: false };
  let dd = false;
  for (let i = 0; i < tail.length; i += 1) {
    const v = tail[i].value;
    if (!dd && v === '--') { dd = true; continue; }
    if (!dd && (v === '-e' || v === '--exclude')) { i += 1; continue; }
    if (!dd && v.startsWith('-')) { applyGitFlag(v, f); continue; }
    if (isBadTarget(tail[i], st)) return true;
  }
  return f.f && !f.n;
}

function checkGit(args, st) {
  for (let i = 0; i < args.length; i += 1) {
    if (GIT_ARG_FLAGS.has(args[i].value)) { i += 1; continue; }
    if (!args[i].value.startsWith('-')) {
      return args[i].value.toLowerCase() === 'clean' && checkGitClean(args.slice(i + 1), st);
    }
  }
  return false;
}

function evalBin(bin, args, depth, st) {
  if (bin === 'rm') return checkRm(args, st);
  if (bin === 'find') return checkFind(args, depth, st);
  if (DIR_DEL_BINS.has(bin)) return checkDirDel(args, st);
  if (bin === 'remove-item' || bin === 'ri') return checkRemoveItem(args, st);
  if (bin === 'git') return checkGit(args, st);
  return (bin === 'unlink' || bin === 'shred') && args.some((t) => !t.value.startsWith('-') && isBadTarget(t, st));
}

function evalSeg(seg, depth, st) {
  const raw = tokenize(seg);
  if (raw.length === 0 || updateBuiltinState(raw, st)) return false;
  const toks = stripPrefixes(raw, st);
  if (toks.length === 0 || updateBuiltinState(toks, st)) return false;
  const bin = normBin(toks[0].value);
  const args = toks.slice(1);
  const nested = unwrapShell(bin, args);
  if (nested !== null && depth < 4) return evalCmd(nested, depth + 1, st);
  return evalBin(bin, args, depth, st);
}

function evalCmd(cmd, depth, parent) {
  const raw = fmtInput(cmd, 20000);
  if (!raw) return false;
  const st = { bound: new Set(parent?.bound || []), empty: new Set(parent?.empty || []) };
  for (const seg of splitSegs(raw)) {
    if (evalSeg(seg, depth, st)) return true;
  }
  return depth < 4 && extractSubs(raw).some((sub) => evalCmd(sub, depth + 1, st));
}

function isDestructiveDeleteCommand(command) {
  return evalCmd(command, 0, null);
}

function classifyCommand(command) {
  const text = fmtInput(command, 100000);
  const workflowRunMatch = /\bgh\s+workflow\s+run\s+([^\s]+)/i.exec(text);
  const refMatch = /(?:--ref|-r)\s+([^\s]+)/i.exec(text);
  const fieldArgs = [...text.matchAll(/(?:--field|-f)\s+([A-Za-z0-9_.-]+)=([^\s]+)/gi)]
    .map((match) => ({ name: match[1], value: match[2] }));
  return {
    text,
    isPrCreate: /\bgh\s+pr\s+create\b/i.test(text),
    isPrMerge: /\bgh\s+pr\s+merge\b/i.test(text),
    isWorkflowRun: /\bgh\s+workflow\s+run\b/i.test(text),
    workflowName: workflowRunMatch ? workflowRunMatch[1] : null,
    workflowRef: refMatch ? refMatch[1] : null,
    workflowFields: fieldArgs,
    isPublish: /\b(?:npm|yarn|pnpm)\s+publish\b/i.test(text),
    isReleaseCreate: /\bgh\s+release\s+create\b/i.test(text),
    isTagCreate: /\bgit\s+tag\b/i.test(text),
    isDestructiveDelete: isDestructiveDeleteCommand(command),
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

  const requiresGovernance = commandInfo.isPrCreate
    || commandInfo.isPrMerge
    || commandInfo.isWorkflowRun
    || commandInfo.isPublish
    || commandInfo.isReleaseCreate
    || commandInfo.isTagCreate;
  const isPublishLike = commandInfo.isPublish || commandInfo.isReleaseCreate || commandInfo.isTagCreate;

  if (requiresGovernance && !branchGovernance) {
    blockers.push(buildBlocker(
      'missing_branch_governance',
      'PR, workflow dispatch, merge, release, and publish actions require explicit branch governance.'
    ));
  }

  if (branchGovernance && branchGovernance.localOnly === true && requiresGovernance) {
    blockers.push(buildBlocker(
      'local_only_branch',
      'This task is marked local-only. PR, workflow dispatch, merge, release, and publish actions are blocked.'
    ));
  }

  if (commandInfo.isWorkflowRun) {
    const workflowEvidence = branchGovernance && branchGovernance.workflowDispatch
      && typeof branchGovernance.workflowDispatch === 'object'
      ? branchGovernance.workflowDispatch
      : null;
    const requestedEnvironment = workflowEvidence && workflowEvidence.environment
      ? String(workflowEvidence.environment).trim()
      : '';
    const expectedWorkflow = workflowEvidence && workflowEvidence.workflow
      ? String(workflowEvidence.workflow).trim()
      : '';
    const expectedRef = workflowEvidence && workflowEvidence.ref
      ? String(workflowEvidence.ref).trim()
      : '';
    const expectedSha = workflowEvidence && workflowEvidence.sha
      ? String(workflowEvidence.sha).trim()
      : '';
    const expectedJob = workflowEvidence && workflowEvidence.job
      ? String(workflowEvidence.job).trim()
      : '';

    if (!workflowEvidence) {
      blockers.push(buildBlocker(
        'missing_workflow_dispatch_evidence',
        'GitHub Actions workflow dispatch requires explicit workflowDispatch evidence: environment, workflow, ref, sha, and job.'
      ));
    }
    if (workflowEvidence && !requestedEnvironment) {
      blockers.push(buildBlocker(
        'missing_workflow_environment',
        'Workflow dispatch requires the requested environment, such as dev, staging, beta, or release.'
      ));
    }
    if (workflowEvidence && !expectedWorkflow) {
      blockers.push(buildBlocker(
        'missing_workflow_name',
        'Workflow dispatch requires the expected workflow file name before execution.'
      ));
    }
    if (workflowEvidence && expectedWorkflow && commandInfo.workflowName !== expectedWorkflow) {
      blockers.push(buildBlocker(
        'workflow_name_mismatch',
        `Requested ${requestedEnvironment || 'workflow'} dispatch expects ${expectedWorkflow}, but command runs ${commandInfo.workflowName || 'unknown workflow'}.`,
        { expectedWorkflow, actualWorkflow: commandInfo.workflowName }
      ));
    }
    if (workflowEvidence && !expectedRef) {
      blockers.push(buildBlocker(
        'missing_workflow_ref',
        'Workflow dispatch requires an explicit branch/ref before execution.'
      ));
    }
    if (workflowEvidence && expectedRef && commandInfo.workflowRef !== expectedRef) {
      blockers.push(buildBlocker(
        'workflow_ref_mismatch',
        `Workflow dispatch expects ref ${expectedRef}, but command uses ${commandInfo.workflowRef || 'no --ref value'}.`,
        { expectedRef, actualRef: commandInfo.workflowRef }
      ));
    }
    if (workflowEvidence && !expectedSha) {
      blockers.push(buildBlocker(
        'missing_workflow_sha',
        'Workflow dispatch requires the HEAD SHA that will be verified after dispatch.'
      ));
    }
    if (workflowEvidence && expectedSha && headSha && expectedSha !== headSha) {
      blockers.push(buildBlocker(
        'workflow_sha_mismatch',
        `Workflow dispatch expects SHA ${expectedSha}, but repository HEAD is ${headSha}.`,
        { expectedSha, headSha }
      ));
    }
    if (workflowEvidence && !expectedJob) {
      blockers.push(buildBlocker(
        'missing_workflow_job',
        'Workflow dispatch requires the expected job name to verify before reporting the run URL.'
      ));
    }
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
  getGitBinary,
  assertSafeGitObjectId,
  gitVerifyRef,
  isSafeBranchName,
  isDestructiveDeleteCommand,
  isSafeGitObjectId,
  isSafeGitRevision,
  isHeadReachableFrom,
  listChangedFilesAgainstBase,
  normalizeGlob,
  normalizePosix,
  parseSemver,
  readPackageVersion,
  resolveGitBinary,
  resolveBaseRef,
  resolveCiBranchName,
  resolveGitHubRepository,
  resolveRepoRoot,
  runCli,
  sanitizeGlobList,
};
