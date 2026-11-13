'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { StorageManager } = require('../src/storage-manager');

describe('StorageManager (Claude Desktop /storage Breakdown)', () => {
  it('should calculate storage usage across worktrees, sessions, caches, and SQLite databases', () => {
    const sm = new StorageManager({ rootDir: path.join(__dirname, '..') });
    const usage = sm.getStorageBreakdown();

    assert.ok(usage.breakdown.worktrees);
    assert.ok(usage.breakdown.agentSessions);
    assert.ok(usage.breakdown.runtimeCaches);
    assert.ok(usage.breakdown.sqliteDatabases);
    assert.ok(typeof usage.totalHuman === 'string');
  });

  it('should safely prune old temporary test diff scratch files', () => {
    const tmpDir = os.tmpdir();
    const testFile = path.join(tmpDir, `pool_mcp_test_prune_${Date.now()}.txt`);
    fs.writeFileSync(testFile, 'dummy scratch content');

    // Modify mtime to simulate 40 days old
    const fortyDaysAgo = (Date.now() - (40 * 24 * 60 * 60 * 1000)) / 1000;
    fs.utimesSync(testFile, fortyDaysAgo, fortyDaysAgo);

    const sm = new StorageManager({ rootDir: path.join(__dirname, '..') });
    const result = sm.pruneInactiveArtifacts({ maxAgeHours: 24 * 30 }); // older than 30 days

    assert.strictEqual(result.ok, true);
    assert.ok(result.bytesReclaimed > 0);
    assert.strictEqual(fs.existsSync(testFile), false, 'Expired test file should be deleted');
  });
});
