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
    // Component paths in plugin.json resolve from the plugin root. Only the
    // manifest itself belongs under .claude-plugin/.
    const hooksPath = path.join(root, hooks);
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
      fs.readFileSync(path.join(root, hooks), 'utf-8'),
    );
  } else {
    hooksConfig = hooks;
  }
  return hooksConfig.hooks || hooksConfig;
}

function collectHooks(lifecycle) {
  const hooks = [];
  for (const group of lifecycle || []) {
    for (const hook of group.hooks || []) {
      hooks.push(hook);
    }
  }
  return hooks;
}

test('PreToolUse enforcement is wired via ${CLAUDE_PLUGIN_ROOT}', () => {
  const lifecycles = loadLifecycles();
  assert.ok(Array.isArray(lifecycles.PreToolUse), 'PreToolUse lifecycle must be present');

  const allToolGroups = lifecycles.PreToolUse.filter((group) => group.matcher === '.*');
  assert.ok(
    allToolGroups.length > 0,
    'PreToolUse must match every tool surface',
  );

  const hooks = collectHooks(lifecycles.PreToolUse);
  assert.ok(
    hooks.some((hook) => hook.command === 'node'
      && hook.args?.some((arg) => arg.includes('${CLAUDE_PLUGIN_ROOT}') && arg.includes('hook-pre-tool-use.js'))),
    'PreToolUse must run hook-pre-tool-use.js via ${CLAUDE_PLUGIN_ROOT}',
  );
});

test('UserPromptSubmit recall is wired via ${CLAUDE_PLUGIN_ROOT}', () => {
  const lifecycles = loadLifecycles();
  assert.ok(Array.isArray(lifecycles.UserPromptSubmit), 'UserPromptSubmit lifecycle must be present');

  const hooks = collectHooks(lifecycles.UserPromptSubmit);
  assert.ok(
    hooks.some((hook) => hook.command === 'node'
      && hook.args?.some((arg) => arg.includes('${CLAUDE_PLUGIN_ROOT}') && arg.includes('bin/cli.js'))
      && hook.args?.includes('hook-auto-capture')),
    'UserPromptSubmit must run hook-auto-capture via ${CLAUDE_PLUGIN_ROOT}',
  );
});

test('SessionStart primer is wired via ${CLAUDE_PLUGIN_ROOT}', () => {
  const lifecycles = loadLifecycles();
  assert.ok(Array.isArray(lifecycles.SessionStart), 'SessionStart lifecycle must be present');

  const hooks = collectHooks(lifecycles.SessionStart);
  assert.ok(
    hooks.some((hook) => hook.command === 'node'
      && hook.args?.some((arg) => arg.includes('${CLAUDE_PLUGIN_ROOT}') && arg.includes('bin/cli.js'))
      && hook.args?.includes('session-start')),
    'SessionStart must run session-start via ${CLAUDE_PLUGIN_ROOT}',
  );
});

test('every plugin hook command path is anchored to ${CLAUDE_PLUGIN_ROOT}', () => {
  const lifecycles = loadLifecycles();
  const required = ['PreToolUse', 'UserPromptSubmit', 'SessionStart'];
  for (const event of required) {
    for (const hook of collectHooks(lifecycles[event])) {
      assert.equal(hook.command, 'node', `${event} must use exec-form command syntax`);
      const pathArgs = (hook.args || []).filter((arg) => /[\\/]/.test(arg));
      assert.ok(pathArgs.length > 0, `${event} must provide its script path as an argument`);
      for (const pathArg of pathArgs) {
        assert.ok(
          pathArg.startsWith('${CLAUDE_PLUGIN_ROOT}/'),
          `${event} path must be anchored to \${CLAUDE_PLUGIN_ROOT}: ${pathArg}`,
        );
      }
      assert.ok(
        !/\s/.test(hook.command),
        `${event} executable must not contain shell-tokenized arguments: ${hook.command}`,
      );
    }
  }
});

test('plugin copy does not promise one-thumbs-down automatic or impossible-to-bypass enforcement', () => {
  const plugin = fs.readFileSync(path.join(root, '.claude-plugin/plugin.json'), 'utf8');
  const marketplace = fs.readFileSync(path.join(root, '.claude-plugin/marketplace.json'), 'utf8');
  const readme = fs.readFileSync(path.join(root, '.claude-plugin/README.md'), 'utf8');
  const copy = `${plugin}\n${marketplace}\n${readme}`;
  assert.doesNotMatch(copy, /one thumbs-down, never again|physically cannot repeat|hard rule the agent cannot bypass/i);
  assert.match(copy, /independently authenticated human reviewer/i);
});
