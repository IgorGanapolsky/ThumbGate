'use strict';

/**
 * Tests for scripts/install-mcp.js
 *
 * Verifies:
 *   1. Generates correct MCP config JSON
 *   2. Idempotent (no duplicate on re-run)
 *   3. Handles missing settings file (creates it)
 *   4. Respects --project flag
 *   5. Creates backup before modifying
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  MCP_SERVER_KEY,
  MCP_SERVER_CONFIG,
  isAlreadyInstalled,
  buildMcpConfig,
  installMcp,
  parseFlags,
} = require('../scripts/install-mcp');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-install-mcp-test-'));
}

describe('install-mcp', () => {
  let tmpDir;

  before(() => {
    tmpDir = makeTmpDir();
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('buildMcpConfig generates correct MCP config JSON', () => {
    const config = buildMcpConfig();
    assert.deepStrictEqual(config, {
      rlhf: MCP_SERVER_CONFIG,
    });
  });

  test('MCP_SERVER_CONFIG prefers local direct server path in source checkouts', () => {
    assert.equal(MCP_SERVER_CONFIG.command, 'node');
    assert.equal(MCP_SERVER_CONFIG.args.length, 1);
    assert.match(MCP_SERVER_CONFIG.args[0], /adapters[\\/]mcp[\\/]server-stdio\.js$/);
  });

  test('parseFlags detects --project flag', () => {
    assert.deepStrictEqual(parseFlags(['--project']), { project: true });
    assert.deepStrictEqual(parseFlags([]), {});
    assert.deepStrictEqual(parseFlags(['--dry-run']), { dryRun: true });
  });

  test('isAlreadyInstalled returns false for empty settings', () => {
    assert.equal(isAlreadyInstalled(null), false);
    assert.equal(isAlreadyInstalled({}), false);
    assert.equal(isAlreadyInstalled({ mcpServers: {} }), false);
  });

  test('isAlreadyInstalled returns true when server exists', () => {
    const settings = {
      mcpServers: {
        [MCP_SERVER_KEY]: MCP_SERVER_CONFIG,
      },
    };
    assert.equal(isAlreadyInstalled(settings), true);
  });

  test('handles missing settings file by creating it', () => {
    const isolatedDir = makeTmpDir();
    const settingsDir = path.join(isolatedDir, '.claude');
    const settingsPath = path.join(settingsDir, 'settings.json');

    // Override HOME so installMcp targets our temp dir
    const origHome = process.env.HOME;
    process.env.HOME = isolatedDir;
    try {
      const result = installMcp({});
      assert.equal(result.installed, true);
      assert.ok(fs.existsSync(settingsPath), 'settings.json should be created');

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      assert.ok(settings.mcpServers, 'mcpServers key should exist');
      assert.deepStrictEqual(settings.mcpServers[MCP_SERVER_KEY], MCP_SERVER_CONFIG);
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  test('idempotent — no duplicate on re-run', () => {
    const isolatedDir = makeTmpDir();
    const origHome = process.env.HOME;
    process.env.HOME = isolatedDir;
    try {
      // First install
      const result1 = installMcp({});
      assert.equal(result1.installed, true);

      // Second install — should detect existing entry
      const result2 = installMcp({});
      assert.equal(result2.installed, false);
      assert.equal(result2.reason, 'already-installed');

      // Verify only one entry
      const settingsPath = path.join(isolatedDir, '.claude', 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const serverKeys = Object.keys(settings.mcpServers);
      assert.equal(serverKeys.filter((k) => k === MCP_SERVER_KEY).length, 1);
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  test('replaces a stale existing server entry with the resolved config', () => {
    const isolatedDir = makeTmpDir();
    const settingsDir = path.join(isolatedDir, '.claude');
    const settingsPath = path.join(settingsDir, 'settings.json');

    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      mcpServers: {
        [MCP_SERVER_KEY]: {
          command: 'npx',
          args: ['-y', 'rlhf-feedback-loop', 'serve'],
        },
      },
    }, null, 2) + '\n');

    const origHome = process.env.HOME;
    process.env.HOME = isolatedDir;
    try {
      const result = installMcp({});
      assert.equal(result.installed, true);
      const updated = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      assert.deepStrictEqual(updated.mcpServers[MCP_SERVER_KEY], MCP_SERVER_CONFIG);
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  test('respects --project flag — writes to cwd/.claude/settings.json', () => {
    const isolatedDir = makeTmpDir();
    const origCwd = process.cwd();
    process.chdir(isolatedDir);
    try {
      const result = installMcp({ project: true });
      assert.equal(result.installed, true);
      assert.ok(result.path.includes(isolatedDir), 'path should be under project dir');

      const settingsPath = path.join(isolatedDir, '.claude', 'settings.json');
      assert.ok(fs.existsSync(settingsPath), 'project settings.json should be created');

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      assert.deepStrictEqual(settings.mcpServers[MCP_SERVER_KEY], MCP_SERVER_CONFIG);
    } finally {
      process.chdir(origCwd);
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  test('creates backup before modifying existing settings', () => {
    const isolatedDir = makeTmpDir();
    const settingsDir = path.join(isolatedDir, '.claude');
    const settingsPath = path.join(settingsDir, 'settings.json');

    // Create pre-existing settings
    fs.mkdirSync(settingsDir, { recursive: true });
    const original = { existingKey: 'value' };
    fs.writeFileSync(settingsPath, JSON.stringify(original, null, 2) + '\n');

    const origHome = process.env.HOME;
    process.env.HOME = isolatedDir;
    try {
      const result = installMcp({});
      assert.equal(result.installed, true);
      assert.ok(result.backup, 'backup path should be returned');
      assert.ok(fs.existsSync(result.backup), 'backup file should exist');

      // Backup should contain original content
      const backupContent = JSON.parse(fs.readFileSync(result.backup, 'utf8'));
      assert.equal(backupContent.existingKey, 'value');
      assert.equal(backupContent.mcpServers, undefined, 'backup should not have mcpServers');

      // New file should have both original and new content
      const updated = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      assert.equal(updated.existingKey, 'value');
      assert.deepStrictEqual(updated.mcpServers[MCP_SERVER_KEY], MCP_SERVER_CONFIG);
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  test('preserves existing mcpServers entries', () => {
    const isolatedDir = makeTmpDir();
    const settingsDir = path.join(isolatedDir, '.claude');
    const settingsPath = path.join(settingsDir, 'settings.json');

    fs.mkdirSync(settingsDir, { recursive: true });
    const original = {
      mcpServers: {
        'other-server': { command: 'node', args: ['other.js'] },
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(original, null, 2) + '\n');

    const origHome = process.env.HOME;
    process.env.HOME = isolatedDir;
    try {
      const result = installMcp({});
      assert.equal(result.installed, true);

      const updated = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      assert.ok(updated.mcpServers['other-server'], 'existing server should be preserved');
      assert.deepStrictEqual(updated.mcpServers[MCP_SERVER_KEY], MCP_SERVER_CONFIG);
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });
});
