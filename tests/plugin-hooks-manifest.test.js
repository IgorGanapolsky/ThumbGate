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

  const matchers = lifecycles.PreToolUse.map((g) => g.matcher).filter(Boolean);
  assert.ok(
    matchers.some((m) => m === '.*'),
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

// Regression guard for thumbgate@1.39.0: the shipped hooks/hooks.json wired
// PreToolUse to ${CLAUDE_PLUGIN_ROOT}/scripts/hook-pre-tool-use.js, but that
// file (and its local dependency scripts/budget-guard.js) was absent from
// package.json:files, so the published tarball dropped it. Every plugin
// install then errored on every PreToolUse event and enforcement failed open.
// Declaring the wiring (tests above) is not enough; the referenced files must
// actually ship.
test('every hook command path referenced by the shipped hooks manifest is in the npm pack', () => {
  const { execSync } = require('node:child_process');
  const lifecycles = loadLifecycles();
  const referenced = new Set();
  for (const event of Object.keys(lifecycles)) {
    for (const hook of collectHooks(lifecycles[event])) {
      for (const arg of hook.args || []) {
        if (typeof arg === 'string' && arg.startsWith('${CLAUDE_PLUGIN_ROOT}/')) {
          referenced.add(arg.replace('${CLAUDE_PLUGIN_ROOT}/', '').replace(/^\.\//, ''));
        }
      }
    }
  }
  assert.ok(referenced.size > 0, 'hooks manifest must reference at least one plugin file');

  const raw = execSync('npm pack --dry-run --json', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const packed = new Set((JSON.parse(raw)[0].files || []).map((f) => f.path.replace(/^package\//, '')));

  const missing = [...referenced].filter((rel) => !packed.has(rel));
  assert.deepEqual(missing, [], `hook files referenced by hooks manifest must ship in the npm pack: ${missing.join(', ')}`);

  // Local requires reachable from those hook entrypoints must also ship, or
  // the hook crashes with MODULE_NOT_FOUND at tool-call time. Covers both
  // require('./x') and require(path.join(pkgRoot, 'scripts', 'x')) forms.
  const seen = new Set();
  const unresolved = new Set();
  const stack = [...referenced].map((rel) => path.join(root, rel));
  const relRe = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  const pkgRootRe = /require\(path\.join\(pkgRoot,\s*['"]scripts['"],\s*['"]([^'"]+)['"]\)\s*\)/g;
  while (stack.length) {
    const file = stack.pop();
    const rel = path.relative(root, file);
    if (seen.has(rel)) continue;
    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    seen.add(rel);
    const push = (target) => {
      for (const c of [target, `${target}.js`, path.join(target, 'index.js')]) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) { stack.push(c); return; }
      }
      unresolved.add(path.relative(root, target));
    };
    let m;
    while ((m = relRe.exec(src)) !== null) push(path.resolve(path.dirname(file), m[1]));
    while ((m = pkgRootRe.exec(src)) !== null) push(path.join(root, 'scripts', m[1]));
  }
  assert.deepEqual([...unresolved], [], `hook local dependencies must exist on disk: ${[...unresolved].join(', ')}`);
  const missingDeps = [...seen].filter((rel) => /\.(?:js|cjs|mjs|json)$/i.test(rel) && !packed.has(rel));
  assert.deepEqual(missingDeps, [], `hook dependency closure must ship in the npm pack: ${missingDeps.join(', ')}`);
});
