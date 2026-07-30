'use strict';

/**
 * public-bundle-ratchet.test.js — moat boundary ratchet.
 *
 * Background. The 2026-05-18 strict-assessment audit found that 212 of the
 * 216 scripts in private `ThumbGate-Core/scripts/` are also in this public
 * repo's `scripts/`, and all of them ship via npm. The "private intelligence"
 * boundary in CLAUDE.md is aspirational; in practice the public bundle ships
 * 412 scripts including Thompson Sampling, lesson DB internals, reward
 * functions, RLAIF audit, and the auto-promotion algorithm.
 *
 * The moat decision (Option A, 2026-05-18) is to **stop pretending Core is
 * the moat**. Instead, the moat is hosted infrastructure + support + the
 * dashboard. Public code is permissive on purpose.
 *
 * What this test does: it freezes the npm bundle file count at the audit
 * baseline (254 files) and refuses to let it grow. Every PR that adds a
 * new file to `package.json:files` must justify it OR remove an equal
 * number of files. The ratchet is one-way — the count can decrease over
 * time as we remove obsolete scripts, but never increase past the baseline
 * without an explicit override.
 *
 * Override: set `THUMBGATE_BUNDLE_RATCHET_BASELINE` in the environment to
 * a higher number to ratchet the ceiling up after a deliberate change.
 *
 * Updating the baseline: run `npm pack --dry-run | tail -3 | head -1`,
 * confirm the count is the intended new baseline, then update BASELINE
 * below and add a CHANGELOG entry explaining what was added.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const path = require('node:path');

// 2026-05-19 bump (was 254 from 2026-05-18 audit). Three additive files
// landing concurrently:
//   • scripts/verify-marketing-pages-deployed.js (post-deploy probe)
//   • config/post-deploy-marketing-pages.json    (sentinel manifest)
//   • public/agent-manager.html                  (ICP landing page after
//                                                  Anthropic named the role)
// This number is allowed to DECREASE; another bump up requires a
// deliberate changeset entry.
// 257 → 258: scripts/cli-demo.js added in broker-audit-conversion-fix branch
// 258 → 259: scripts/audit.js added — the AI Bill Auditor command
//            (changeset: ai-bill-auditor.md)
// 259 → 260: public/codex-enterprise.html added — landing page riding the
//            2026-05-20 OpenAI×Dell Codex Enterprise partnership announcement
//            (changeset: codex-enterprise-dell-landing.md)
// 260 → 261: public/agents-cost-savings.html added — FinOps-for-AI positioning
//            page that pairs with the `thumbgate cost` CLI (#2281).
//            (changeset: agents-cost-savings-landing.md)
// 261 → 262: public/ai-malpractice-prevention.html added — legal-vertical
//            landing page built for the warm Greenberg Traurig lead
//            (Matt Beekhuizen demo 2026-05-28).
//            (changeset: ai-malpractice-prevention-landing.md)
// 262 → 263: scripts/silent-failure-cluster.js added so the experimental
//            THUMBGATE_SILENT_FAILURE_CLUSTERING=1 lane works from npm, not
//            only from source checkouts.
// 263 → 264: scripts/self-healing-check.js added so `thumbgate self-heal`
//            works from npm installs instead of failing before self-heal.js.
// 264 → 265: scripts/visitor-journey.js added so hosted telemetry export can
//            produce session-level path/dropoff summaries in packaged runtime.
// 265 → 268: scripts/install-shim.js, scripts/plan-gate.js, scripts/trajectory-scorer.js
//            added for CodeRabbit high-ROI orchestration and install hooks.
// 268 → 271: scripts/action-receipts.js, scripts/noop-detect.js, scripts/repeat-metric.js
//            added for the action-loop instrumentation feature set
//            (repeat-metric, no-op detection, outcome-paired action receipts).
//            (changeset: action-loop-instrumentation.md). Keep in lockstep with
//            CEILING in tests/public-core-boundary.test.js.
// 271 → 277: 2026-06-03 features.
// 277 → 278: 2026-06-03 features.
// 278 → 280: 2026-06-03 features.
// 280 → 285: 2026-06-03 features.
// 285 → 290: 2026-06-04 scripts/upstream-contribution-engine.js added for dependency contributions.
// 290 → 292: 2026-06-06 scripts/feedback-aggregate-stats.js and
// scripts/statusline-cache-read.js added so packaged statusline installs can
// aggregate cross-store feedback and per-folder caches.
// 292 → 293: 2026-06-06 scripts/activation-quickstart.js added so the
// `thumbgate quickstart` guided first-rule activation walkthrough works from
// npm installs (changeset: activation-first-rule-onboarding.md).
// 293 → 310: 2026-06-08 brand assets, icons, SVGs, and buyer intent scripts added for dashboard and local parity.
// 310 → 315: 2026-06-10 five discoverable /thumbgate-* slash-commands added to .claude/commands/ and scripts/secret-redaction.js.
// 315 → 316: 2026-06-11 scripts/sync-telemetry-from-prod.js added.
// 316 → 317: 2026-06-11 scripts/tool-contract-validator.js added.
// 317 → 321: 2026-06-11 Letta adapter, async-eval-observability, eval-rag, agent-memory-lifecycle, and stripe-checkout-diagnostic added.
// 321 → 324: 2026-06-16 Guardian/Ethicore policy-engine adapter and
// commercial-truth claim gate added as public runtime enforcement.
// 324 → 326: 2026-06-22 ship new transparent brand logo SVG.
// 326 → 327: 2026-06-29 ship public/diagnostic.html, the focused Workflow
// Hardening Diagnostic conversion page for warm traffic.
// 327 → 328: 2026-07-02 ship public/install.html, the install-intent buyer
// path linked from marketplace/distribution traffic.
// 328 → 330: 2026-07-09 ship scripts/entitlement.js and
// config/entitlement-public-keys.json for signed-entitlement verification in
// the public runtime. Public keys only; no private key material or Core subtree.
// 2026-07-09 bump 330 -> 332: two additive runtime modules landing concurrently:
//   • scripts/rule-clustering.js      (leverage-point clustering in the rules report)
//   • scripts/imperative-detector.js  (never/always directive -> force-gate offer)
// 2026-07-11: hooks/hooks.json added to the bundle so a plugin /
// desktop-extension install of "thumbgate" actually wires the PreToolUse /
// UserPromptSubmit / SessionStart enforcement lifecycle (without it an install
// got skills+commands+mcpServers but ZERO enforcement). It replaced headroom
// under the ceiling, so the count stays at 332 — no baseline bump required.
// 332 -> 333: public/partner-intake.html adds the form-only partner handoff
// used by attributed marketplace listings before a scoped offer is accepted.
// 333 -> 338: scripts/feedback-history-distiller.js powers context inference
// for bare thumbs, while lesson-retrieval.js, lesson-reranker.js,
// cross-encoder-reranker.js, and lesson-embedding-index.js make the advertised
// retrieve_lessons tool executable in the packed npm runtime.
// 338 -> 339: scripts/buyer-paths.js centralizes first-party intent URLs used
// by packaged CLI conversion receipts and rate-limit messages.
// 339 -> 340: scripts/revenue-offer-system.js ships the bounded public offer,
// qualification, zero-spend, proof, and target-math contract used by the CLI.
// 340 -> 344: sales-pipeline.js, provider-payment-reconciler.js, and the two
// provider-evidence dependencies close the manual paid-claim path in the
// packaged public CLI without adding ThumbGate-Core code.
// 344 -> 346: revenue-action-eligibility.js and
// revenue-evidence-remediation.js keep the advertised remediation command
// executable after npm install without importing ThumbGate-Core.
// 346 -> 349: the claim-safe Grafana revenue-evidence exporter, operator guide,
// and aggregate dashboard now ship to npm customers instead of remaining repo-only.
// 349 -> 350: the aggregate-first hosted intake queue operator client ships
// without buyer records, private Core code, or implicit outbound authority.
// 350 -> 352: package the read-only Stripe product-attribution audit and its
// credential resolver so the payment reconciler can prove Stripe charges in
// the same fail-closed pipeline contract as PayPal.
// 352 -> 354: package the exact Stripe offer catalog and its read-only live
// price/Payment-Link drift audit. Both are public evidence controls with no
// buyer state, credential material, mutation path, or ThumbGate-Core import.
// 354 -> 357: observability env loader, setup CLI, and bounded JSONL window
// reader for hosted telemetry export / revenue doctor (no buyer state).
// 357 -> 359: Poolside-style blog essays under public/blog/ (hosted marketing
// surface only; no new scripts, secrets, or buyer state).
// 359 -> 368: verified task outcomes ship four public runtime modules plus
// five schemas/evaluation artifacts required by the API, MCP tools, CI gate,
// and production monitor. No buyer state, credentials, or private modules.
// 368 -> 369: ship the existing local schedule manager required by the public
// daily outcome-monitor installer and the already-advertised agent:schedule.
// 369 -> 370: ship tool-kpi-tracker so every packaged MCP attempt feeds the
// public production-observability contract instead of silently dropping KPIs.
// 370 -> 371: ship scripts/model-eval.js. The packaged risk-scorer.js require()s it
// at module load, so omitting it makes the published package throw on require. Pure
// evaluation arithmetic (classification metrics + deterministic group-aware
// splitting); no Core imports, no filesystem, network, credentials, or buyer state.
// model-calibration.js and eval-risk-model.js are development-only and stay out.
// 392 -> 395 (2026-07-30): ship server.json + glama.json + smithery.yaml so
// Glama/MCP registry installs receive explicit stdio start metadata
// (`npx -y thumbgate serve`) instead of guessing `npm start` (HTTP API).
// 395 -> 400 (2026-07-30): local embedding maintenance + hybrid ablation
// runtime/fixture plus document chunker + skill-pack dependencies now reachable
// from packaged document search; public retrieval proof, no private Core code.
const BASELINE_FILE_COUNT = 400;

function readBundleSnapshot() {
  const repoRoot = path.resolve(__dirname, '..');
  const stdout = execSync('npm pack --dry-run --json', {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(stdout);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  return { fileCount: entry.entryCount, unpackedSize: entry.unpackedSize, name: entry.name };
}

test('public npm bundle file count stays at or below the 2026-05-18 audit baseline', () => {
  const ceiling = Number(process.env.THUMBGATE_BUNDLE_RATCHET_BASELINE || BASELINE_FILE_COUNT);
  const snapshot = readBundleSnapshot();
  assert.ok(
    snapshot.fileCount <= ceiling,
    `public npm bundle has ${snapshot.fileCount} files (ceiling ${ceiling}). ` +
      `Either remove files from package.json:files OR raise BASELINE_FILE_COUNT in this test ` +
      `with a CHANGELOG note explaining what was added and why.`
  );
});

test('bundle includes the canonical entrypoints (sanity check that the snapshot is real)', () => {
  const snapshot = readBundleSnapshot();
  assert.equal(snapshot.name, 'thumbgate');
  assert.ok(snapshot.fileCount > 0);
  assert.ok(snapshot.unpackedSize > 0);
});
