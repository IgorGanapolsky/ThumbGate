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

// ---------------------------------------------------------------------------
// Federal expansion boundary invariants (added 2026-05-13).
// Per docs/federal-expansion.md — ThumbGate Federal is a Core-side deployment
// profile, NOT a fork. The public npm package must remain identical regardless
// of whether anyone is paying for a federal pilot. These five invariants
// codify the contract; each one corresponds to a section of the federal
// expansion brief.
// ---------------------------------------------------------------------------

// A public-shell file is allowed to MENTION federal deployment for marketing /
// docs purposes — that's how the /federal landing page exists. The actual
// boundary is: NO public-shell file may CONDITIONALLY EXECUTE federal-only
// code paths or REQUIRE a federal env var. We allowlist files whose role is
// to describe the federal lane (landing page, expansion doc, this test).
const FEDERAL_DOC_ALLOWLIST = new Set([
  'public/federal.html',
  'docs/federal-expansion.md',
  SELF_PATH,
]);

const PACKAGED_JS_EXT = /\.(m?js|cjs|ts)$/;

function readPackagedSourceFiles() {
  const packaged = npmPackFiles().filter((f) => PACKAGED_JS_EXT.test(f));
  const out = [];
  for (const relPath of packaged) {
    const abs = path.join(root, relPath);
    if (!fs.existsSync(abs)) continue;
    out.push({ relPath, src: fs.readFileSync(abs, 'utf8') });
  }
  return out;
}

