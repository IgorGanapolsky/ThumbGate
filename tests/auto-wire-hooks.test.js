'use strict';

/**
 * Tests for scripts/auto-wire-hooks.js
 *
 * Verifies:
 *   1. Claude Code detection and wiring
 *   2. Codex detection and wiring
 *   3. Gemini detection and wiring
 *   4. Preserving existing hooks
 *   5. Dry-run mode
 *   6. Idempotent (running twice doesn't duplicate)
 *   7. Invalid/missing settings file handling
 *   8. Agent auto-detection
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  detectAgent,
  wireHooks,
  wireClaudeHooks,
  wireCodexHooks,
  wireGeminiHooks,
  hookAlreadyPresent,
  loadJsonFile,
  parseFlags,
  CLAUDE_HOOKS,
  preToolHookCommand,
  userPromptHookCommand,
  sessionStartHookCommand,
} = require('../scripts/auto-wire-hooks');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-wire-hooks-test-'));
}

describe('auto-wire-hooks', () => {
  // --- detectAgent ---

  describe('detectAgent', () => {
    test('returns claude-code when flag is "claude-code"', () => {
      assert.equal(detectAgent('claude-code'), 'claude-code');
    });

    test('returns claude-code when flag is "claude"', () => {
      assert.equal(detectAgent('claude'), 'claude-code');
    });

    test('returns codex when flag is "codex"', () => {
      assert.equal(detectAgent('codex'), 'codex');
    });

    test('returns gemini when flag is "gemini"', () => {
      assert.equal(detectAgent('gemini'), 'gemini');
    });

    test('returns null for unknown agent', () => {
      assert.equal(detectAgent('unknown-agent'), null);
    });

    test('auto-detects claude-code from HOME/.claude', () => {
      const tmpDir = makeTmpDir();
      fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
      const origHome = process.env.HOME;
      process.env.HOME = tmpDir;
      try {
        assert.equal(detectAgent(undefined), 'claude-code');
      } finally {
        process.env.HOME = origHome;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('auto-detects codex from HOME/.codex', () => {
      const tmpDir = makeTmpDir();
      fs.mkdirSync(path.join(tmpDir, '.codex'), { recursive: true });
      const origHome = process.env.HOME;
      process.env.HOME = tmpDir;
      try {
        // Make sure .claude doesn't exist so it falls through to codex
        assert.equal(detectAgent(undefined), 'codex');
      } finally {
        process.env.HOME = origHome;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns null when no agent config found', () => {
      const tmpDir = makeTmpDir();
      const origHome = process.env.HOME;
      process.env.HOME = tmpDir;
      try {
        assert.equal(detectAgent(undefined), null);
      } finally {
        process.env.HOME = origHome;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // --- hookAlreadyPresent ---

  describe('hookAlreadyPresent', () => {
    test('returns false for empty array', () => {
      assert.equal(hookAlreadyPresent([], 'bash foo.sh'), false);
    });

    test('returns false for null', () => {
      assert.equal(hookAlreadyPresent(null, 'bash foo.sh'), false);
    });

    test('returns true when command exists', () => {
      const hooks = [
        { hooks: [{ type: 'command', command: 'bash foo.sh' }] },
      ];
      assert.equal(hookAlreadyPresent(hooks, 'bash foo.sh'), true);
    });

    test('returns false when different command', () => {
      const hooks = [
        { hooks: [{ type: 'command', command: 'bash bar.sh' }] },
      ];
      assert.equal(hookAlreadyPresent(hooks, 'bash foo.sh'), false);
    });
  });

  // --- parseFlags ---

  describe('parseFlags', () => {
    test('parses --dry-run', () => {
      const flags = parseFlags(['--dry-run']);
      assert.equal(flags.dryRun, true);
    });

    test('parses --agent=claude-code', () => {
      const flags = parseFlags(['--agent=claude-code']);
      assert.equal(flags.agent, 'claude-code');
    });

    test('parses --wire-hooks', () => {
      const flags = parseFlags(['--wire-hooks']);
      assert.equal(flags.wireHooks, true);
    });

    test('returns empty for no args', () => {
      const flags = parseFlags([]);
      assert.deepStrictEqual(flags, {});
    });
  });

  // --- wireClaudeHooks ---

  describe('wireClaudeHooks', () => {
    test('creates settings file and wires the full Claude hook bundle', () => {
      const tmpDir = makeTmpDir();
      const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');

      try {
        const result = wireClaudeHooks({ settingsPath });
        assert.equal(result.changed, true);
        assert.equal(result.added.length, 4);

        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        assert.ok(settings.hooks.PreToolUse, 'PreToolUse should exist');
        assert.ok(settings.hooks.UserPromptSubmit, 'UserPromptSubmit should exist');
        assert.ok(settings.hooks.PostToolUse, 'PostToolUse should exist');
        assert.ok(settings.hooks.SessionStart, 'SessionStart should exist');
        assert.ok(settings.statusLine, 'statusLine should exist');

        // Check PreToolUse has matcher
        const preToolEntry = settings.hooks.PreToolUse[0];
        assert.equal(preToolEntry.matcher, 'Bash|Edit|Write|MultiEdit');
        assert.equal(preToolEntry.hooks[0].command, preToolHookCommand());

        const promptEntry = settings.hooks.UserPromptSubmit[0];
        assert.equal(promptEntry.hooks[0].command, userPromptHookCommand());

        const postToolEntry = settings.hooks.PostToolUse[0];
        assert.equal(postToolEntry.hooks[0].command, require('../scripts/hook-runtime').cacheUpdateHookCommand());

        const sessionEntry = settings.hooks.SessionStart[0];
        assert.equal(sessionEntry.hooks[0].command, sessionStartHookCommand());
        assert.equal(settings.statusLine.command, require('../scripts/hook-runtime').statuslineCommand());
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('preserves existing hooks', () => {
      const tmpDir = makeTmpDir();
      const settingsDir = path.join(tmpDir, '.claude');
      const settingsPath = path.join(settingsDir, 'settings.local.json');

      fs.mkdirSync(settingsDir, { recursive: true });
      const existing = {
        hooks: {
          PreToolUse: [
            { hooks: [{ type: 'command', command: 'bash existing-hook.sh' }] },
          ],
        },
        otherKey: 'preserved',
      };
      fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n');

      try {
        const result = wireClaudeHooks({ settingsPath });
        assert.equal(result.changed, true);

        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        assert.equal(settings.otherKey, 'preserved');
        // Existing hook + new hook = 2 entries in PreToolUse
        assert.equal(settings.hooks.PreToolUse.length, 2);
        assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, 'bash existing-hook.sh');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('idempotent — running twice does not duplicate', () => {
      const tmpDir = makeTmpDir();
      const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');

      try {
        const result1 = wireClaudeHooks({ settingsPath });
        assert.equal(result1.changed, true);
        assert.equal(result1.added.length, 4);

        const result2 = wireClaudeHooks({ settingsPath });
        assert.equal(result2.changed, false);
        assert.equal(result2.added.length, 0);

        // Verify only one entry per lifecycle
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        assert.equal(settings.hooks.PreToolUse.length, 1);
        assert.equal(settings.hooks.UserPromptSubmit.length, 1);
        assert.equal(settings.hooks.PostToolUse.length, 1);
        assert.equal(settings.hooks.SessionStart.length, 1);
        assert.ok(settings.statusLine);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('dry-run does not write file', () => {
      const tmpDir = makeTmpDir();
      const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');

      try {
        const result = wireClaudeHooks({ settingsPath, dryRun: true });
        assert.equal(result.changed, true);
        assert.equal(result.added.length, 4);
        assert.equal(fs.existsSync(settingsPath), false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('handles malformed JSON gracefully', () => {
      const tmpDir = makeTmpDir();
      const settingsDir = path.join(tmpDir, '.claude');
      const settingsPath = path.join(settingsDir, 'settings.local.json');

      fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(settingsPath, '{ invalid json !!!');

      try {
        const result = wireClaudeHooks({ settingsPath });
        assert.equal(result.changed, true);
        // Should recover and write valid JSON
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        assert.ok(settings.hooks.PreToolUse);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // --- wireCodexHooks ---

  describe('wireCodexHooks', () => {
    test('creates config and wires PreToolUse hook', () => {
      const tmpDir = makeTmpDir();
      const settingsPath = path.join(tmpDir, '.codex', 'config.json');

      try {
        const result = wireCodexHooks({ settingsPath });
        assert.equal(result.changed, true);
        assert.equal(result.added.length, 2);
        assert.equal(result.added[0].lifecycle, 'PreToolUse');

        const config = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        assert.ok(config.hooks.PreToolUse);
        assert.ok(config.hooks.UserPromptSubmit);
        assert.equal(config.hooks.PreToolUse[0].hooks[0].command, preToolHookCommand());
        assert.equal(config.hooks.UserPromptSubmit[0].hooks[0].command, userPromptHookCommand());
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('idempotent for codex', () => {
      const tmpDir = makeTmpDir();
      const settingsPath = path.join(tmpDir, '.codex', 'config.json');

      try {
        wireCodexHooks({ settingsPath });
        const result2 = wireCodexHooks({ settingsPath });
        assert.equal(result2.changed, false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // --- wireGeminiHooks ---

  describe('wireGeminiHooks', () => {
    test('creates settings and wires PreToolUse hook', () => {
      const tmpDir = makeTmpDir();
      const settingsPath = path.join(tmpDir, '.gemini', 'settings.json');

      try {
        const result = wireGeminiHooks({ settingsPath });
        assert.equal(result.changed, true);
        assert.equal(result.added.length, 2);
        assert.equal(result.added[0].lifecycle, 'PreToolUse');

        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        assert.ok(settings.hooks.PreToolUse);
        assert.ok(settings.hooks.UserPromptSubmit);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('idempotent for gemini', () => {
      const tmpDir = makeTmpDir();
      const settingsPath = path.join(tmpDir, '.gemini', 'settings.json');

      try {
        wireGeminiHooks({ settingsPath });
        const result2 = wireGeminiHooks({ settingsPath });
        assert.equal(result2.changed, false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // --- wireHooks dispatcher ---

  describe('wireHooks', () => {
    test('returns error for unknown agent', () => {
      const tmpDir = makeTmpDir();
      const origHome = process.env.HOME;
      process.env.HOME = tmpDir;
      try {
        const result = wireHooks({ agent: 'vscode-copilot' });
        assert.ok(result.error);
      } finally {
        process.env.HOME = origHome;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns error when no agent detected', () => {
      const tmpDir = makeTmpDir();
      const origHome = process.env.HOME;
      process.env.HOME = tmpDir;
      try {
        const result = wireHooks({});
        assert.ok(result.error);
        assert.equal(result.changed, false);
      } finally {
        process.env.HOME = origHome;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('dispatches to claude-code and returns agent name', () => {
      const tmpDir = makeTmpDir();
      const origHome = process.env.HOME;
      process.env.HOME = tmpDir;
      try {
        const result = wireHooks({ agent: 'claude-code' });
        assert.equal(result.agent, 'claude-code');
        assert.equal(result.changed, true);
      } finally {
        process.env.HOME = origHome;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('dispatches to codex and returns agent name', () => {
      const tmpDir = makeTmpDir();
      const origHome = process.env.HOME;
      process.env.HOME = tmpDir;
      try {
        const result = wireHooks({ agent: 'codex' });
        assert.equal(result.agent, 'codex');
        assert.equal(result.changed, true);
      } finally {
        process.env.HOME = origHome;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // --- loadJsonFile ---

  describe('loadJsonFile', () => {
    test('returns null for non-existent file', () => {
      assert.equal(loadJsonFile('/tmp/does-not-exist-thumbgate-test.json'), null);
    });

    test('returns parsed JSON for valid file', () => {
      const tmpDir = makeTmpDir();
      const filePath = path.join(tmpDir, 'test.json');
      fs.writeFileSync(filePath, '{"key": "value"}');
      try {
        const result = loadJsonFile(filePath);
        assert.deepStrictEqual(result, { key: 'value' });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns empty object for malformed JSON', () => {
      const tmpDir = makeTmpDir();
      const filePath = path.join(tmpDir, 'bad.json');
      fs.writeFileSync(filePath, 'not json');
      try {
        const result = loadJsonFile(filePath);
        assert.deepStrictEqual(result, {});
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
