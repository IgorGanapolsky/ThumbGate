'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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
  if (!isSourceCheckout(pkgRoot)) {
    return null;
  }

  try {
    const output = execFileSync('git', ['-C', pkgRoot, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const worktreePaths = parseWorktreePaths(output);

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
    return pkgRoot;
  }

  return pkgRoot;
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
    command: 'npx',
    args: ['-y', `thumbgate@${pkgVersion}`, 'serve'],
  };
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

function resolveMcpEntry({ pkgRoot, pkgVersion, scope = 'project', targetDir = pkgRoot }) {
  if (!isSourceCheckout(pkgRoot)) {
    return portableMcpEntry(pkgVersion);
  }
  if (scope === 'project' && !isSameCheckoutFamily(pkgRoot, targetDir) && isVersionPublished(pkgVersion)) {
    return portableMcpEntry(pkgVersion);
  }
  return localMcpEntry(pkgRoot, scope);
}

module.exports = {
  isVersionPublished,
  isSourceCheckout,
  isSameCheckoutFamily,
  localMcpEntry,
  parseWorktreePaths,
  portableMcpEntry,
  resolveGitCommonDir,
  resolveLocalServerPath,
  resolveMcpEntry,
  resolveStableSourceRoot,
};
