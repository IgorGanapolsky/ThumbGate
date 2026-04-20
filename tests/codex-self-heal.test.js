'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  codexConfigPath,
  repairCodexHooks,
  shouldAttemptCodexSelfHeal,
} = require('../scripts/codex-self-heal');
const {
  codexCacheUpdateHookCommand,
  codexPreToolHookCommand,
  codexSessionStartHookCommand,
  codexStatuslineCommand,
  codexUserPromptHookCommand,
} = require('../scripts/hook-runtime');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-codex-self-heal-'));
}

describe('codex self-heal', () => {
  test('repairs a stale Codex config with only legacy pre-tool and prompt hooks', () => {
    const homeDir = makeTmpDir();
    const configPath = codexConfigPath(homeDir);

    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({
        hooks: {
          PreToolUse: [{
            matcher: 'Bash',
            hooks: [{
              type: 'command',
              command: `mkdir -p ${JSON.stringify(path.join(homeDir, '.thumbgate', 'runtime'))} && exec ${JSON.stringify(path.join(homeDir, '.thumbgate', 'runtime', 'node_modules', '.bin', 'thumbgate'))} gate-check`,
            }],
          }],
          UserPromptSubmit: [{
            hooks: [{
              type: 'command',
              command: `mkdir -p ${JSON.stringify(path.join(homeDir, '.thumbgate', 'runtime'))} && exec ${JSON.stringify(path.join(homeDir, '.thumbgate', 'runtime', 'node_modules', '.bin', 'thumbgate'))} hook-auto-capture`,
            }],
          }],
        },
      }, null, 2) + '\n');

      const result = repairCodexHooks({ homeDir });
      assert.equal(result.changed, true);

      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.equal(config.hooks.PreToolUse[0].hooks[0].command, codexPreToolHookCommand());
      assert.equal(config.hooks.UserPromptSubmit[0].hooks[0].command, codexUserPromptHookCommand());
      assert.equal(config.hooks.PostToolUse[0].hooks[0].command, codexCacheUpdateHookCommand());
      assert.equal(config.hooks.SessionStart[0].hooks[0].command, codexSessionStartHookCommand());
      assert.equal(config.statusLine.command, codexStatuslineCommand());
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test('skips self-heal when the feature is disabled by env', () => {
    const homeDir = makeTmpDir();
    try {
      fs.mkdirSync(path.join(homeDir, '.codex'), { recursive: true });
      assert.equal(shouldAttemptCodexSelfHeal({
        homeDir,
        env: { THUMBGATE_DISABLE_CODEX_SELF_HEAL: '1' },
      }), false);

      const result = repairCodexHooks({
        homeDir,
        env: { THUMBGATE_DISABLE_CODEX_SELF_HEAL: '1' },
      });
      assert.deepStrictEqual(result, {
        changed: false,
        skipped: true,
        reason: 'codex-not-detected',
      });
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
