'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { publishedCliShellCommand } = require('./published-cli');
const DEFAULT_PKG_ROOT = path.join(__dirname, '..');
const cliAvailabilityCache = new Map();

function isSourceCheckout(pkgRoot) {
  return fs.existsSync(path.join(pkgRoot, '.git'));
}

function parseWorktreePaths(raw) {
  return String(raw || '')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter(Boolean);
}

function resolveStableSourceRoot(pkgRoot) {
  const effectivePkgRoot =
    typeof pkgRoot === 'string' && pkgRoot.trim() ? pkgRoot : DEFAULT_PKG_ROOT;

  if (!isSourceCheckout(effectivePkgRoot)) {
    return null;
  }

  let preferredBasenames = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(effectivePkgRoot, 'package.json'), 'utf8'));
    const packageName = String(pkg && pkg.name || '').trim().toLowerCase();
    if (packageName) {
      preferredBasenames.push(packageName);
      preferredBasenames.push(packageName.replace(/[^a-z0-9]+/g, ''));
    }
  } catch (_) {
    preferredBasenames = [];
  }

  try {
    const output = execFileSync('git', ['-C', effectivePkgRoot, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const worktreePaths = parseWorktreePaths(output);

    for (const worktreePath of worktreePaths) {
      const baseName = path.basename(worktreePath).toLowerCase();
      const normalizedBaseName = baseName.replace(/[^a-z0-9]+/g, '');
      if (preferredBasenames.includes(baseName) || preferredBasenames.includes(normalizedBaseName)) {
        return worktreePath;
      }
    }

    for (const worktreePath of worktreePaths) {
      const gitPath = path.join(worktreePath, '.git');
      if (!fs.existsSync(gitPath)) {
        continue;
      }
      if (fs.statSync(gitPath).isDirectory()) {
        return worktreePath;
      }
    }
  } catch (_) {
    return effectivePkgRoot;
  }

  return effectivePkgRoot;
}

function resolveGitCommonDir(dirPath) {
  try {
    return execFileSync('git', ['-C', dirPath, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return null;
  }
}

function isSameCheckoutFamily(pkgRoot, targetDir) {
  const packageCommonDir = resolveGitCommonDir(pkgRoot);
  const targetCommonDir = resolveGitCommonDir(targetDir);

  if (packageCommonDir && targetCommonDir) {
    return packageCommonDir === targetCommonDir;
  }

  const resolvedPkgRoot = path.resolve(pkgRoot);
  const resolvedTargetDir = path.resolve(targetDir);
  return resolvedTargetDir === resolvedPkgRoot || resolvedTargetDir.startsWith(`${resolvedPkgRoot}${path.sep}`);
}

function resolveLocalServerPath(pkgRoot, scope = 'project') {
  const baseRoot = scope === 'home' ? resolveStableSourceRoot(pkgRoot) || pkgRoot : pkgRoot;
  return path.join(baseRoot, 'adapters', 'mcp', 'server-stdio.js');
}

function portableMcpEntry(pkgVersion) {
  return {
    command: 'sh',
    args: ['-lc', publishedCliShellCommand(pkgVersion, ['serve'])],
  };
}

function codexAutoUpdateCliEntry(commandArgs = []) {
  // Fast-start from the installed runtime binary; only resolve @latest via npx
  // when the runtime is absent (e.g. first launch). This matches the hook
  // commands and must never block MCP server startup on a per-launch reinstall
  // (a blocking `npm install thumbgate@latest` on every launch caused
  // capture/serve timeouts on slow or offline networks — a failed install left
  // the chained `exec` unreached, so the server never started).
  return {
    command: 'sh',
    args: ['-lc', publishedCliShellCommand('latest', commandArgs)],
  };
}

function codexAutoUpdateMcpEntry() {
  return codexAutoUpdateCliEntry(['serve']);
}

function localMcpEntry(pkgRoot, scope = 'project') {
  return {
    command: 'node',
    args: [resolveLocalServerPath(pkgRoot, scope)],
  };
}

const publicationCache = new Map();

function publishedVersionOverride() {
  const override = String(process.env.THUMBGATE_PUBLISH_STATE || '').trim().toLowerCase();
  if (override === 'published') {
    return true;
  }
  if (override === 'unpublished') {
    return false;
  }
  return null;
}

function isVersionPublished(pkgVersion) {
  const override = publishedVersionOverride();
  if (override !== null) {
    return override;
  }
  if (publicationCache.has(pkgVersion)) {
    return publicationCache.get(pkgVersion);
  }

  let published = false;
  try {
    execFileSync('npm', ['view', `thumbgate@${pkgVersion}`, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    published = true;
  } catch (_) {
    published = false;
  }

  publicationCache.set(pkgVersion, published);
  return published;
}

function publishedCliOverride() {
  const override = String(process.env.THUMBGATE_PUBLISHED_CLI_STATE || '').trim().toLowerCase();
  if (override === 'available') {
    return true;
  }
  if (override === 'unavailable') {
    return false;
  }
  return null;
}

function publishedCliAvailable(pkgVersion) {
  const override = publishedCliOverride();
  if (override !== null) {
    return override;
  }
  if (!isVersionPublished(pkgVersion)) {
    return false;
  }
  if (!cliAvailabilityCache.has(pkgVersion)) {
    cliAvailabilityCache.set(pkgVersion, true);
  }
  return cliAvailabilityCache.get(pkgVersion);
}

/**
 * Project-scope entries land in COMMITTED, SHARED config (.mcp.json / .cursor/mcp.json —
 * init's own banner says the file serves every agent on the repo). A machine-absolute path
 * there is a bug by construction: run init on machine A (or a Cowork sandbox with a home
 * like /Users/busy-clever-newton) and the committed config breaks for every other machine,
 * teammate, and CI runner. Observed for real on 2026-07-29.
 *
 * So: absolute paths may only ever go to HOME-scope config (machine-local by definition).
 * Project scope gets a repo-relative path when the project IS the ThumbGate checkout
 * (dogfooding unpublished source still works — project MCP servers launch with cwd at the
 * project root), and the portable npx launcher otherwise.
 */
function relativeLocalMcpEntry(pkgRoot, targetDir) {
  const rel = path.relative(targetDir, resolveLocalServerPath(pkgRoot, 'project'));
  // Committed config must be separator-portable too.
  return { command: 'node', args: [rel.split(path.sep).join('/')] };
}

function resolveMcpEntry({ pkgRoot, pkgVersion, scope = 'project', targetDir = pkgRoot }) {
  if (!isSourceCheckout(pkgRoot)) {
    return codexAutoUpdateMcpEntry();
  }
  if (scope === 'home') {
    if (publishedCliAvailable(pkgVersion)) return codexAutoUpdateMcpEntry();
    return localMcpEntry(pkgRoot, scope);
  }
  // scope === 'project': this is going into shared, committed config.
  if (isSameCheckoutFamily(pkgRoot, targetDir)) {
    return relativeLocalMcpEntry(pkgRoot, targetDir);
  }
  return codexAutoUpdateMcpEntry();
}

module.exports = {
  publishedCliAvailable,
  isVersionPublished,
  isSourceCheckout,
  isSameCheckoutFamily,
  localMcpEntry,
  parseWorktreePaths,
  portableMcpEntry,
  relativeLocalMcpEntry,
  resolveGitCommonDir,
  resolveLocalServerPath,
  resolveMcpEntry,
  resolveStableSourceRoot,
  codexAutoUpdateCliEntry,
  codexAutoUpdateMcpEntry,
};
