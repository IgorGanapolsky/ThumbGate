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
  LEGACY_MCP_SERVER_KEYS,
  resolveMcpServerConfig,
  isAlreadyInstalled,
  buildMcpConfig,
  installMcp,
  installHooks,
  installMcpAndHooks,
  parseFlags,
} = require('../scripts/install-mcp');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-install-mcp-test-'));
}

function assertLatestResolvingMcpConfig(entry) {
  assert.equal(entry.command, 'sh');
  assert.deepEqual(entry.args.slice(0, 1), ['-lc']);
  assert.match(entry.args[1], /thumbgate@latest/);
  assert.match(entry.args[1], /npm "install"/);
  assert.doesNotMatch(entry.args[1], /\[ -x /);
  assert.match(entry.args[1], /\.thumbgate\/runtime/);
  assert.match(entry.args[1], /thumbgate/);
  assert.match(entry.args[1], /serve/);
}

const savedPublishState = process.env.THUMBGATE_PUBLISH_STATE;
const savedCliState = process.env.THUMBGATE_PUBLISHED_CLI_STATE;

function withPublishState(value, run) {
  const previous = process.env.THUMBGATE_PUBLISH_STATE;
  process.env.THUMBGATE_PUBLISH_STATE = value;
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.THUMBGATE_PUBLISH_STATE;
    } else {
      process.env.THUMBGATE_PUBLISH_STATE = previous;
    }
  }
}

function withCliState(value, run) {
  const previous = process.env.THUMBGATE_PUBLISHED_CLI_STATE;
  process.env.THUMBGATE_PUBLISHED_CLI_STATE = value;
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.THUMBGATE_PUBLISHED_CLI_STATE;
    } else {
      process.env.THUMBGATE_PUBLISHED_CLI_STATE = previous;
    }
  }
}

