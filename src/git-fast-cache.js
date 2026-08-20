'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/**
 * GitFastCache — High-performance shadow git metadata cache.
 * Inspired by Cursor's Continuity/Spokes architecture (Aug 2026).
 *
 * Replaces recurring synchronous git subprocess calls (git rev-parse, git status, git diff)
 * during PreToolUse evaluation with mtime-invalidated in-memory cache lookups (<0.2ms).
 */

class GitFastCache {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs || 3000;
    this.cache = new Map(); // repoRoot -> CachedRepoState
  }

  findRepoRoot(startDir = process.cwd()) {
    let current = path.resolve(startDir);
    try {
      current = fs.realpathSync(current);
    } catch {
      // fallback
    }
    while (current !== path.dirname(current)) {
      const gitDir = path.join(current, '.git');
      if (fs.existsSync(gitDir)) {
        return current;
      }
      current = path.dirname(current);
    }
    return null;
  }

  getGitMetaDir(repoRoot) {
    const gitPath = path.join(repoRoot, '.git');
    if (!fs.existsSync(gitPath)) return null;

    try {
      const stat = fs.statSync(gitPath);
      if (stat.isDirectory()) return fs.realpathSync(gitPath);
      if (stat.isFile()) {
        // Handle git worktree pointer file: "gitdir: /path/to/worktree"
        const content = fs.readFileSync(gitPath, 'utf8').trim();
        const match = /^gitdir:\s*(.+)$/i.exec(content);
        if (match?.[1]) {
          return fs.realpathSync(path.resolve(repoRoot, match[1].trim()));
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  getCacheFingerprint(gitDir) {
    if (!gitDir || !fs.existsSync(gitDir)) return 'empty';
    try {
      const headFile = path.join(gitDir, 'HEAD');
      const indexFile = path.join(gitDir, 'index');
      const headMtime = fs.existsSync(headFile) ? fs.statSync(headFile).mtimeMs : 0;
      const indexMtime = fs.existsSync(indexFile) ? fs.statSync(indexFile).mtimeMs : 0;
      return `${headMtime}:${indexMtime}`;
    } catch {
      return 'unknown';
    }
  }

  getRepoState(targetDir = process.cwd()) {
    const repoRoot = this.findRepoRoot(targetDir);
    if (!repoRoot) {
      return {
        isGitRepo: false,
        repoRoot: null,
        branch: null,
        headSha: null,
        isDirty: false,
        stagedFiles: [],
        lookupTimeMs: 0,
      };
    }

    const start = process.hrtime.bigint();
    const gitDir = this.getGitMetaDir(repoRoot);
    const fingerprint = this.getCacheFingerprint(gitDir);
    const now = Date.now();

    const cached = this.cache.get(repoRoot);
    if (cached && cached.fingerprint === fingerprint && (now - cached.cachedAt) < this.ttlMs) {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      return { ...cached.state, lookupTimeMs: durationMs, cached: true };
    }

    // Refresh state from git inspection
    let branch = 'unknown';
    let headSha = null;

    if (gitDir) {
      try {
        const headContent = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
        if (headContent.startsWith('ref: refs/heads/')) {
          branch = headContent.replace('ref: refs/heads/', '');
          const refFile = path.join(gitDir, 'refs', 'heads', branch);
          if (fs.existsSync(refFile)) {
            headSha = fs.readFileSync(refFile, 'utf8').trim();
          }
        } else {
          headSha = headContent;
        }
      } catch {
        // fallback
      }
    }

    if (!headSha) {
      try {
        headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        headSha = null;
      }
    }

    let stagedFiles = [];
    let isDirty = false;
    try {
      const stagedOut = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      stagedFiles = stagedOut.split('\n').map((s) => s.trim()).filter(Boolean);
      const statusOut = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      isDirty = statusOut.trim().length > 0;
    } catch {
      // fallback
    }

    const state = {
      isGitRepo: true,
      repoRoot,
      branch,
      headSha,
      isDirty,
      stagedFiles,
    };

    const finalFingerprint = this.getCacheFingerprint(gitDir);
    this.cache.set(repoRoot, {
      fingerprint: finalFingerprint,
      cachedAt: now,
      state,
    });

    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    return { ...state, lookupTimeMs: durationMs, cached: false };
  }

  clear() {
    this.cache.clear();
  }
}

const defaultCache = new GitFastCache();

module.exports = {
  GitFastCache,
  defaultCache,
};
