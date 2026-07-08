'use strict';

/**
 * pack-runtime-integrity.test.js
 *
 * Why this exists: published thumbgate@1.27.19 shipped scripts/hybrid-feedback-context.js
 * but OMITTED its dependency scripts/feedback-sanitizer.js (and 31 other files listed in
 * package.json:files). Every user who wired the UserPromptSubmit hook then crashed on every
 * prompt with:
 *   Error: Cannot find module './feedback-sanitizer'  (node:internal/modules/cjs/loader:1433)
 *
 * The bundle-ratchet test only guards against the bundle GROWING; it never noticed a
 * SHRINKING bundle that dropped runtime-required files. This test closes that gap by proving:
 *   (1) every path in package.json:files that exists on disk is actually in the packed tarball;
 *   (2) every local `require('./x')` reachable from the hook entrypoints resolves inside the pack.
 *
 * It packs with `npm pack --dry-run --json` (no tarball written) so it is cheap and hermetic.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');

function packedFileSet() {
  const raw = execSync('npm pack --dry-run --json', { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const json = JSON.parse(raw);
  const files = (json[0] && json[0].files) || [];
  return new Set(files.map((f) => f.path.replace(/^package\//, '')));
}

// Entrypoints that npm-distributed users actually load. NOTE: scripts/hook-pre-tool-use.js
// is this repo's DOGFOOD hook and is intentionally NOT shipped — distributed users invoke
// the gate via `npx thumbgate gate-check` (bin/cli.js) and the MCP stdio server.
const HOOK_ENTRYPOINTS = [
  'bin/cli.js',
  'adapters/mcp/server-stdio.js',
];

// Resolve the transitive set of local (./ or ../) requires reachable from the entrypoints.
function reachableLocalRequires() {
  const seen = new Set();
  const stack = HOOK_ENTRYPOINTS.map((p) => path.join(REPO, p));
  const requireRe = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  while (stack.length) {
    const file = stack.pop();
    let rel = path.relative(REPO, file);
    if (seen.has(rel)) continue;
    let src;
    try {
      src = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // resolved below by the assertion if it was required
    }
    seen.add(rel);
    let m;
    while ((m = requireRe.exec(src)) !== null) {
      let target = path.resolve(path.dirname(file), m[1]);
      // resolve extension
      const candidates = [target, `${target}.js`, path.join(target, 'index.js')];
      const resolved = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
      if (resolved) stack.push(resolved);
    }
  }
  return [...seen];
}

// Runtime file extensions — the crash class. Markdown docs are excluded because
// npm de-dupes nested README.* files (a known quirk) and a missing doc never
// throws MODULE_NOT_FOUND; runtime resolution is covered by the require-graph test.
const RUNTIME_EXT = /\.(?:js|cjs|mjs|sh|json|toml|ya?ml|py)$/i;

test('every runtime file in package.json:files that exists on disk is in the packed tarball', () => {
  const packed = packedFileSet();
  const files = require(path.join(REPO, 'package.json')).files || [];
  const missing = [];
  for (const f of files) {
    if (f.endsWith('/')) continue; // directory globs are expanded by npm
    if (f.includes('*')) continue;
    if (!RUNTIME_EXT.test(f)) continue; // docs/assets: not the crash class
    const abs = path.join(REPO, f);
    if (!fs.existsSync(abs)) continue; // not on disk in this checkout — separate concern
    if (!packed.has(f)) missing.push(f);
  }
  assert.deepStrictEqual(
    missing,
    [],
    `runtime files listed in package.json but absent from the npm tarball:\n  ${missing.join('\n  ')}`
  );
});

test('every runtime-required local module resolves inside the packed tarball', () => {
  const packed = packedFileSet();
  const reachable = reachableLocalRequires();
  const missing = reachable.filter((rel) => !packed.has(rel));
  assert.deepStrictEqual(
    missing,
    [],
    `runtime require() targets reachable from hook entrypoints but NOT shipped in the tarball:\n  ${missing.join('\n  ')}\n`
      + `This is exactly the class of bug that broke thumbgate@1.27.19 (missing feedback-sanitizer.js).`
  );
});