describe('install-mcp', () => {
  let tmpDir;

  before(() => {
    tmpDir = makeTmpDir();
    process.env.THUMBGATE_PUBLISH_STATE = 'published';
    process.env.THUMBGATE_PUBLISHED_CLI_STATE = 'available';
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (savedPublishState === undefined) {
      delete process.env.THUMBGATE_PUBLISH_STATE;
    } else {
      process.env.THUMBGATE_PUBLISH_STATE = savedPublishState;
    }
    if (savedCliState === undefined) {
      delete process.env.THUMBGATE_PUBLISHED_CLI_STATE;
    } else {
      process.env.THUMBGATE_PUBLISHED_CLI_STATE = savedCliState;
    }
  });

  test('buildMcpConfig generates correct MCP config JSON', () => {
    const config = buildMcpConfig();
    assert.deepStrictEqual(config, {
      thumbgate: resolveMcpServerConfig(),
    });
  });

  test('resolveMcpServerConfig uses a latest-resolving launcher for home installs when the published CLI is available', () => {
    const homeConfig = resolveMcpServerConfig();
    assertLatestResolvingMcpConfig(homeConfig);
  });

  test('resolveMcpServerConfig keeps project installs scoped to the current checkout path', () => {
    const projectConfig = resolveMcpServerConfig({ project: true });
    assert.equal(projectConfig.command, 'node');
    assert.equal(projectConfig.args.length, 1);
    assert.match(projectConfig.args[0], /adapters[\\/]mcp[\\/]server-stdio\.js$/);
  });

  test('resolveMcpServerConfig uses a latest-resolving launcher for external project installs', () => {
    const isolatedDir = makeTmpDir();
    const projectConfig = resolveMcpServerConfig({ project: true, cwd: isolatedDir });

    assert.equal(projectConfig.command, 'sh');
    assert.deepEqual(projectConfig.args.slice(0, 1), ['-lc']);
    assert.match(projectConfig.args[1], /thumbgate@latest/);
    assert.match(projectConfig.args[1], /npm "install"/);
    assert.doesNotMatch(projectConfig.args[1], /\[ -x /);
    assert.match(projectConfig.args[1], /\.thumbgate\/runtime/);
    assert.match(projectConfig.args[1], /serve/);

    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });

  test('resolveMcpServerConfig keeps a local launcher for unpublished external project installs', () => {
    const isolatedDir = makeTmpDir();

    const projectConfig = withPublishState('unpublished', () => withCliState('unavailable', () => resolveMcpServerConfig({ project: true, cwd: isolatedDir })));

    assert.equal(projectConfig.command, 'node');
    assert.equal(projectConfig.args.length, 1);
    assert.match(projectConfig.args[0], /adapters[\\/]mcp[\\/]server-stdio\.js$/);

    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });

  test('resolveMcpServerConfig keeps a local launcher when the published CLI is unavailable', () => {
    const isolatedDir = makeTmpDir();

    const projectConfig = withCliState('unavailable', () => resolveMcpServerConfig({ project: true, cwd: isolatedDir }));

    assert.equal(projectConfig.command, 'node');
    assert.equal(projectConfig.args.length, 1);
    assert.match(projectConfig.args[0], /adapters[\\/]mcp[\\/]server-stdio\.js$/);

    fs.rmSync(isolatedDir, { recursive: true, force: true });
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
        [MCP_SERVER_KEY]: resolveMcpServerConfig(),
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
      assertLatestResolvingMcpConfig(settings.mcpServers[MCP_SERVER_KEY]);
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
          args: ['-y', 'thumbgate', 'serve'],
        },
      },
    }, null, 2) + '\n');

    const origHome = process.env.HOME;
    process.env.HOME = isolatedDir;
    try {
      const result = installMcp({});
      assert.equal(result.installed, true);
      const updated = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      assertLatestResolvingMcpConfig(updated.mcpServers[MCP_SERVER_KEY]);
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  test('migrates legacy MCP server keys to thumbgate', () => {
    const isolatedDir = makeTmpDir();
    const settingsDir = path.join(isolatedDir, '.claude');
    const settingsPath = path.join(settingsDir, 'settings.json');

    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      mcpServers: {
        'mcp-memory-gateway': {
          command: 'npx',
          args: ['-y', 'mcp-memory-gateway', 'serve'],
        },
        rlhf: {
          command: 'node',
          args: ['/tmp/old/server-stdio.js'],
        },
      },
    }, null, 2) + '\n');

    const origHome = process.env.HOME;
    process.env.HOME = isolatedDir;
    try {
      const result = installMcp({});
      assert.equal(result.installed, true);
      const updated = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      assertLatestResolvingMcpConfig(updated.mcpServers[MCP_SERVER_KEY]);
      for (const legacyKey of LEGACY_MCP_SERVER_KEYS) {
        assert.equal(Object.prototype.hasOwnProperty.call(updated.mcpServers, legacyKey), false);
      }
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
      assert.deepStrictEqual(
        settings.mcpServers[MCP_SERVER_KEY].command,
        'sh'
      );
      assertLatestResolvingMcpConfig(settings.mcpServers[MCP_SERVER_KEY]);
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
      assertLatestResolvingMcpConfig(updated.mcpServers[MCP_SERVER_KEY]);
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
      assertLatestResolvingMcpConfig(updated.mcpServers[MCP_SERVER_KEY]);
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// install-mcp + hooks integration
// ---------------------------------------------------------------------------
// The headline UX in README/landing-page is a single command. Prior to this
// suite, `install-mcp` only wrote mcpServers and silently left the gate hooks
// unwired, leaving every user with a half-installed system. These tests pin
// the unified install path: by default, install-mcp wires BOTH the MCP server
// and the Claude Code lifecycle hooks. `--no-hooks` opts out for callers that
// only want the server entry.

describe('install-mcp + hooks integration', () => {
  test('parseFlags detects --no-hooks flag', () => {
    assert.equal(parseFlags(['--no-hooks']).noHooks, true);
    assert.equal(parseFlags([]).noHooks, undefined);
  });

  test('installMcpAndHooks wires both server entry and Claude hook lifecycles', () => {
    const isolatedDir = makeTmpDir();
    const origHome = process.env.HOME;
    process.env.HOME = isolatedDir;
    try {
      const result = installMcpAndHooks({});
      assert.equal(result.mcp.installed, true, 'MCP server should be installed');
      assert.ok(!result.hooks.error, `hook wiring should not error: ${result.hooks.error || ''}`);

      // Hooks land in settings.local.json per Claude Code's per-machine
      // override convention; the MCP entry + statusLine land in settings.json.
      const mcpSettings = JSON.parse(
        fs.readFileSync(path.join(isolatedDir, '.claude', 'settings.json'), 'utf8')
      );
      assert.ok(
        mcpSettings.mcpServers && mcpSettings.mcpServers[MCP_SERVER_KEY],
        'MCP server entry must be present in settings.json'
      );

      const hookSettingsPath = path.join(isolatedDir, '.claude', 'settings.local.json');
      assert.ok(fs.existsSync(hookSettingsPath), 'hook settings.local.json must exist');
      const hookSettings = JSON.parse(fs.readFileSync(hookSettingsPath, 'utf8'));
      assert.ok(hookSettings.hooks, 'hooks block must exist in settings.local.json');

      // Every Claude lifecycle this installer is responsible for must land.
      for (const lifecycle of ['PreToolUse', 'UserPromptSubmit', 'PostToolUse', 'SessionStart']) {
        assert.ok(
          Array.isArray(hookSettings.hooks[lifecycle]) && hookSettings.hooks[lifecycle].length > 0,
          `expected hooks.${lifecycle} to be wired`
        );
      }
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  test('installMcpAndHooks respects --no-hooks (MCP only, no hook writes)', () => {
    const isolatedDir = makeTmpDir();
    const origHome = process.env.HOME;
    process.env.HOME = isolatedDir;
    try {
      const result = installMcpAndHooks({ noHooks: true });
      assert.equal(result.mcp.installed, true, 'MCP server should still be installed');
      assert.equal(result.hooks.skipped, true, 'hooks should be marked skipped');
      assert.equal(result.hooks.wired, false, 'hooks should not be wired');

      const hookSettingsPath = path.join(isolatedDir, '.claude', 'settings.local.json');
      // Either the file doesn't exist, or it exists with no hooks block.
      if (fs.existsSync(hookSettingsPath)) {
        const hookSettings = JSON.parse(fs.readFileSync(hookSettingsPath, 'utf8'));
        assert.equal(
          hookSettings.hooks,
          undefined,
          '--no-hooks must NOT write a hooks block to settings.local.json'
        );
      }
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  test('installMcpAndHooks is idempotent across both MCP and hook surfaces', () => {
    const isolatedDir = makeTmpDir();
    const origHome = process.env.HOME;
    process.env.HOME = isolatedDir;
    try {
      const first = installMcpAndHooks({});
      assert.equal(first.mcp.installed, true);
      assert.ok(!first.hooks.error);

      const second = installMcpAndHooks({});
      // MCP install reports `installed: false` with reason already-installed on
      // re-run; the hook wiring should likewise be a no-op (no added entries).
      assert.equal(second.mcp.installed, false);
      assert.equal(second.mcp.reason, 'already-installed');
      assert.ok(!second.hooks.error);
      assert.equal(
        (second.hooks.added || []).length,
        0,
        're-run should not add hook entries that were already wired'
      );
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  test('installHooks returns a structured failure rather than throwing', () => {
    // Confirm the contract: callers should always get {wired, settingsPath,
    // added, error?}. We force the error path by pointing HOME at a path
    // where mkdir will fail (an existing regular file).
    const tmpFile = path.join(makeTmpDir(), 'home-as-file');
    fs.writeFileSync(tmpFile, 'not-a-dir');
    const origHome = process.env.HOME;
    process.env.HOME = tmpFile;
    try {
      const result = installHooks({});
      // Either the helper recovered (wired: true/false) or it captured the
      // error — both are fine; the contract is "do not throw".
      assert.equal(typeof result, 'object');
      assert.equal('wired' in result, true);
      assert.equal('settingsPath' in result, true);
      assert.equal('added' in result, true);
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(tmpFile, { force: true });
    }
  });
});
