'use strict';

/**
 * Tests for `npx thumbgate init --agent cursor` wiring.
 *
 * README line 125 promised `--agent cursor` works. It didn't — the dispatcher
 * returned "Unsupported agent". These tests guard against regressing the
 * promise: detectAgent accepts 'cursor', dispatcher routes to wireCursorHooks,
 * and the result writes to .cursor/mcp.json with the thumbgate MCP server.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectAgent, wireHooks } = require('../scripts/auto-wire-hooks');

describe('cursor agent support in auto-wire-hooks', () => {
  let prevCwd;
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cursor-test-'));
    prevCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  test('detectAgent("cursor") returns "cursor"', () => {
    assert.equal(detectAgent('cursor'), 'cursor');
    assert.equal(detectAgent('CURSOR'), 'cursor');
  });

  test('wireHooks({ agent: "cursor", dryRun: true }) reports intended write', () => {
    const r = wireHooks({ agent: 'cursor', dryRun: true });
    assert.equal(r.agent, 'cursor');
    assert.ok(r.changed, 'should plan to write MCP config');
    assert.match(r.settingsPath, /\.cursor\/mcp\.json$/);
    assert.ok(Array.isArray(r.added) && r.added.length === 1);
    assert.match(r.added[0].command, /thumbgate/);
  });

  test('wireHooks({ agent: "cursor" }) writes .cursor/mcp.json with thumbgate MCP server', () => {
    const r = wireHooks({ agent: 'cursor' });
    assert.ok(r.changed);
    const mcpPath = path.join(tempDir, '.cursor', 'mcp.json');
    assert.ok(fs.existsSync(mcpPath), '.cursor/mcp.json must be written');
    const written = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    assert.ok(written.mcpServers, 'must have mcpServers section');
    assert.ok(written.mcpServers.thumbgate, 'must register thumbgate server');
    assert.equal(written.mcpServers.thumbgate.command, 'npx');
    assert.ok(
      Array.isArray(written.mcpServers.thumbgate.args) &&
      written.mcpServers.thumbgate.args.includes('thumbgate'),
      'args must include thumbgate',
    );
  });

  test('re-running wireHooks preserves other mcpServers entries', () => {
    const mcpDir = path.join(tempDir, '.cursor');
    fs.mkdirSync(mcpDir, { recursive: true });
    fs.writeFileSync(
      path.join(mcpDir, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          'other-server': { command: 'node', args: ['foo.js'] },
        },
      }, null, 2),
    );

    wireHooks({ agent: 'cursor' });

    const written = JSON.parse(fs.readFileSync(path.join(mcpDir, 'mcp.json'), 'utf8'));
    assert.ok(written.mcpServers['other-server'], 'must preserve existing servers');
    assert.ok(written.mcpServers.thumbgate, 'must add thumbgate');
  });

  test('idempotent — second run reports no change', () => {
    wireHooks({ agent: 'cursor' });
    const second = wireHooks({ agent: 'cursor' });
    assert.equal(second.changed, false, 'second run must be a no-op');
  });
});
