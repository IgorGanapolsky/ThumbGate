/**
 * Deterministic Storage Auditor & Agent Artifact Pruner.
 * 
 * Inspired by Lydia Hallie's breakdown of Claude Desktop /storage:
 * - Breaks disk usage down into:
 *   1. Agent Code sessions & ephemeral git worktrees
 *   2. Cowork & Fleet handoffs (~/.thumbgate, AI-Agent-Sync)
 *   3. Ephemeral runtime caches & test diff artifacts (/tmp/pool_*, .test-results)
 *   4. SQLite memory logs & decision traces
 * - Supports age-based pruning (30, 60, 90 days, or custom hours).
 * - Safe prune: removes dangling worktrees and orphaned scratch files without
 *   touching active surface leases or locked git workspaces.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

class StorageManager {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd();
    this.homeDir = options.homeDir || os.homedir();
  }

  getStorageBreakdown() {
    const categories = {
      worktrees: this._getWorktreesUsage(),
      agentSessions: this._getDirectoryUsage(path.join(this.homeDir, '.thumbgate', 'sessions')),
      runtimeCaches: this._getRuntimeCacheUsage(),
      sqliteDatabases: this._getSqliteUsage(),
    };

    let totalBytes = 0;
    for (const cat of Object.values(categories)) {
      totalBytes += cat.bytes;
    }

    return {
      totalBytes,
      totalHuman: this._formatBytes(totalBytes),
      breakdown: categories,
    };
  }

  pruneInactiveArtifacts(options = {}) {
    const maxAgeHours = options.maxAgeHours || 24 * 30; // default 30 days
    const now = Date.now();
    let bytesReclaimed = 0;
    const prunedItems = [];

    // 1. Prune dangling git worktrees safely
    try {
      execSync('git worktree prune', { cwd: this.rootDir, stdio: 'ignore' });
      prunedItems.push('Pruned dangling git worktrees');
    } catch (_) {}

    // 2. Prune old /tmp scratch files matching agent patterns
    const tmpDir = os.tmpdir();
    try {
      const files = fs.readdirSync(tmpDir);
      for (const file of files) {
        if (file.startsWith('pool_mcp_') || file.startsWith('test_diff_') || file.startsWith('gtm_test_')) {
          const fullPath = path.join(tmpDir, file);
          const stat = fs.statSync(fullPath);
          const ageHours = (now - stat.mtimeMs) / (1000 * 60 * 60);
          if (ageHours >= maxAgeHours) {
            bytesReclaimed += stat.size;
            fs.unlinkSync(fullPath);
            prunedItems.push(fullPath);
          }
        }
      }
    } catch (_) {}

    return {
      ok: true,
      bytesReclaimed,
      reclaimedHuman: this._formatBytes(bytesReclaimed),
      prunedCount: prunedItems.length,
      prunedItems,
    };
  }

  _getWorktreesUsage() {
    let count = 0;
    let bytes = 0;
    try {
      const output = execSync('git worktree list --porcelain', { cwd: this.rootDir, encoding: 'utf8' });
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          count++;
          const wtPath = line.replace('worktree ', '').trim();
          if (wtPath !== this.rootDir && fs.existsSync(wtPath)) {
            bytes += this._calcDirSize(wtPath);
          }
        }
      }
    } catch (_) {}

    return {
      count,
      bytes,
      human: this._formatBytes(bytes),
      description: 'Active and orphaned git worktrees for agent checkout isolation',
    };
  }

  _getRuntimeCacheUsage() {
    let bytes = 0;
    const testResultsDir = path.join(this.rootDir, '.test-results');
    if (fs.existsSync(testResultsDir)) {
      bytes += this._calcDirSize(testResultsDir);
    }
    return {
      bytes,
      human: this._formatBytes(bytes),
      description: 'Ephemeral test output diffs and runtime intermediate files',
    };
  }

  _getSqliteUsage() {
    let bytes = 0;
    const dayglassDb = path.join(this.homeDir, '.dayglass', 'dayglass.sqlite');
    if (fs.existsSync(dayglassDb)) {
      bytes += fs.statSync(dayglassDb).size;
    }
    const thumbgateDb = path.join(this.homeDir, '.thumbgate', 'thumbgate.sqlite');
    if (fs.existsSync(thumbgateDb)) {
      bytes += fs.statSync(thumbgateDb).size;
    }

    return {
      bytes,
      human: this._formatBytes(bytes),
      description: 'Persistent SQLite databases and interaction ledgers',
    };
  }

  _getDirectoryUsage(dirPath) {
    if (!fs.existsSync(dirPath)) {
      return { bytes: 0, human: '0 B', description: 'Agent sessions and state snapshots' };
    }
    const bytes = this._calcDirSize(dirPath);
    return {
      bytes,
      human: this._formatBytes(bytes),
      description: 'Agent sessions and state snapshots',
    };
  }

  _calcDirSize(dir) {
    let total = 0;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          total += this._calcDirSize(full);
        } else if (entry.isFile()) {
          total += fs.statSync(full).size;
        }
      }
    } catch (_) {}
    return total;
  }

  _formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}

module.exports = {
  StorageManager,
};
