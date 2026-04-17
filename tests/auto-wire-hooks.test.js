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
  wireForgeHooks,
  hookAlreadyPresent,
  loadJsonFile,
  parseFlags,
  CLAUDE_HOOKS,
  preToolHookCommand,
  userPromptHookCommand,
  sessionStartHookCommand,
  pruneStaleFileHooks,
  pruneStaleHooksInFile,
  claudeProjectSettingsPath,
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

    test('returns forge when flag is "forge"', () => {
      assert.equal(detectAgent('forge'), 'forge');
    });

    test('returns forge when flag is "forgecode"', () => {
      assert.equal(detectAgent('forgecode'), 'forge');
    });

    test('returns forge when flag is "forge-code"', () => {
      assert.equal(detectAgent('forge-code'), 'forge');
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
      const sharedSettingsPath = path.join(tmpDir, '.claude', 'settings.json');

      try {
        const result = wireClaudeHooks({ settingsPath, sharedSettingsPath });
        assert.equal(result.changed, true);
        assert.equal(result.added.length, 5);

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
        const sharedSettings = JSON.parse(fs.readFileSync(sharedSettingsPath, 'utf8'));
        assert.equal(sharedSettings.statusLine.command, require('../scripts/hook-runtime').statuslineCommand());
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('preserves existing hooks', () => {
      const tmpDir = makeTmpDir();
      const settingsDir = path.join(tmpDir, '.claude');
      const settingsPath = path.join(settingsDir, 'settings.local.json');
      const sharedSettingsPath = path.join(settingsDir, 'settings.json');

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
        const result = wireClaudeHooks({ settingsPath, sharedSettingsPath });
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
      const sharedSettingsPath = path.join(tmpDir, '.claude', 'settings.json');

      try {
        const result1 = wireClaudeHooks({ settingsPath, sharedSettingsPath });
        assert.equal(result1.changed, true);
        assert.equal(result1.added.length, 5);

        const result2 = wireClaudeHooks({ settingsPath, sharedSettingsPath });
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
      const sharedSettingsPath = path.join(tmpDir, '.claude', 'settings.json');

      try {
        const result = wireClaudeHooks({ settingsPath, sharedSettingsPath, dryRun: true });
        assert.equal(result.changed, true);
        assert.equal(result.added.length, 5);
        assert.equal(fs.existsSync(settingsPath), false);
        assert.equal(fs.existsSync(sharedSettingsPath), false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('handles malformed JSON gracefully', () => {
      const tmpDir = makeTmpDir();
      const settingsDir = path.join(tmpDir, '.claude');
      const settingsPath = path.join(settingsDir, 'settings.local.json');
      const sharedSettingsPath = path.join(settingsDir, 'settings.json');

      fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(settingsPath, '{ invalid json !!!');

      try {
        const result = wireClaudeHooks({ settingsPath, sharedSettingsPath });
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
    test('creates config and wires the full Codex hook bundle plus status line', () => {
      const tmpDir = makeTmpDir();
      const settingsPath = path.join(tmpDir, '.codex', 'config.json');

      try {
        const result = wireCodexHooks({ settingsPath });
        assert.equal(result.changed, true);
        assert.equal(result.added.length, 5);
        assert.equal(result.added[0].lifecycle, 'PreToolUse');

        const config = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        assert.ok(config.hooks.PreToolUse);
        assert.ok(config.hooks.UserPromptSubmit);
        assert.ok(config.hooks.PostToolUse);
        assert.ok(config.hooks.SessionStart);
        assert.ok(config.statusLine);
        assert.equal(config.hooks.PreToolUse[0].hooks[0].command, require('../scripts/hook-runtime').codexPreToolHookCommand());
        assert.equal(config.hooks.UserPromptSubmit[0].hooks[0].command, require('../scripts/hook-runtime').codexUserPromptHookCommand());
        assert.equal(config.hooks.PostToolUse[0].hooks[0].command, require('../scripts/hook-runtime').codexCacheUpdateHookCommand());
        assert.equal(config.hooks.SessionStart[0].hooks[0].command, require('../scripts/hook-runtime').codexSessionStartHookCommand());
        assert.equal(config.statusLine.command, require('../scripts/hook-runtime').codexStatuslineCommand());
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

    test('replaces legacy codex hooks and reports the replacement', () => {
      const tmpDir = makeTmpDir();
      const settingsDir = path.join(tmpDir, '.codex');
      const settingsPath = path.join(settingsDir, 'config.json');

      fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: '/tmp/generate-pretool-hook.sh' }] }],
        },
      }, null, 2) + '\n');

      try {
        const result = wireCodexHooks({ settingsPath });
        assert.equal(result.changed, true);
        assert.ok(result.added.some((entry) => entry.command.includes('replaced legacy ThumbGate hook')));

        const config = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        assert.equal(config.hooks.PreToolUse.length, 1);
        assert.equal(config.hooks.PreToolUse[0].hooks[0].command, require('../scripts/hook-runtime').codexPreToolHookCommand());
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('updates only the codex status line when hooks are already present', () => {
      const tmpDir = makeTmpDir();
      const settingsDir = path.join(tmpDir, '.codex');
      const settingsPath = path.join(settingsDir, 'config.json');

      fs.mkdirSync(settingsDir, { recursive: true });

      try {
        wireCodexHooks({ settingsPath });
        const seededConfig = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        seededConfig.statusLine = { type: 'command', command: 'thumbgate statusline --old' };
        fs.writeFileSync(settingsPath, JSON.stringify(seededConfig, null, 2) + '\n');

        const result = wireCodexHooks({ settingsPath });
        assert.equal(result.changed, true);
        assert.deepStrictEqual(result.added, [{
          lifecycle: 'statusLine',
          command: require('../scripts/hook-runtime').codexStatuslineCommand(),
        }]);

        const config = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        assert.equal(config.statusLine.command, require('../scripts/hook-runtime').codexStatuslineCommand());
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('dry-run for codex reports changes without writing config', () => {
      const tmpDir = makeTmpDir();
      const settingsPath = path.join(tmpDir, '.codex', 'config.json');

      try {
        const result = wireCodexHooks({ settingsPath, dryRun: true });
        assert.equal(result.changed, true);
        assert.equal(result.added.length, 5);
        assert.equal(fs.existsSync(settingsPath), false);
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

  // --- wireForgeHooks ---

  describe('wireForgeHooks', () => {
    test('creates hooks file and wires PreToolUse and UserPromptSubmit', () => {
      const tmpDir = makeTmpDir();
      const settingsPath = path.join(tmpDir, '.thumbgate', 'forge-hooks.json');

      try {
        const result = wireForgeHooks({ settingsPath });
        assert.equal(result.changed, true);
        assert.equal(result.added.length, 2);
        assert.equal(result.added[0].lifecycle, 'PreToolUse');
        assert.equal(result.added[1].lifecycle, 'UserPromptSubmit');

        const config = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        assert.ok(config.hooks.PreToolUse);
        assert.ok(config.hooks.UserPromptSubmit);
        assert.equal(config.hooks.PreToolUse[0].hooks[0].command, preToolHookCommand());
        assert.equal(config.hooks.UserPromptSubmit[0].hooks[0].command, userPromptHookCommand());
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('idempotent for forge', () => {
      const tmpDir = makeTmpDir();
      const settingsPath = path.join(tmpDir, '.thumbgate', 'forge-hooks.json');

      try {
        wireForgeHooks({ settingsPath });
        const result2 = wireForgeHooks({ settingsPath });
        assert.equal(result2.changed, false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('dry-run does not write file', () => {
      const tmpDir = makeTmpDir();
      const settingsPath = path.join(tmpDir, '.thumbgate', 'forge-hooks.json');

      try {
        const result = wireForgeHooks({ settingsPath, dryRun: true });
        assert.equal(result.changed, true);
        assert.equal(result.added.length, 2);
        assert.equal(fs.existsSync(settingsPath), false);
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

    test('dispatches to forge and returns agent name', () => {
      const tmpDir = makeTmpDir();
      const origHome = process.env.HOME;
      const origCwd = process.cwd();
      process.env.HOME = tmpDir;
      process.chdir(tmpDir);
      try {
        const result = wireHooks({ agent: 'forge' });
        assert.equal(result.agent, 'forge');
        assert.equal(result.changed, true);
      } finally {
        process.env.HOME = origHome;
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // --- pruneStaleFileHooks ---

  describe('pruneStaleFileHooks', () => {
    test('returns empty result for non-array input', () => {
      const result = pruneStaleFileHooks(null);
      assert.deepStrictEqual(result.hooks, []);
      assert.deepStrictEqual(result.removedPaths, []);
    });

    test('keeps hooks whose command does not reference a file path', () => {
      const hookArray = [
        { hooks: [{ type: 'command', command: 'npx thumbgate gate-check' }] },
        { hooks: [{ type: 'command', command: 'node /dev/null' }] },
      ];
      // /dev/null always exists, so only the npx entry (no path) should survive
      const result = pruneStaleFileHooks(hookArray, '/tmp');
      assert.equal(result.removedPaths.length, 0);
      assert.equal(result.hooks.length, 2);
    });

    test('removes hook entry whose script path does not exist', () => {
      const tmpDir = makeTmpDir();
      try {
        const missingScript = path.join(tmpDir, '.claude', 'hooks', 'user-prompt-submit.sh');
        const hookArray = [
          {
            hooks: [{ type: 'command', command: `${missingScript} --capture` }],
          },
          {
            hooks: [{ type: 'command', command: 'npx thumbgate capture' }],
          },
        ];
        const result = pruneStaleFileHooks(hookArray, tmpDir);
        assert.equal(result.removedPaths.length, 1);
        assert.equal(result.removedPaths[0], missingScript);
        // The npx entry is preserved; the missing-script entry is gone
        assert.equal(result.hooks.length, 1);
        assert.equal(result.hooks[0].hooks[0].command, 'npx thumbgate capture');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('keeps hook entry whose script path exists on disk', () => {
      const tmpDir = makeTmpDir();
      try {
        const existingScript = path.join(tmpDir, 'my-hook.sh');
        fs.writeFileSync(existingScript, '#!/bin/sh\necho ok\n');
        const hookArray = [
          { hooks: [{ type: 'command', command: existingScript }] },
        ];
        const result = pruneStaleFileHooks(hookArray, tmpDir);
        assert.equal(result.removedPaths.length, 0);
        assert.equal(result.hooks.length, 1);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('removes hook with relative path to missing script', () => {
      const tmpDir = makeTmpDir();
      try {
        const relPath = '.claude/hooks/user-prompt-submit.sh';
        const hookArray = [
          { hooks: [{ type: 'command', command: relPath }] },
        ];
        // The script does not exist under tmpDir
        const result = pruneStaleFileHooks(hookArray, tmpDir);
        assert.equal(result.removedPaths.length, 1);
        assert.equal(result.removedPaths[0], relPath);
        assert.equal(result.hooks.length, 0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // --- pruneStaleHooksInFile ---

  describe('pruneStaleHooksInFile', () => {
    test('returns unchanged when file does not exist', () => {
      const result = pruneStaleHooksInFile('/tmp/nonexistent-thumbgate-test.json', '/tmp', false);
      assert.equal(result.changed, false);
      assert.deepStrictEqual(result.removedPaths, []);
    });

    test('removes stale hooks and rewrites the file', () => {
      const tmpDir = makeTmpDir();
      try {
        const settingsPath = path.join(tmpDir, 'settings.json');
        const missingScript = path.join(tmpDir, '.claude', 'hooks', 'user-prompt-submit.sh');

        const settings = {
          hooks: {
            UserPromptSubmit: [
              { hooks: [{ type: 'command', command: missingScript }] },
              { hooks: [{ type: 'command', command: 'npx thumbgate capture' }] },
            ],
          },
        };
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

        const result = pruneStaleHooksInFile(settingsPath, tmpDir, false);
        assert.equal(result.changed, true);
        assert.equal(result.removedPaths.length, 1);
        assert.equal(result.removedPaths[0], missingScript);

        // Verify the file was rewritten without the stale entry
        const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        assert.equal(written.hooks.UserPromptSubmit.length, 1);
        assert.equal(
          written.hooks.UserPromptSubmit[0].hooks[0].command,
          'npx thumbgate capture'
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('dry-run does not rewrite the file', () => {
      const tmpDir = makeTmpDir();
      try {
        const settingsPath = path.join(tmpDir, 'settings.json');
        const missingScript = path.join(tmpDir, '.claude', 'hooks', 'user-prompt-submit.sh');

        const settings = {
          hooks: {
            UserPromptSubmit: [
              { hooks: [{ type: 'command', command: missingScript }] },
            ],
          },
        };
        const original = JSON.stringify(settings, null, 2);
        fs.writeFileSync(settingsPath, original);

        const result = pruneStaleHooksInFile(settingsPath, tmpDir, true);
        assert.equal(result.changed, true);
        assert.equal(result.removedPaths.length, 1);
        // File must not have been modified
        assert.equal(fs.readFileSync(settingsPath, 'utf8'), original);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // --- wireClaudeHooks + project-level stale cleanup ---

  describe('wireClaudeHooks — project-level stale hook cleanup', () => {
    test('removes stale hooks from project-level .claude/settings.json during wiring', () => {
      const tmpDir = makeTmpDir();
      const userSettingsDir = path.join(tmpDir, 'home', '.claude');
      const userSettingsPath = path.join(userSettingsDir, 'settings.local.json');
      const userSharedPath = path.join(userSettingsDir, 'settings.json');

      // Project directory contains a stale .claude/settings.json
      const projectDir = path.join(tmpDir, 'project');
      const projectClaudeDir = path.join(projectDir, '.claude');
      const projectSettingsPath = path.join(projectClaudeDir, 'settings.json');

      fs.mkdirSync(userSettingsDir, { recursive: true });
      fs.mkdirSync(projectClaudeDir, { recursive: true });

      // Simulate a stale hook: the shell script is referenced but does NOT exist
      const staleScript = path.join(projectClaudeDir, 'hooks', 'user-prompt-submit.sh');
      const projectSettings = {
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: 'command', command: staleScript }] },
            { hooks: [{ type: 'command', command: 'npx thumbgate capture' }] },
          ],
        },
      };
      fs.writeFileSync(projectSettingsPath, JSON.stringify(projectSettings, null, 2));

      try {
        const result = wireClaudeHooks({
          settingsPath: userSettingsPath,
          sharedSettingsPath: userSharedPath,
          projectSettingsPath,
          projectDir,
        });

        // The wiring itself should succeed
        assert.equal(result.changed, true);

        // Project-level file must have had the stale entry removed
        const written = JSON.parse(fs.readFileSync(projectSettingsPath, 'utf8'));
        const submitHooks = written.hooks.UserPromptSubmit;
        assert.ok(Array.isArray(submitHooks), 'UserPromptSubmit should still be an array');
        // Only the non-stale entry should remain
        assert.equal(submitHooks.length, 1);
        assert.equal(submitHooks[0].hooks[0].command, 'npx thumbgate capture');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('removes stale hooks from user-level settings.local.json during wiring', () => {
      const tmpDir = makeTmpDir();
      const userSettingsDir = path.join(tmpDir, 'home', '.claude');
      const userSettingsPath = path.join(userSettingsDir, 'settings.local.json');
      const userSharedPath = path.join(userSettingsDir, 'settings.json');
      const projectDir = path.join(tmpDir, 'project');

      fs.mkdirSync(userSettingsDir, { recursive: true });
      fs.mkdirSync(projectDir, { recursive: true });

      // Stale entry in the user-level settings (script doesn't exist)
      const staleScript = path.join(projectDir, '.claude', 'hooks', 'user-prompt-submit.sh');
      const userSettings = {
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: 'command', command: staleScript }] },
          ],
        },
      };
      fs.writeFileSync(userSettingsPath, JSON.stringify(userSettings, null, 2));

      try {
        wireClaudeHooks({
          settingsPath: userSettingsPath,
          sharedSettingsPath: userSharedPath,
          projectDir,
        });

        // The stale entry should have been removed before the new hook was added
        const written = JSON.parse(fs.readFileSync(userSettingsPath, 'utf8'));
        const submitHooks = written.hooks.UserPromptSubmit;
        assert.ok(Array.isArray(submitHooks));
        const staleStillPresent = submitHooks.some((e) =>
          e.hooks && e.hooks.some((h) => h.command === staleScript)
        );
        assert.equal(staleStillPresent, false, 'Stale hook should have been removed');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('does not touch project-level file when it has no stale hooks', () => {
      const tmpDir = makeTmpDir();
      const userSettingsDir = path.join(tmpDir, 'home', '.claude');
      const userSettingsPath = path.join(userSettingsDir, 'settings.local.json');
      const userSharedPath = path.join(userSettingsDir, 'settings.json');

      const projectDir = path.join(tmpDir, 'project');
      const projectClaudeDir = path.join(projectDir, '.claude');
      const projectSettingsPath = path.join(projectClaudeDir, 'settings.json');

      fs.mkdirSync(userSettingsDir, { recursive: true });
      fs.mkdirSync(projectClaudeDir, { recursive: true });

      // All hooks are valid (npx commands, no missing files)
      const projectSettings = {
        hooks: {
          PreToolUse: [
            { hooks: [{ type: 'command', command: 'npx thumbgate gate-check' }] },
          ],
        },
        someOtherKey: 'preserved',
      };
      const originalJson = JSON.stringify(projectSettings, null, 2);
      fs.writeFileSync(projectSettingsPath, originalJson);

      try {
        wireClaudeHooks({
          settingsPath: userSettingsPath,
          sharedSettingsPath: userSharedPath,
          projectSettingsPath,
          projectDir,
        });

        // Project settings should be unchanged (no stale entries to remove)
        const written = fs.readFileSync(projectSettingsPath, 'utf8');
        assert.equal(written, originalJson);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('claudeProjectSettingsPath returns CWD-relative path by default', () => {
      const result = claudeProjectSettingsPath('/some/project/dir');
      assert.equal(result, path.join('/some/project/dir', '.claude', 'settings.json'));
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
