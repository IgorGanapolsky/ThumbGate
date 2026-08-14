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
  // Bumped 271 -> 285 to accommodate new guides and scripts from main.
  // Bumped 285 -> 290 (2026-06-04) to ship scripts/upstream-contribution-engine.js for dependency contribution scouting.
  // Bumped 290 -> 292 (2026-06-06) to ship scripts/feedback-aggregate-stats.js
  // and scripts/statusline-cache-read.js, required by packaged statusline
  // installs to aggregate cross-store feedback and per-folder caches.
  // Bumped 292 -> 293 (2026-06-06) to ship scripts/activation-quickstart.js,
  // the guided first-rule activation walkthrough behind `thumbgate quickstart`.
  // Bumped 293 -> 310 (2026-06-08) to ship brand assets, icons, SVGs, and buyer intent scripts
  // required for dashboard visual assets and local parity.
  // Bumped 310 -> 311 (2026-06-10) to ship scripts/secret-redaction.js, the
  // canonical secret-redaction helper required at runtime by the capture path
  // (feedback-loop/lesson-inference/feedback-history-distiller/self-distill) and
  // the DPO + Databricks exporters. Public-shell security fix, no Core dependency.
  // Bumped 294 -> 298 (2026-06-10) to ship five discoverable /thumbgate-*
  // slash-commands in .claude/commands/ (guard, rules, blocked, protect, doctor)
  // so enforcement value is browsable in the agent command palette like GSD's
  // /gsd-*. Thin wrappers over existing MCP tools/CLI, no Core dependency, no new
  // logic. Keep in lockstep with BASELINE_FILE_COUNT in public-bundle-ratchet.test.js.
  // Bumped 298 -> 299 (2026-06-11) to ship scripts/sync-telemetry-from-prod.js,
  // which pulls the real web funnel from the operator-gated /v1/telemetry/export
  // into the local store so get_business_metrics stops reading an empty ledger.
  // Public-shell observability tool, no Core dependency. Keep in lockstep with
  // Bumped 316 -> 317 (2026-06-11) to ship scripts/tool-contract-validator.js.
  // Bumped 317 -> 321 (2026-06-11) to ship Letta adapter, async-eval-observability,
  // eval-rag, agent-memory-lifecycle, and stripe-checkout-diagnostic.
  // Bumped 321 -> 324 (2026-06-16) to ship the Guardian/Ethicore policy-engine
  // adapter and commercial-truth claim gate as public-shell enforcement.
  // Bumped 324 -> 326 (2026-06-22) to ship the new transparent brand logo SVG.
  // Bumped 326 -> 327 (2026-06-29) to ship public/diagnostic.html, the
  // buyer-facing Workflow Hardening Diagnostic conversion page and deploy-gated
  // route for the $499 diagnostic checkout path.
  // Bumped 327 -> 328 (2026-07-02) to ship public/install.html, the
  // install-intent buyer path for marketplace/distribution traffic.
  // Bumped 328 -> 330 (2026-07-09) to ship scripts/entitlement.js and
  // config/entitlement-public-keys.json. These are public-runtime verification
  // files for signed entitlements: no private keys, no Core dependency, and no
  // pro source subtree. Keep in lockstep with public-bundle-ratchet + package-boundary.
  // Bumped 330 -> 332 (2026-07-09) to ship scripts/imperative-detector.js
  // (never/always directive -> force-gate offer) and scripts/rule-clustering.js
  // (landing concurrently). Keep in lockstep with public-bundle-ratchet.
  const files = npmPackFiles();
  // 333 -> 338 (2026-07-15): public Codex feedback hooks ship their context
  // distiller and retrieve_lessons ships retrieval, reranking, cross-encoding,
  // and embedding-index modules.
  // 338 -> 339 (2026-07-15): scripts/buyer-paths.js keeps packaged CLI
  // conversion receipts and rate-limit messages on first-party intent gates.
  // 339 -> 340 (2026-07-15): scripts/revenue-offer-system.js adds the bounded
  // public offer and qualification contract. It has no Core dependency.
  // 340 -> 344 (2026-07-16): package the sales pipeline, authenticated PayPal
  // payment reconciler, and its two provider-evidence dependencies. They are
  // public-shell evidence controls with no Core import or proprietary module.
  // 344 -> 346 (2026-07-16): package the action-eligibility and read-only
  // remediation modules required by the public revenue:remediate command.
  // 346 -> 349 (2026-07-16): package the public Grafana revenue-evidence
  // exporter, operator guide, and aggregate dashboard. They contain no Core
  // import, buyer identity, secret, or proprietary module.
  // 349 -> 350 (2026-07-16): package the hosted intake queue operator client.
  // It is aggregate-only by default, ships no buyer state, and imports no Core.
  // 350 -> 352 (2026-07-16): package the read-only Stripe product audit and
  // credential resolver used by the public payment reconciler.
  // 352 -> 354 (2026-07-16): package the exact Stripe offer catalog and its
  // read-only price and Payment Link drift audit. They import no Core code and
  // contain no credential, buyer state, or external mutation path.
  // 354 -> 357 (2026-07-22): observability env loader, setup CLI, JSONL window.
  // 357 -> 359 (2026-07-23): Poolside-style blog essays under public/blog/.
  // 359 -> 368 (2026-07-26): verified task-outcome runtime, escalation,
  // monitoring, and their public schemas/golden regression artifacts.
  // 368 -> 369 (2026-07-26): public local schedule manager required by the
  // outcome monitor installer and the existing agent:schedule package script.
  // 369 -> 370 (2026-07-27): public MCP KPI telemetry runtime.
  // 371 -> 386 (2026-07-29): buyer evaluation proof pack — public white paper,
  // architecture gallery + diagrams, eval scorecard (+ generator), evaluations
  // page, case-studies page (marketing/docs shell surfaces; no Core imports).
  // 370 -> 371 (2026-07-28): scripts/model-eval.js. The packaged risk-scorer.js
  // require()s it at module load, so without it the published package throws on
  // require. It is pure evaluation arithmetic (metrics + deterministic splitting),
  // imports no Core code, touches no filesystem, network, or buyer state, and stays
  // inside the public shell scope. model-calibration.js and eval-risk-model.js are
  // development-only and deliberately stay OUT of the tarball.
  // 386 -> 390 (2026-07-29): refresh-proof-pack + outreach generators + eval-scorecard.json
  // 390 -> 391 (2026-07-29): scripts/rag-structured-output.js required by dashboard-chat
  // structured answers. IR/eval tooling (ir-metrics, ranking golden) stays repo-local.
  // 391 -> 392: pragmatic-hybrid-search required by lesson-retrieval
  // 392 -> 395 (2026-07-30): server.json + glama.json + smithery.yaml for
  // Glama/MCP registry stdio start contract (npx -y thumbgate serve).
  // 395 -> 400 (2026-07-30): public lesson embedding maintenance, executable
  // hybrid ablation + golden fixture, and the document chunker/skill-pack
  // dependencies now reachable from packaged document search. These are local
  // retrieval runtime/eval surfaces and import no private Core module.
  // 400 -> 401 (2026-07-30): scripts/harness-tool-names.js. adapters/mcp/server-stdio.js require()s it during gate_check, so the published package throws without it. Pure lookup table mapping harness tool vocabularies to canonical gate names; no I/O, no Core imports.
  // 401 -> 405 (2026-07-31): keep lockstep with package-boundary / public-bundle-ratchet.
  // 405 -> 416 (2026-08-01): exact package count for the ten public
  // evidence/runtime files documented in CHANGELOG.md. No headroom.
  // 416 -> 418 (2026-08-02): the universal claim evaluator runtime and its
  // operator-owned verifier example. Both are public enforcement surfaces;
  // neither imports private Core code or buyer state.
  // 418 -> 419 (2026-08-02): default config/gates/claim-verifiers.json.
  // 419 -> 421 (2026-08-02): scripts/financial-control-plane.js and its shared
  // crash-recoverable ledger lock. Together they form the fail-closed public
  // hook/MCP transaction boundary; neither imports private Core code or buyer
  // state. The measured package contains exactly 421 files, with no headroom.
  // CI pack measured 403 during secret-exfil coverage PR (no intentional new package
  // entries beyond security/runtime scripts already on the enforcement path).
  // 421 -> 423 (2026-08-05): scripts/cli-progress.js (dashboard/cfo/north-star UX)
  // and scripts/dashboard-limits.js (shared JSONL/string-limit helpers for the
  // hosted dashboard fail-soft path). Pure public-shell CLI/runtime; no Core.
  // 423 -> 424 (2026-08-09): public/founders.html Oceans-inspired $499 cash-path landing.
  // 424 -> 431 (2026-08-10): WorkOS + Herdr + /peter partner landing + packaged prove scripts.
  // 431 -> 432 (2026-08-10): scripts/stealth-memory-injection-gate.js is the
  // packaged MemGhost structural enforcement runtime. Exact count, no headroom.
  // 432 -> 434 (2026-08-11): mcp-wiring-doctor + remote-feedback-capture for
  // unattended RAG loop (project .mcp.json dogfood + hosted capture fallback).
  // 434 -> 436 (2026-08-11): Matryoshka embedding supports packaged RAG
  // guardrails, and temporal decay supports packaged lesson retrieval.
  // Exact measured artifact, no headroom.
  // Keep lockstep with package-boundary + public-bundle-ratchet.
// 436 -> 437 (2026-08-11): session-lease is packaged public-shell hygiene
  // required to prevent concurrent checkout collisions. Exact count, no headroom.
  // The authenticated production proof seed is required by the packaged API server.
  // 442 -> 449
    // 449 -> 450 (2026-08-12): scripts/rag-embedding-identity.js — embedding identity ROI gate (Pete Johnson / SDS #1017)
  // (terms/privacy/support/third-party-notices + CONTRIBUTING/THIRD_PARTY_NOTICES).
  // Keep lockstep with package-boundary + public-bundle-ratchet.
  // 458 -> 459 (2026-08-14): scripts/governance-difficulty-curriculum.js
  // EdotEnv harder-next-round transfer in the public Reliability Gateway.
  const CEILING = 459;
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
