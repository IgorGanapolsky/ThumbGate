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
  // Bumped 260 → 261 (2026-05-21) to ship public/agents-cost-savings.html
  // — sister-bumped from public-bundle-ratchet + package-boundary
  // (changeset: agents-cost-savings-landing.md). All three ratchets must
  // stay in lockstep.
  // Bumped 261 → 262 (2026-05-21) to ship public/ai-malpractice-prevention.html
  // — legal-vertical landing page (changeset: ai-malpractice-prevention-landing.md).
  // Bumped 262 → 263 (2026-05-22) to ship scripts/silent-failure-cluster.js:
  // meta-agent-loop.js imports it when THUMBGATE_SILENT_FAILURE_CLUSTERING=1,
  // so omitting it breaks the published experimental unsupervised track.
  // Bumped 263 → 264 (2026-05-22) to ship scripts/self-healing-check.js:
  // `thumbgate self-heal` invokes it before scripts/self-heal.js, so omitting
  // it breaks published installs even though source-checkout tests pass.
  // Bumped 264 → 265 (2026-05-29) to ship scripts/mcp-oauth.js: src/api/server.js
  // requires it for the remote MCP connector's OAuth 2.1 discovery/authorization
  // (Claude Connectors Directory requirement). In-scope public shell (the hosted
  // connector); omitting it breaks the metadata endpoints at runtime.
  // Bumped 265 → 268 (2026-05-31) to ship the release runtime files for agent
  // orchestration hardening: scripts/install-shim.js, scripts/plan-gate.js, and
  // scripts/trajectory-scorer.js. These are invoked by the published CLI/hooks,
  // so omitting them breaks packaged installs while staying inside public shell.
  // Bumped 268 → 271 (2026-05-31) to ship the action-loop instrumentation set:
  // scripts/action-receipts.js, scripts/noop-detect.js, scripts/repeat-metric.js.
  // These are pure public-shell intelligence features (no Core dependency) wired
  // into gate_stats/dashboard, track_action, and capture_feedback. Keep in
  // lockstep with BASELINE_FILE_COUNT in tests/public-bundle-ratchet.test.js.
  // Bumped 271 → 272 (2026-06-01) to ship scripts/brain.js for the packaged
  // customer/repo brain CLI: stable soul, sourced memory, routed context,
  // never-do gates, and cleanup reporting. It is public-shell runtime invoked
  // by bin/cli.js, not a private Core import.
  // Bumped 272 → 277 (2026-06-01) to ship enterprise Postgres + pgvector storage:
  // scripts/enterprise-postgres.js, scripts/postgres-db.js, scripts/storage-adapter.js,
  // scripts/migrate-to-postgres.js, scripts/postgres-guard.js.
  const files = npmPackFiles();
  const CEILING = 277;
  assert.ok(
    files.length <= CEILING,
    `public npm bundle should stay <= ${CEILING} files, got ${files.length}. ` +
      `This test exists to catch silent re-expansion of the public shell with ` +
      `features that belong in ThumbGate-Core. If the growth is intentional and ` +
      `stays inside the public shell scope (CLI / hooks / adapters / schemas / ` +
      `marketing), bump the ceiling and add a comment here explaining why.`
  );
});

test('public-core-boundary: federal lead-gen surfaces present', () => {
  // docs/FEDERAL.md is the technical positioning brief referenced from
  // outbound SBIR / agency channels; public/federal.html is the landing
  // page wired into /federal in src/api/server.js. Removing either without
  // a documented successor breaks the federal lead-gen funnel.
  // If you intentionally restructure these surfaces, update this assertion
  // to point at the new canonical locations.
  const requiredFiles = ['docs/FEDERAL.md', 'public/federal.html'];
  const missing = requiredFiles.filter((p) => !fs.existsSync(path.join(root, p)));

  assert.deepEqual(
    missing,
    [],
    `Federal lead-gen surfaces missing: ${missing.join(', ')}. ` +
      `These are referenced from outbound channels and the README docs section. ` +
      `Per docs/FEDERAL.md "Architectural Invariants", federal capabilities must ` +
      `remain reachable on the public marketing surface without affecting the ` +
      `developer install path.`
  );
});

test('public-core-boundary: only THUMBGATE_DEPLOY gates federal behavior', () => {
  // Per docs/FEDERAL.md "Architectural Invariants" §3: `THUMBGATE_DEPLOY=gov`
  // is the only switch that activates federal-specific behavior. This guards
  // against env-var sprawl (e.g., THUMBGATE_GOV=1 + THUMBGATE_FEDERAL=true
  // + THUMBGATE_FIPS=on all doing related things in different code paths).
  // A single canonical switch keeps the boundary auditable.
  const packaged = npmPackFiles().filter((f) => /\.(m?js|cjs|ts)$/.test(f));
  const FORBIDDEN_SWITCHES = [
    /process\.env\.THUMBGATE_GOV\b/,
    /process\.env\.THUMBGATE_FEDERAL\b/,
    /process\.env\.THUMBGATE_FIPS\b/,
    /process\.env\.THUMBGATE_FEDRAMP\b/,
  ];
  const violations = [];

  for (const relPath of packaged) {
    if (relPath === SELF_PATH) continue;
    const abs = path.join(root, relPath);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8');

    for (const pattern of FORBIDDEN_SWITCHES) {
      const match = src.match(pattern);
      if (match) {
        violations.push(`${relPath}: ${match[0]}`);
        break;
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Federal behavior must gate on THUMBGATE_DEPLOY=gov only. ` +
      `Found alternate env switches in ${violations.length} file(s):\n  ` +
      violations.join('\n  ') +
      `\n\nConsolidate behind THUMBGATE_DEPLOY=gov (see docs/FEDERAL.md).`
  );
});
