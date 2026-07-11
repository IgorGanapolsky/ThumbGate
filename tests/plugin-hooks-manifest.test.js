const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf-8'));
}

// A fresh plugin / desktop-extension install of "thumbgate" wires skills,
// commands, and mcpServers from .claude-plugin/plugin.json. Without a hooks
// lifecycle declared here, ZERO PreToolUse enforcement / recall ships — the
// word "hooks" in keywords[] is a search string, not config. These tests guard
// against a dropped-hooks regression shipping green.

test('plugin manifest declares a hooks lifecycle surface', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  assert.ok(
    Object.prototype.hasOwnProperty.call(plugin, 'hooks'),
    'plugin.json must declare a "hooks" surface so a fresh install enforces',
  );
});

test('plugin hooks resolve to a real, valid hooks manifest', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  const hooks = plugin.hooks;

  let hooksConfig;
  if (typeof hooks === 'string') {
    // Path form (like skills/commands): resolve relative to .claude-plugin/.
    const hooksPath = path.join(root, '.claude-plugin', hooks);
    assert.ok(fs.existsSync(hooksPath), `hooks path must exist: ${hooksPath}`);
    hooksConfig = JSON.parse(fs.readFileSync(hooksPath, 'utf-8'));
  } else {
    // Inline object form.
    hooksConfig = hooks;
  }

  assert.ok(hooksConfig && typeof hooksConfig === 'object', 'hooks config must be an object');
  const lifecycles = hooksConfig.hooks || hooksConfig;
  assert.ok(lifecycles && typeof lifecycles === 'object', 'hooks config must expose lifecycle events');

  return lifecycles;
});

function loadLifecycles() {
  const plugin = readJson('.claude-plugin/plugin.json');
  const hooks = plugin.hooks;
  let hooksConfig;
  if (typeof hooks === 'string') {
    hooksConfig = JSON.parse(
      fs.readFileSync(path.join(root, '.claude-plugin', hooks), 'utf-8'),
    );
  } else {
    hooksConfig = hooks;
  }
  return hooksConfig.hooks || hooksConfig;
}

function collectCommands(lifecycle) {
  const commands = [];
  for (const group of lifecycle || []) {
    for (const hook of group.hooks || []) {
      if (hook.command) commands.push(hook.command);
    }
  }
  return commands;
}

test('PreToolUse enforcement is wired via ${CLAUDE_PLUGIN_ROOT}', () => {
  const lifecycles = loadLifecycles();
  assert.ok(Array.isArray(lifecycles.PreToolUse), 'PreToolUse lifecycle must be present');

  const matchers = lifecycles.PreToolUse.map((g) => g.matcher).filter(Boolean);
  assert.ok(
    matchers.some((m) => m.includes('Bash') && m.includes('Edit') && m.includes('Write')),
    'PreToolUse must match Bash|Edit|Write',
  );

  const commands = collectCommands(lifecycles.PreToolUse);
  assert.ok(
    commands.some((c) => c.includes('${CLAUDE_PLUGIN_ROOT}') && c.includes('hook-pre-tool-use.js')),
    'PreToolUse must run hook-pre-tool-use.js via ${CLAUDE_PLUGIN_ROOT}',
  );
});

test('UserPromptSubmit recall is wired via ${CLAUDE_PLUGIN_ROOT}', () => {
  const lifecycles = loadLifecycles();
  assert.ok(Array.isArray(lifecycles.UserPromptSubmit), 'UserPromptSubmit lifecycle must be present');

  const commands = collectCommands(lifecycles.UserPromptSubmit);
  assert.ok(
    commands.some((c) => c.includes('${CLAUDE_PLUGIN_ROOT}') && c.includes('hook-auto-capture')),
    'UserPromptSubmit must run hook-auto-capture via ${CLAUDE_PLUGIN_ROOT}',
  );
});

test('SessionStart primer is wired via ${CLAUDE_PLUGIN_ROOT}', () => {
  const lifecycles = loadLifecycles();
  assert.ok(Array.isArray(lifecycles.SessionStart), 'SessionStart lifecycle must be present');

  const commands = collectCommands(lifecycles.SessionStart);
  assert.ok(
    commands.some((c) => c.includes('${CLAUDE_PLUGIN_ROOT}') && c.includes('session-start')),
    'SessionStart must run session-start via ${CLAUDE_PLUGIN_ROOT}',
  );
});

test('every plugin hook command path is anchored to ${CLAUDE_PLUGIN_ROOT}', () => {
  const lifecycles = loadLifecycles();
  const required = ['PreToolUse', 'UserPromptSubmit', 'SessionStart'];
  for (const event of required) {
    for (const command of collectCommands(lifecycles[event])) {
      assert.ok(
        command.includes('${CLAUDE_PLUGIN_ROOT}'),
        `${event} command must anchor paths to \${CLAUDE_PLUGIN_ROOT}: ${command}`,
      );
    }
  }
});
