'use strict';

/**
 * self-dev-mode.js — jcode-Inspired Self-Dev Mode & Dynamic Hot-Reloading
 *
 * Enables ThumbGate to dynamically inspect, syntax-check, test, and hot-reload
 * its own modules in memory without restarting the parent Node process or CLI session.
 *
 * Inspired by 1jehuang/jcode Self-Dev Mode.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');

/**
 * Checks if a file path is eligible for hot-reloading within the ThumbGate codebase.
 * @param {string} targetPath Absolute or relative file path
 * @returns {boolean}
 */
function canHotReload(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return false;
  const absPath = path.isAbsolute(targetPath) ? targetPath : path.join(ROOT_DIR, targetPath);

  if (!fs.existsSync(absPath)) return false;
  if (!absPath.startsWith(ROOT_DIR)) return false;

  // Protect package.json, lockfiles, and node_modules from raw require.cache purging
  if (absPath.includes('node_modules')) return false;
  if (absPath.endsWith('package.json') || absPath.endsWith('package-lock.json')) return false;

  return absPath.endsWith('.js') || absPath.endsWith('.cjs') || absPath.endsWith('.mjs');
}

/**
 * Safely purges a module and its cached children from Node.js require.cache.
 * @param {string} targetPath Absolute file path
 * @returns {boolean} True if cache was invalidated
 */
function purgeRequireCache(targetPath) {
  const absPath = path.isAbsolute(targetPath) ? targetPath : path.join(ROOT_DIR, targetPath);
  const resolvedPath = path.resolve(absPath);

  if (!require.cache[resolvedPath]) {
    return false;
  }

  // Delete from require.cache
  delete require.cache[resolvedPath];
  return true;
}

/**
 * Runs syntax check (node --check) on a target file to verify correctness before reload.
 * @param {string} targetPath Absolute file path
 * @returns {{ ok: boolean, error: string|null }}
 */
function checkSyntax(targetPath) {
  const absPath = path.isAbsolute(targetPath) ? targetPath : path.join(ROOT_DIR, targetPath);
  const res = spawnSync(process.execPath, ['--check', absPath], { encoding: 'utf8', timeout: 5000 });

  if (res.status !== 0) {
    return {
      ok: false,
      error: res.stderr || res.stdout || `Syntax check failed with code ${res.status}`,
    };
  }

  return { ok: true, error: null };
}

/**
 * Performs full self-dev hot-reload cycle:
 *   1. Check eligibility
 *   2. Syntax check (node --check)
 *   3. Purge require.cache
 *   4. Re-require module and return new exports
 *
 * @param {string} targetPath Absolute or relative module path
 * @returns {{ ok: boolean, reloaded: boolean, exports: any, error: string|null }}
 */
function verifyAndHotReloadModule(targetPath) {
  const absPath = path.isAbsolute(targetPath) ? targetPath : path.join(ROOT_DIR, targetPath);

  if (!canHotReload(absPath)) {
    return {
      ok: false,
      reloaded: false,
      exports: null,
      error: `Module ${targetPath} is not eligible for self-dev hot-reload`,
    };
  }

  const syntaxResult = checkSyntax(absPath);
  if (!syntaxResult.ok) {
    return {
      ok: false,
      reloaded: false,
      exports: null,
      error: `Syntax validation failed: ${syntaxResult.error}`,
    };
  }

  const purged = purgeRequireCache(absPath);

  let newExports = null;
  try {
    newExports = require(absPath);
  } catch (err) {
    return {
      ok: false,
      reloaded: false,
      exports: null,
      error: `Failed to re-require module: ${err.message}`,
    };
  }

  return {
    ok: true,
    reloaded: true,
    wasCached: purged,
    exports: newExports,
    error: null,
  };
}

module.exports = {
  canHotReload,
  purgeRequireCache,
  checkSyntax,
  verifyAndHotReloadModule,
};
