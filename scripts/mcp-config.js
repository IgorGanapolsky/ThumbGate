'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { publishedCliArgs, runPublishedCliHelp } = require('./published-cli');
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
    command: 'npx',
    args: publishedCliArgs(pkgVersion, ['serve']),
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
  if (!isVersionPublished(pkgVersion)) {
    return false;
  }
  const override = publishedCliOverride();
  if (override !== null) {
    return override;
  }
  if (cliAvailabilityCache.has(pkgVersion)) {
    return cliAvailabilityCache.get(pkgVersion);
  }

  let available = false;
  try {
    runPublishedCliHelp(pkgVersion, { timeout: 8000 });
    available = true;
  } catch (_) {
    available = false;
  }

  cliAvailabilityCache.set(pkgVersion, available);
  return available;
}

function resolveMcpEntry({ pkgRoot, pkgVersion, scope = 'project', targetDir = pkgRoot }) {
  if (!isSourceCheckout(pkgRoot)) {
    return portableMcpEntry(pkgVersion);
  }
  if (scope === 'project' && !isSameCheckoutFamily(pkgRoot, targetDir) && publishedCliAvailable(pkgVersion)) {
    return portableMcpEntry(pkgVersion);
  }
  return localMcpEntry(pkgRoot, scope);
}

module.exports = {
  publishedCliAvailable,
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
