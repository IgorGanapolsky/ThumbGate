#!/usr/bin/env node
'use strict';

/**
 * Public ↔ Core boundary regression test.
 *
 * CLAUDE.md / AGENTS.md / GEMINI.md — Product Architecture Split directive:
 *   Public shell (IgorGanapolsky/ThumbGate, npm `thumbgate`) ships CLI,
 *   hooks, adapter configs, public schemas. Private core (ThumbGate-Core)
 *   ships ranking, policy synthesis, orchestration, billing intelligence.
 *   Public code must NEVER `require` Core internals directly. Public
 *   package.json must NEVER list Core as a runtime dependency.
 *
 * Violation triggers codified here block merge. When you fix a violation,
 * pin the fix with an additional assertion below.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');

// Patterns that would indicate an import/require of Core internals from
// a file shipped in the public npm package. Case-insensitive, matching
// common forms: `require('thumbgate-core')`, `require('@thumbgate/core')`,
// `require('../ThumbGate-Core/whatever')`, or ES `import … from '…core…'`.
const CORE_IMPORT_PATTERNS = [
  /require\s*\(\s*['"][^'"]*thumbgate[-_/.]core[^'"]*['"]\s*\)/i,
  /require\s*\(\s*['"][^'"]*ThumbGate-Core[^'"]*['"]\s*\)/,
  /from\s+['"][^'"]*thumbgate[-_/.]core[^'"]*['"]/i,
  /from\s+['"][^'"]*ThumbGate-Core[^'"]*['"]/,
  /import\s*\(\s*['"][^'"]*thumbgate[-_/.]core[^'"]*['"]\s*\)/i,
];

// A test fixture is allowed to reference Core by *name* in strings
// (e.g., this very file greps for "ThumbGate-Core"). Allowlist the test
// file itself so it doesn't self-flag.
const SELF_PATH = path.relative(root, __filename).split(path.sep).join('/');

function npmPackFiles() {
  const output = execFileSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const manifest = JSON.parse(output)[0];
  return manifest.files.map((f) => f.path);
}

test('public-core-boundary: no packaged file imports ThumbGate-Core', () => {
  const packaged = npmPackFiles().filter((f) => /\.(m?js|cjs|ts)$/.test(f));
  const violations = [];

  for (const relPath of packaged) {
    if (relPath === SELF_PATH) continue;
    const abs = path.join(root, relPath);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8');

    for (const pattern of CORE_IMPORT_PATTERNS) {
      const match = src.match(pattern);
      if (match) {
        violations.push(`${relPath}: ${match[0].slice(0, 80)}`);
        break; // one violation per file is enough to fail
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Public shell must not import ThumbGate-Core. Found ${violations.length} violation(s):\n  ` +
      violations.join('\n  ') +
      '\n\nPer CLAUDE.md: "Public code talks to Core over HTTP / gRPC / licensed binary — ' +
      'never a direct `require`."'
  );
});

test('public-core-boundary: package.json does not depend on Core', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.peerDependencies || {}),
    ...(pkg.optionalDependencies || {}),
  };

  const corePattern = /thumbgate[-_.]core|@thumbgate\/core/i;
  const offenders = Object.keys(allDeps).filter((name) => corePattern.test(name));

  assert.deepEqual(
    offenders,
    [],
    `public package.json must not list ThumbGate-Core in dependencies / peerDependencies / ` +
      `optionalDependencies. Found: ${offenders.join(', ')}.\n\n` +
      `Per CLAUDE.md violation trigger: "package.json in the public repo lists Core as a ` +
      `runtime dependency" → blocks merge.`
  );
});

test('public-core-boundary: npm bundle stays thin (file count ceiling)', () => {
  // Guard against silent re-expansion. When the split was tightened
  // (2026-04-22), the public bundle sat at 212 files. Keep a generous
  // ceiling so ordinary additions don't trip this, but catch a large
  // regression (e.g., accidentally adding back a scripts/ subtree).
  const files = npmPackFiles();
  const CEILING = 260;
  assert.ok(
    files.length <= CEILING,
    `public npm bundle should stay <= ${CEILING} files, got ${files.length}. ` +
      `This test exists to catch silent re-expansion of the public shell with ` +
      `features that belong in ThumbGate-Core. If the growth is intentional and ` +
      `stays inside the public shell scope (CLI / hooks / adapters / schemas / ` +
      `marketing), bump the ceiling and add a comment here explaining why.`
  );
});