test('public-core-boundary [federal invariant 1]: no packaged file requires a THUMBGATE_DEPLOY env var to function', () => {
  // The public npm install must work on a fresh machine with zero federal env
  // vars set. Catches accidental `if (!process.env.THUMBGATE_DEPLOY) throw …`
  // or top-level `assert(process.env.THUMBGATE_DEPLOY)` that would break the
  // OSS install path.
  const violations = [];
  const requireDeployPattern = /(throw|assert|process\.exit)\s*[^;]*THUMBGATE_DEPLOY/i;
  const negatedDeployPattern = /!\s*process\.env\.THUMBGATE_DEPLOY/;

  for (const { relPath, src } of readPackagedSourceFiles()) {
    if (FEDERAL_DOC_ALLOWLIST.has(relPath)) continue;
    if (requireDeployPattern.test(src) || negatedDeployPattern.test(src)) {
      violations.push(relPath);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Public packaged files must not require THUMBGATE_DEPLOY env var. The OSS ` +
      `\`npm install thumbgate\` install must work with zero federal env vars set. ` +
      `Found ${violations.length} violation(s):\n  ${violations.join('\n  ')}\n\n` +
      `See docs/federal-expansion.md → Invariant 1.`
  );
});

test('public-core-boundary [federal invariant 3]: federal code paths gate on THUMBGATE_DEPLOY=gov OR licensed Core', () => {
  // Any file that mentions a federal-only capability (FedRAMP, NIST 800-53
  // audit sink, GovCloud LLM routing, air-gapped mode) and ALSO appears in
  // the packaged shell must guard the federal branch behind an explicit
  // opt-in. This catches a feature leak where someone adds "federal audit
  // logging" code to the public package without a runtime gate.
  const federalFeatureMarkers = [
    /\bFedRAMP\b/i,
    /\bNIST[- ]800-?53\b/i,
    /\bGovCloud\b/i,
    /\bair[- ]gapped\b/i,
    /\bbedrock[- ]gov\b/i,
    /\bazure[- ]gov\b/i,
  ];
  const govGatePattern = /THUMBGATE_DEPLOY\s*===?\s*['"]gov['"]|process\.env\.THUMBGATE_DEPLOY/;

  const violations = [];
  for (const { relPath, src } of readPackagedSourceFiles()) {
    if (FEDERAL_DOC_ALLOWLIST.has(relPath)) continue;
    const mentionsFederal = federalFeatureMarkers.some((p) => p.test(src));
    if (!mentionsFederal) continue;
    if (!govGatePattern.test(src)) {
      violations.push(relPath);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Public packaged files that reference federal-only capabilities must guard ` +
      `the federal code path behind THUMBGATE_DEPLOY=gov (or move to ThumbGate-Core). ` +
      `Found ${violations.length} violation(s):\n  ${violations.join('\n  ')}\n\n` +
      `See docs/federal-expansion.md → Invariant 3.`
  );
});

test('public-core-boundary [federal invariant 4]: bundle ceiling is enforced (no federal source leaks into public)', () => {
  // Reuses the existing file-count ceiling (260) as the federal-leak guard.
  // Documented separately here so a future maintainer reading the federal
  // brief sees the connection — Invariant 4 (bundle size doesn't grow from
  // federal work) is enforced by the same ceiling that catches general
  // re-expansion. Bumping the ceiling for federal-named files would be the
  // exact regression this prevents.
  const files = npmPackFiles();
  const federalishFiles = files.filter((f) =>
    /federal|gov-cloud|govcloud|fedramp|nist-800|air-gapped/i.test(f)
      && !FEDERAL_DOC_ALLOWLIST.has(f)
  );

  assert.deepEqual(
    federalishFiles,
    [],
    `Public npm package must not ship federal-named source files. ` +
      `Federal capabilities live in ThumbGate-Core. ` +
      `Found ${federalishFiles.length} federal-named packaged file(s):\n  ${federalishFiles.join('\n  ')}\n\n` +
      `Marketing/docs surfaces (public/federal.html, docs/federal-expansion.md) ` +
      `are allowlisted. See docs/federal-expansion.md → Invariant 4.`
  );
});

test('public-core-boundary [federal invariant 5]: developer MCP tool surface stable across deploy modes', () => {
  // The public dev MCP tools — gate_stats, recall, capture_feedback — must
  // have IDENTICAL definitions regardless of THUMBGATE_DEPLOY value. A
  // developer running ThumbGate locally and a contractor running it inside
  // a GovCloud VPC must see the same tool contracts. We pin this by
  // requiring no public source file conditionally redefines these tool
  // names based on THUMBGATE_DEPLOY.
  const stableTools = ['gate_stats', 'recall', 'capture_feedback'];
  const violations = [];

  for (const { relPath, src } of readPackagedSourceFiles()) {
    if (FEDERAL_DOC_ALLOWLIST.has(relPath)) continue;
    for (const tool of stableTools) {
      // Look for a conditional branch that redefines or skips a stable tool
      // based on THUMBGATE_DEPLOY. The regex is intentionally loose to catch
      // both `if (process.env.THUMBGATE_DEPLOY) { tools.push({ name: 'gate_stats', …` style
      // and ternary `THUMBGATE_DEPLOY === 'gov' ? altGateStats : gateStats`.
      const conditionalRedef = new RegExp(
        `THUMBGATE_DEPLOY[\\s\\S]{0,200}['"\`]${tool}['"\`]|['"\`]${tool}['"\`][\\s\\S]{0,200}THUMBGATE_DEPLOY`
      );
      if (conditionalRedef.test(src)) {
        violations.push(`${relPath}: ${tool} appears near THUMBGATE_DEPLOY branch`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Public MCP tool contracts (gate_stats, recall, capture_feedback) must NOT be ` +
      `redefined based on THUMBGATE_DEPLOY. Same tool, same response shape, both modes. ` +
      `Found ${violations.length} suspicious conditional(s):\n  ${violations.join('\n  ')}\n\n` +
      `If you need a federal-mode variant, ship it as a NEW tool name in ThumbGate-Core, ` +
      `do not branch on the existing public tool. See docs/federal-expansion.md → Invariant 5.`
  );
});

test('public-core-boundary [federal invariant 2 / docs alignment]: federal brief and landing page exist and cross-link', () => {
  // Invariant 2 (public CI passes without Core) is structural — covered by
  // the earlier "no Core import" and "no Core dep" assertions. This separate
  // assertion catches the marketing-side drift case: the /federal landing
  // page is the source of truth for the federal pitch, and the
  // docs/federal-expansion.md doc is the engineering boundary contract.
  // If either disappears or stops cross-linking the other, future agents
  // are likely to re-derive the federal positioning incorrectly.
  const landing = path.join(root, 'public/federal.html');
  const brief = path.join(root, 'docs/federal-expansion.md');
  assert.ok(fs.existsSync(landing), 'public/federal.html must exist (marketing surface).');
  assert.ok(fs.existsSync(brief), 'docs/federal-expansion.md must exist (engineering boundary contract).');

  const landingSrc = fs.readFileSync(landing, 'utf8');
  const briefSrc = fs.readFileSync(brief, 'utf8');

  assert.ok(
    landingSrc.includes('federal-expansion.md'),
    '/federal landing page must link to docs/federal-expansion.md so engineers reading it ' +
      'find the boundary contract.'
  );
  assert.ok(
    briefSrc.includes('tests/public-core-boundary.test.js'),
    'docs/federal-expansion.md must reference tests/public-core-boundary.test.js so the ' +
      'reader knows the invariants are enforced by code, not honor system.'
  );
});
