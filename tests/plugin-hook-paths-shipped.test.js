'use strict';

// AGENT-3667 item K: every path the Claude plugin hooks file (and plugin manifest) names, plus the local modules those
// scripts load, must be in the `npm pack` output. v1.41.0 shipped hooks/hooks.json pointing at
// scripts/hook-pre-tool-use.js, which was not in the package.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function packedFiles() {
  const out = cp.execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return new Set(JSON.parse(out)[0].files.map((f) => f.path));
}

function pluginPaths() {
  const hooks = fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8');
  const named = [...hooks.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/g)].map((m) => m[1]);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  for (const key of ['hooks', 'skills', 'commands']) {
    if (typeof manifest[key] === 'string') named.push(manifest[key].replace(/^\.\//, ''));
  }
  return [...new Set(named)];
}

// Local modules a script loads: require('./x') and require(path.join(pkgRoot, 'scripts', 'x')).
function localRequires(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const dir = path.dirname(file);
  const found = [];
  for (const m of src.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) found.push(path.posix.join(dir, m[1]));
  for (const m of src.matchAll(/require\(\s*path\.join\(\s*\w+\s*,\s*'scripts'\s*,\s*'([^']+)'\s*\)\s*\)/g)) found.push(`scripts/${m[1]}`);
  return found;
}

function resolveModule(rel) {
  for (const candidate of [rel, `${rel}.js`, `${rel}.json`, `${rel}/index.js`]) {
    const full = path.join(ROOT, candidate);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return candidate;
  }
  return null;
}

test('every path the plugin hooks file and manifest name ships in npm pack', () => {
  const packed = packedFiles();
  const missing = [];
  for (const p of pluginPaths()) {
    const isDir = p.endsWith('/');
    const shipped = isDir ? [...packed].some((f) => f.startsWith(p)) : packed.has(p);
    if (!shipped) missing.push(p);
  }
  assert.deepEqual(missing, [], `named by the plugin files but absent from npm pack: ${missing.join(', ')}`);
});

test('the scripts the plugin hooks run ship together with every local module they load', () => {
  const packed = packedFiles();
  const entries = pluginPaths().filter((p) => /\.(?:js|cjs)$/.test(p));
  assert.ok(entries.includes('scripts/hook-pre-tool-use.js'), 'the plugin PreToolUse hook script is among the checked entries');
  const seen = new Set();
  const missing = [];
  const queue = [...entries];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!packed.has(file)) missing.push(file);
    for (const rel of localRequires(file)) {
      const resolved = resolveModule(rel);
      if (!resolved) continue; // guarded optional require of a module that is not in the repo
      queue.push(resolved);
    }
  }
  assert.deepEqual(missing, [], `plugin hook code that npm pack leaves out: ${missing.join(', ')}`);
});
