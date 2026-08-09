const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const packageJson = require('../package.json');

const root = path.join(__dirname, '..');

function npmPackManifest() {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const manifest = JSON.parse(output)[0];
  return {
    fileCount: manifest.files.length,
    unpackedSize: manifest.unpackedSize,
    files: manifest.files.map((file) => file.path),
  };
}

function npmPackFiles() {
  return npmPackManifest().files;
}

function resolveRelativeRequire(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const basePath = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    basePath,
    `${basePath}.js`,
    path.join(basePath, 'index.js'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function collectStaticRuntimeDependencies(entryFile, packagedFiles) {
  const packaged = new Set(packagedFiles);
  const seen = new Set();
  const missing = new Set();

  function toPackagePath(filePath) {
    return path.relative(root, filePath).split(path.sep).join('/');
  }

  function visit(filePath) {
    const packagePath = toPackagePath(filePath);
    if (seen.has(packagePath)) return;
    seen.add(packagePath);

    const source = fs.readFileSync(filePath, 'utf8');
    const requirePattern = /require\(['"](\.{1,2}\/[^'"]+)['"]\)/g;
    let match;
    while ((match = requirePattern.exec(source)) !== null) {
      const resolved = resolveRelativeRequire(filePath, match[1]);
      if (!resolved || !resolved.startsWith(root)) continue;

      const dependencyPath = toPackagePath(resolved);
      if (!packaged.has(dependencyPath)) {
        missing.add(`${packagePath} -> ${dependencyPath}`);
        continue;
      }
      visit(resolved);
    }
  }

  visit(path.join(root, entryFile));
  return [...missing].sort();
}

test('npm package excludes generated runtime state from included directories', () => {
  const runtimeDb = path.join(root, 'scripts', 'social-analytics', 'db', 'package-leak-test.sqlite');
  const pycacheDir = path.join(root, 'scripts', '__pycache__');
  const pycacheFile = path.join(pycacheDir, 'package_leak_test.cpython-314.pyc');

  fs.mkdirSync(path.dirname(runtimeDb), { recursive: true });
  fs.mkdirSync(pycacheDir, { recursive: true });
  fs.writeFileSync(runtimeDb, 'local sqlite state must not ship\n');
  fs.writeFileSync(pycacheFile, 'compiled bytecode must not ship\n');

  try {
    const files = npmPackFiles();
    assert.equal(files.includes('scripts/social-analytics/db/package-leak-test.sqlite'), false);
    assert.equal(files.includes('scripts/__pycache__/package_leak_test.cpython-314.pyc'), false);
  } finally {
    fs.rmSync(runtimeDb, { force: true });
    fs.rmSync(pycacheFile, { force: true });
    try {
      fs.rmdirSync(pycacheDir);
    } catch {
      // Keep the directory if a developer has other local bytecode files.
    }
  }
});

test('npm package ships static dependencies needed for packaged entrypoints', () => {
  const files = npmPackFiles();
  const mcpMissing = collectStaticRuntimeDependencies('adapters/mcp/server-stdio.js', files);
  const apiMissing = collectStaticRuntimeDependencies('src/api/server.js', files);
  const hookRuntimeMissing = collectStaticRuntimeDependencies('scripts/hook-runtime.js', files);
  const salesPipelineMissing = collectStaticRuntimeDependencies('scripts/sales-pipeline.js', files);
  const paymentReconcilerMissing = collectStaticRuntimeDependencies('scripts/provider-payment-reconciler.js', files);
  const revenueEligibilityMissing = collectStaticRuntimeDependencies('scripts/revenue-action-eligibility.js', files);
  const revenueRemediationMissing = collectStaticRuntimeDependencies('scripts/revenue-evidence-remediation.js', files);
  const workflowIntakeQueueMissing = collectStaticRuntimeDependencies('scripts/workflow-intake-queue.js', files);

  assert.deepEqual(mcpMissing, []);
  assert.deepEqual(apiMissing, []);
  assert.deepEqual(hookRuntimeMissing, []);
  assert.deepEqual(salesPipelineMissing, []);
  assert.deepEqual(paymentReconcilerMissing, []);
  assert.deepEqual(revenueEligibilityMissing, []);
  assert.deepEqual(revenueRemediationMissing, []);
  assert.deepEqual(workflowIntakeQueueMissing, []);
});

test('API runtime declares its YAML parser as a production dependency', () => {
  const apiSource = fs.readFileSync(path.join(root, 'src', 'api', 'server.js'), 'utf8');

  assert.match(apiSource, /require\(['"]js-yaml['"]\)/);
  assert.ok(packageJson.dependencies['js-yaml']);
});

test('npm package ships a slim runtime boundary instead of repo/dev surfaces', () => {
  const manifest = npmPackManifest();
  const files = manifest.files;
  const requiredRuntimeFiles = [
    'src/index.js',
    'src/api/server.js',
    'bin/cli.js',
    'bin/postinstall.js',
    'adapters/mcp/server-stdio.js',
    'scripts/bot-detection.js',
    'scripts/feedback-loop.js',
    'scripts/file-ledger-lock.js',
    'scripts/financial-control-plane.js',
    'scripts/gates-engine.js',
    'scripts/grafana-revenue-evidence.js',
    'scripts/hf-papers.js',
    'scripts/self-healing-check.js',
    'scripts/install-shim.js',
    'scripts/plan-gate.js',
    'scripts/provider-live-evidence.js',
    'scripts/provider-payment-reconciler.js',
    'scripts/provider-revenue-evidence.js',
    'scripts/revenue-action-eligibility.js',
    'scripts/revenue-evidence-remediation.js',
    'scripts/sales-pipeline.js',
    'scripts/silent-failure-cluster.js',
    'scripts/statusline-cache-read.js',
    'scripts/statusline.sh',
    'scripts/statusline-meta.js',
    'scripts/stripe-revenue-catalog.js',
    'scripts/stripe-revenue-catalog-audit.js',
    'scripts/tool-contract-validator.js',
    'scripts/tool-registry.js',
    'scripts/trajectory-scorer.js',
    'scripts/workflow-intake-queue.js',
    'skills/thumbgate/SKILL.md',
    'config/pro/constraints-pro.json',
    'config/pro/prevention-rules-pro.md',
    'config/pro/thompson-presets.json',
    'config/pro/reminders-pro.json',
    '.claude-plugin/plugin.json',
    'README.md',
    'LICENSE',
  ];
  // public/ HTML files referenced by server.js MUST ship — the server reads them at
  // runtime via LESSONS_PAGE_PATH etc. Excluding them causes the lessons UI to degrade
  // to the stripped-down "packaged runtime" fallback.
  const requiredPublicFiles = [
    'public/lessons.html',
    'public/index.html',
    'public/pricing.html',
  ];
  const requiredDistributionAssets = [
    'docs/integrations/grafana/README.md',
    'docs/integrations/grafana/thumbgate-revenue-evidence-dashboard.json',
  ];
  const forbiddenPrefixes = [
    'public/learn/',
    'public/guides/',
    'public/compare/',
    'plugins/',
    '.claude-plugin/bundle/',
    'scripts/social-analytics/',
    'scripts/content-engine/',
  ];
  const forbiddenFiles = [
    'bin/memory.sh',
    'bin/obsidian-sync.sh',
    'scripts/autonomous-workflow.js',
    'scripts/apollo-acquisition.js',
    'scripts/decision-trace.js',
    // scripts/post-to-x.js + post-to-x-retry.sh removed 2026-06-06
    // (X/Twitter retired from active distribution 2026-04-20).
    'scripts/reddit-dm-outreach.js',
    'scripts/reddit-monitor-cron.sh',
    'sales/apollo-buyer-search.json',
    'scripts/perplexity-command-center.js',
    'scripts/perplexity-marketing.js',
    'scripts/build-claude-mcpb.js',
    'scripts/build-codex-plugin.js',
    'scripts/analytics-report.js',
    'scripts/billing-setup.js',
    'scripts/creator-campaigns.js',
    'scripts/daemon-manager.js',
    'scripts/dispatch-brief.js',
    'scripts/distribution-surfaces.js',
    'scripts/funnel-analytics.js',
    'scripts/operational-dashboard.js',
    'scripts/operational-summary.js',
    'scripts/optimize-context.js',
    'scripts/pulse.js',
    'scripts/session-episode-store.js',
    'scripts/session-health-sensor.js',
    'scripts/webhook-delivery.js',
    'scripts/managed-lesson-agent.js',
    'scripts/operator-artifacts.js',
    'scripts/org-dashboard.js',
    'scripts/reflector-agent.js',
    'scripts/session-report.js',
    'scripts/swarm-coordinator.js',
    'scripts/delegation-runtime.js',
    'scripts/hosted-job-launcher.js',
    'scripts/intent-router.js',
    'scripts/workflow-sprint-intake.js',
    // Repository-only GitHub preview; no npm runtime or hosted page references it.
    'public/assets/brand/github-social-preview.png',
  ];

  // File-count ceiling bumped 220 → 225 (2026-04-19) after main picked up
  // the autonomous control-plane runner (#956) and progressive-discovery
  // MCP tool (#960), plus this branch's scripts/bayes-optimal-gate.js —
  // combined net of +4 runtime script files shipped to the tarball.
  // Bumped 225 → 230 (2026-04-20) because the MCP server imports these files
  // at startup or through required startup modules. Omitting them crashes
  // published `thumbgate serve` with a closed MCP transport.
  // Bumped 230 → 232 (2026-04-20) to ship the read-only operator artifact
  // generator and its PR pulse dependency for published MCP/CLI runtimes.
  // Bumped 232 → 234 (2026-04-20) for the cross-session canonical-hash
  // module (`scripts/lesson-canonical.js`) required at runtime by
  // lesson-synthesis / lesson-db / feedback-loop, plus one-file headroom.
  // Bumped 234 → 236 (2026-04-20) after rebase onto main that landed #1100:
  // this branch adds public/numbers.html (first-party data transparency page
  // served at /numbers) on top of lesson-canonical.js already on main. Two
  // extra file slots: numbers.html + one-file headroom.
  // Bumped 236 → 238 (2026-04-20) after rebase onto main that landed #1092
  // (numbers.html): this branch adds scripts/rule-validator.js
  // (Autogenesis-inspired pre-promotion validator that feedback-loop.js
  // requires at captureFeedback time) on top of main's post-#1092 baseline.
  // Two extra file slots: rule-validator.js + one-file headroom.
  // Bumped 238 → 242 (2026-05-04) for the high-ROI runtime additions:
  // judge-reward-function, prompting-operating-system, proxy-pointer RAG
  // guardrails, and gemini-embedding-policy required by packaged RAG/vector
  // entrypoints. Keep one-file headroom for release merge churn.
  // Bumped 242 → 245 (2026-05-06) to ship ThumbGate Bench from the npm
  // package: scripts/thumbgate-bench.js plus the default and ProgramBench-style
  // bench fixtures. The CLI now exposes `thumbgate bench --programbench-smoke`.
  // Bumped 245 → 249 (2026-05-07) to ship the four public Pro upgrade bundle
  // files under config/pro so `thumbgate pro --upgrade` works from npm without
  // reintroducing the private top-level pro/ subtree.
  // Bumped 249 → 250 (2026-05-12) to ship the offline feedback-quality eval
  // script referenced by `npm run eval:feedback-quality`; otherwise the
  // published package would expose a dead script.
  // Bumped 250 → 251 (2026-05-13) to ship public/federal.html, the
  // federal-agency lead-gen landing page served at /federal (also /government
  // and /gov aliases). Marketing surface; in-scope for the public shell per
  // CLAUDE.md "Public shell: CLI, hook installer, adapter configs, basic
  // local gate runner, public JSON schemas, marketing/docs." See docs/FEDERAL.md.
  // Bumped 251 → 254 (2026-05-13) to absorb three additive runtime entries:
  //   • scripts/activation-tracker.js (this branch — required by
  //     scripts/feedback-loop.js for the activation_first_rule_promoted ping)
  //   • scripts/plausible-server-events.js (this branch — required by
  //     src/api/server.js for the /checkout/pro funnel events)
  //   • scripts/memory-scope-readiness.js (from origin/main — memory-scope
  //     readiness checks for the agent-native memory scope work)
  // All three ship in the public bundle because the packaged runtime loads
  // them on every server boot; omitting them crashes published `thumbgate serve`.
  // Bumped 254 → 257 (2026-05-19). Three additive files landing concurrently:
  //   • scripts/verify-marketing-pages-deployed.js (post-deploy probe)
  //   • config/post-deploy-marketing-pages.json    (sentinel manifest)
  //   • public/agent-manager.html                  (ICP landing page after
  //                                                  Anthropic named the role)
  // Bumped 257 → 258 (2026-05-19) to ship public/pricing.html. The hosted API
  // serves /pricing from this template, and npm-installed `thumbgate serve`
  // must not degrade the buyer path to a missing static asset.
  // Bumped 258 → 259 (2026-05-20) to ship scripts/audit.js — the AI Bill
  // Auditor (`thumbgate audit`). Omitting it crashes the published command
  // with a missing-module error. (changeset: ai-bill-auditor.md)
  // Bumped 259 → 260 (2026-05-20) to ship public/codex-enterprise.html — the
  // landing page riding the OpenAI×Dell Codex Enterprise distribution wave.
  // Sister-bumped from tests/public-bundle-ratchet.test.js's 259 → 260; both
  // ratchets must stay in lockstep. (changeset: codex-enterprise-dell-landing.md)
  // Bumped 260 → 261 (2026-05-21) to ship public/agents-cost-savings.html —
  // the FinOps-for-AI positioning page that pairs with the `thumbgate cost`
  // CLI. Sister-bumped from public-bundle-ratchet.test.js's 260 → 261; the
  // two ratchets must stay in lockstep. (changeset: agents-cost-savings-landing.md)
  // Bumped 261 → 262 (2026-05-21) to ship public/ai-malpractice-prevention.html
  // — the legal-vertical landing page built for the warm Greenberg Traurig lead
  // (Matt Beekhuizen demo on 2026-05-28). Sister-bumped from
  // public-bundle-ratchet + public-core-boundary; all three stay in lockstep.
  // (changeset: ai-malpractice-prevention-landing.md)
  // Bumped 262 → 263 (2026-05-22) to ship scripts/silent-failure-cluster.js.
  // meta-agent-loop.js requires it when THUMBGATE_SILENT_FAILURE_CLUSTERING=1;
  // without this file, published installs silently lose the experimental
  // unsupervised-learning lane even though source-checkout tests pass.
  // Bumped 263 → 264 (2026-05-22) to ship scripts/self-healing-check.js.
  // bin/cli.js runs it before scripts/self-heal.js for `thumbgate self-heal`;
  // without this file, published installs fail with a missing-module error.
  // Bumped 264 → 265 (2026-05-26) to ship scripts/visitor-journey.js because
  // src/api/server.js uses it for the operator-gated telemetry journey export.
  // Bumped 265 → 268 (2026-05-31) to ship scripts/install-shim.js because
  // scripts/hook-runtime.js requires it during `thumbgate init --wire-hooks`,
  // plus scripts/plan-gate.js and scripts/trajectory-scorer.js because
  // scripts/gates-engine.js requires them in the packaged runtime.
  // Bumped 268 → 271 (2026-06-01) to ship scripts/repeat-metric.js,
  // scripts/noop-detect.js, and scripts/action-receipts.js because
  // adapters/mcp/server-stdio.js, adapters/claw/*, adapters/perplexity/HYBRID.md, and scripts/dashboard.js require them in the
  // packaged runtime (action-loop instrumentation).
  // Bumped 271 -> 272 (2026-06-02) to ship scripts/dashboard-chat.js, required by
  // src/api/server.js for the dashboard "chat with your data" /v1/chat endpoint.
  // Bumped 272 -> 277 (2026-06-03) after reliability rollout packaging proof:
  // scripts/gates-engine.js and scripts/hybrid-feedback-context.js require
  // scripts/feedback-sanitizer.js in packaged runtimes; server.js requires the
  // DFCX adapter for enterprise dashboard routes; and public .well-known assets
  // now ship for Agentic.ai / LLM / MCP discovery.
  // Bumped 277 -> 278 (2026-06-03) to ship bin/dashboard-cli.js for the
  // `thumbgate-dashboard` shortcut that opens the local dashboard without a
  // long command.
  // Bumped 278 -> 280 (2026-06-03) to ship scripts/plausible-domain-config.js
  // (required by server.js + plausible-server-events.js so production does not
  // emit unregistered Plausible domains) and scripts/secret-fixture-tokens.js
  // (required by thumbgate-bench.js to expand scanner-safe secret fixtures).
  // Bumped 280 -> 285 (2026-06-03) to accommodate newly merged guides and scripts from main.
  // Bumped 285 -> 290 (2026-06-04) to ship scripts/upstream-contribution-engine.js for dependency contribution scouting.
  // Bumped 290 -> 292 (2026-06-06) to ship scripts/feedback-aggregate-stats.js
  // and scripts/statusline-cache-read.js, required by packaged statusline
  // installs to aggregate cross-store feedback and per-folder caches.
  // Bumped 292 -> 293 (2026-06-07) to ship scripts/activation-quickstart.js,
  // the runtime behind `thumbgate quickstart` guided first-rule onboarding
  // (bin/cli.js requires it for the activation walkthrough).
  // Bumped 293 -> 310 (2026-06-08) to ship brand assets, icons, SVGs, and buyer intent scripts
  // required for dashboard visual assets and local parity.
  // Bumped 310 -> 311 (2026-06-10) to ship scripts/secret-redaction.js, the
  // canonical secret-redaction helper wired into the capture path and the
  // DPO + Databricks exporters (security fix; no Core dependency).
  // Bumped 294 -> 298 (2026-06-10) to ship five discoverable /thumbgate-*
  // slash-commands in .claude/commands/ (guard, rules, blocked, protect, doctor)
  // so enforcement value is browsable in the agent command palette like GSD's
  // /gsd-*. Thin wrappers over existing MCP tools/CLI — no new logic, no Core dep.
  // Keep in lockstep with public-bundle-ratchet + public-core-boundary ceilings.
  // Bumped 298 → 299 (2026-06-11) for scripts/sync-telemetry-from-prod.js, which
  // syncs the operator-gated prod telemetry export into the local store so
  // get_business_metrics reflects the real funnel (changeset: sync-prod-telemetry.md).
  // Bumped 316 -> 317 (2026-06-11) to ship scripts/tool-contract-validator.js.
  // Bumped 317 -> 321 (2026-06-11) to ship Letta adapter, async-eval-observability,
  // eval-rag, agent-memory-lifecycle, and stripe-checkout-diagnostic.
  // Bumped 321 -> 324 (2026-06-16) to ship the Guardian/Ethicore policy-engine
  // adapter and commercial-truth claim gate as public runtime enforcement.
  // Bumped 324 -> 326 (2026-06-22) to ship the new transparent brand logo SVG.
  // Bumped 326 -> 327 (2026-06-29) to ship public/diagnostic.html, the
  // focused Workflow Hardening Diagnostic conversion page for warm traffic.
  // Bumped 327 -> 328 (2026-07-02) to ship public/install.html, the
  // install-intent buyer path that server.js reads at runtime.
  // Bumped 328 -> 330 (2026-07-09) to ship scripts/entitlement.js and
  // config/entitlement-public-keys.json for signed-entitlement verification.
  // These are public runtime verifier files only: public keys, no private key
  // material, no Core dependency, no pro source subtree.
  // Bumped 330 -> 332 (2026-07-09) to ship scripts/imperative-detector.js
  // (never/always directive -> force-gate offer) in lockstep with the
  // public-core-boundary ceiling.
  // Bumped 333 -> 338 (2026-07-15) to ship feedback-history-distiller.js and
  // the four public lesson-retrieval modules required by same-turn context
  // capture and the already-advertised retrieve_lessons MCP tool.
  // Bumped 338 -> 339 (2026-07-15) to ship the first-party buyer-path helper
  // required by packaged CLI conversion receipts and rate-limit messages.
  // Bumped 339 -> 340 (2026-07-15) to ship the deterministic offer contract
  // used by the revenue operator and proposal qualification tests.
  // Bumped 340 -> 344 (2026-07-16) to ship the sales pipeline, authenticated
  // PayPal payment reconciler, and its two provider-evidence dependencies.
  // These four files close the manual paid-claim path in the packaged CLI.
  // Bumped 344 -> 346 (2026-07-16) so the advertised revenue:remediate script
  // and its shared eligibility dependency are executable after npm install.
  // Bumped 346 -> 349 (2026-07-16) so the Grafana revenue-evidence exporter,
  // operator guide, and importable aggregate dashboard are present after npm install.
  // Bumped 349 -> 350 (2026-07-16) for the secret-safe hosted intake queue
  // operator CLI. It exports no state by default and ships no buyer records.
  // Bumped 350 -> 352 (2026-07-16) for the read-only Stripe product audit and
  // credential resolver required by packaged Stripe payment reconciliation.
  // Bumped 352 -> 354 (2026-07-16) for the exact Stripe offer catalog and its
  // read-only live price and Payment Link drift audit. No credentials, buyer
  // state, mutation route, or private Core module are packaged.
  // Bumped 354 -> 357 (2026-07-22) for observability env loader, setup CLI,
  // and bounded JSONL window reader used by telemetry export + revenue doctor.
  // Bumped 357 -> 359 (2026-07-23) for Poolside-style blog essays under public/blog/
  // (inside-your-boundary + process-over-outcome-gates) served by the hosted package.
  // Bumped 359 -> 368 (2026-07-26) for verified task outcomes, human
  // escalation, production monitoring, and their public eval/schema fixtures.
  // Bumped 368 -> 369 (2026-07-26) to ship the existing schedule manager used
  // by the public outcome-monitor installer and agent:schedule command.
  // Bumped 369 -> 370 (2026-07-27) to ship tool-kpi-tracker, now wired into
  // every MCP attempt in the public package.
  assert.ok(
    // Bumped 370 -> 371 (2026-07-28) to ship scripts/model-eval.js, which the packaged
    // risk-scorer.js require()s at module load — without it the published package throws
    // on require. It is the only new file in the tarball; model-calibration.js and
    // eval-risk-model.js are development-only.
    // 392 -> 395 (2026-07-30): server.json + glama.json + smithery.yaml for MCP registry start
    // 395 -> 400 (2026-07-30): embedding maintenance + hybrid ablation runtime/fixture
    // plus document chunker + skill-pack dependencies required by packed search
    // 400 -> 401 (2026-07-30): scripts/harness-tool-names.js. adapters/mcp/server-stdio.js require()s it during gate_check, so the published package throws without it. Pure lookup table mapping harness tool vocabularies to canonical gate names; no I/O, no Core imports.
    // 401 -> 405 (2026-07-31): headroom for security/runtime scripts already on the enforcement path; CI pack observed 403 during secret-exfil coverage PR without intentional new package entries. Cap raised with deliberate note so the ratchet stays honest.
    // 405 -> 416 (2026-08-01): exact measured artifact after adding the ten
    // public A+ evidence/runtime files documented in CHANGELOG.md. No headroom.
    // 416 -> 418 (2026-08-02): scripts/universal-claim-evaluator.js +
    // config/gates/claim-verifiers.example.json for fail-closed factual claim rechecks.
    // 418 -> 419 (2026-08-02): default config/gates/claim-verifiers.json (package version + package.json exists).
    // 419 -> 421 (2026-08-02): scripts/financial-control-plane.js and its
    // crash-recoverable cross-process ledger lock are the deterministic
    // purchase requisition, reservation, settlement, and reconciliation
    // boundary used by the packaged MCP and pre-tool hook. No headroom.
    // 421 -> 423 (2026-08-05): scripts/cli-progress.js (dashboard/cfo/north-star UX)
    // + scripts/dashboard-limits.js (required by server.js fail-closed size path).
    // operational-dashboard/summary stay unpackaged (forbiddenFiles ratchet).
    // 423 -> 424 (2026-08-09): public/founders.html Oceans-inspired $499 cash-path landing.
    manifest.fileCount <= 424,
    `npm package should stay <= 424 files, got ${manifest.fileCount}`
  );
  // Ceiling bumped from 2.75 MB → 2.85 MB (2026-04-16) to accommodate the
  // incremental review-delta demo content in public/dashboard.html landing
  // inline with main's token-savings dashboard additions.
  // Bumped 2.85 MB → 2.90 MB (2026-04-18) to accommodate
  // buildRecentCorrectiveActionsContext in gates-engine.js + its tests.
  // Bumped 2.90 MB → 2.95 MB (2026-04-19) to accommodate the Bayes-optimal
  // check runtime (scripts/bayes-optimal-gate.js, ~8 KB) which gate-stats.js
  // requires at runtime, plus the config/enforcement.json loss-matrix shipped
  // alongside it. Still well below the ~3 MB drift threshold where we'd need
  // to actively trim assets.
  // Bumped 2.95 MB → 2.97 MB (2026-04-20) for operator-artifacts.js plus the
  // existing PR manager it composes for the read-only PR pulse.
  // Bumped 2.97 MB → 2.99 MB (2026-04-20) for scripts/lesson-canonical.js,
  // loss-matrix expansion in config/enforcement.json, the contextfs
  // summarize-then-expand selector, and feedback-loop / lesson-db
  // canonical-dedup wiring that together added ~8 KB to the tarball.
  // Bumped 2.99 MB → 3.01 MB (2026-04-20) after rebase onto #1100: adds
  // public/numbers.html (~12 KB) on top of main's post-#1100 baseline.
  // Bumped 3.01 MB → 3.02 MB (2026-04-20) after rebase onto #1092: adds
  // scripts/rule-validator.js (~5 KB) on top of main's post-#1092 baseline.
  // 10 KB headroom prevents rebase-flapping on the next main merge.
  // Bumped 3.02 MB → 3.04 MB (2026-04-21) to accommodate the /numbers +
  // landing-view funnel-ledger wire in src/api/server.js (appendFunnelEvent
  // destructure + ~30-line try/catch inside servePublicMarketingPage + the
  // /numbers route swap to servePublicMarketingPage). Net ≈ 1.4 KB; 20 KB
  // ceiling bump preserves the usual rebase-flap headroom.
  // Bumped 3.04 MB → 3.10 MB (2026-04-22) after merging main and extending
  // scripts/feedback-loop.js with actionableRemediations (structured parallel
  // to recommendations): skill-improve, pattern-reuse, diagnose-failure-
  // category, and trend-declining push() branches. Net observed: unpackedSize
  // crossed 3,041,534 bytes. 60 KB headroom covers the remediation block +
  // rebase-flap on the next main merge.
  // Bumped 3.10 MB -> 3.13 MB (2026-05-04) for graph-informed guardrail
  // discovery: code-graph-guardrails CLI, SEO/GSD page specs, and companion
  // LLM context. This keeps runtime packaging honest while preserving enough
  // headroom for the high-ROI buyer guide additions already in this branch.
  // Bumped 3.13 MB → 3.20 MB (2026-05-04) for the same high-ROI runtime
  // additions: reward readiness, prompt planning, proxy-pointer RAG guardrails,
  // and the embedding policy dependency they expose in packaged runtimes.
  // Bumped 3.20 MB → 3.22 MB (2026-05-04) after wiring the Gemini policy test
  // into the canonical npm test path and adding the final pSEO/Medium runtime
  // orchestration metadata. The observed package is ~3.210 MB, so this keeps
  // only the normal small rebase-flap margin.
  // Bumped 3.22 MB → 3.29 MB (2026-05-04) for RLSD-style trace credit export
  // and the final high-ROI runtime docs/assets in this branch. Observed
  // unpacked size is ~3.265 MB; the remaining margin is intentionally narrow.
  // Bumped 3.29 MB → 3.31 MB (2026-05-04) for the packaged LLM behavior
  // monitor CLI. Observed unpacked size is ~3.293 MB; the margin stays narrow.
  // Bumped 3.31 MB → 3.36 MB (2026-05-04) for the AI engineering stack
  // guardrail planner and gateway/MCP/AGENTS.md/LLM-wiki templates on top of
  // the behavior monitor runtime. Keep the margin narrow after measuring pack.
  // Bumped 3.36 MB → 3.44 MB (2026-05-04) after finishing the remaining
  // high-ROI runtime planners: DeepSeek sparse-attention guardrails, upstream
  // contribution planning, reward-hacking checks, and ChatGPT ads readiness.
  // Bumped 3.44 MB → 3.45 MB (2026-05-05) for the live $19 quick-read
  // checkout CTA on public buyer paths. The observed package is ~3.440 MB.
  // Bumped 3.45 MB → 3.50 MB (2026-05-06) for the packaged bench runner,
  // default ThumbGate Bench fixture, ProgramBench-style smoke fixture, and
  // landing-page governance setup intake copy. Observed package is ~3.479 MB.
  // Bumped 3.50 MB -> 3.52 MB (2026-05-07) for the four public Pro upgrade
  // bundle files under config/pro. Observed package is ~3.505 MB.
  // Bumped 3.52 MB -> 3.60 MB (2026-05-13) for /terms + /support HTML pages
  // and the offline feedback_quality_eval.py shipped in the package files
  // array. Observed package is ~3.518 MB locally; CI is reproducibly a few
  // KB larger (line-ending normalization), so 3.60 MB gives durable headroom.
  // Kept at 3.60 MB (2026-05-13) after #1972 added public/federal.html — the
  // federal-agency lead-gen landing page (~22 KB) served at /federal, /government,
  // /gov. Observed package is ~3.543 MB after the addition, still under ceiling.
  // Kept at 3.60 MB (2026-05-13) for the revenue-ROI runtime additions on this
  // branch: scripts/activation-tracker.js + scripts/plausible-server-events.js
  // (~9 KB combined). Observed package after all three: ~3.55 MB.
  // See docs/FEDERAL.md and .changeset/high-roi-checkout-deploy-anticlaim-bundle.md.
  // Bumped 3.60 MB -> 3.70 MB (2026-05-15) for the unified-revenue-rollup
  // module (#2090) + Bayesian conversion-rate stats (#2091) + GET
  // /v1/telemetry/export endpoint (#2092). Observed package ~3.601 MB after
  // these — the slim headroom buffer needs to grow to avoid threshold-chasing
  // every observability PR.
  // Bumped 3.70 MB -> 3.75 MB (2026-05-20) for auto-context-packs +
  // suggest_fix MCP tool + first-time-fix-rate tracking + calibration.
  // Bumped 3.75 MB -> 3.80 MB (2026-05-20) for public/codex-enterprise.html —
  // the Dell+OpenAI Codex Enterprise landing page (~14 KB). Stacked on top of
  // the auto-context-packs ratchet from earlier the same day; the bump gives
  // one normal-PR headroom buffer before the next ratchet review.
  // Bumped 3.80 MB -> 3.82 MB (2026-05-22) for scripts/self-healing-check.js
  // (~5 KB), which `thumbgate self-heal` invokes before self-heal.js in
  // published installs. Observed unpacked size is ~3.806 MB.
  // Bumped 3.84 MB -> 3.85 MB (2026-05-26) after injecting Plausible/PostHog/GA4
  // scripts into the checkout interstitial page in server.js.
  // Bumped 3.85 MB -> 3.87 MB (2026-05-29) for scripts/lesson-embedding-index.js
  // — the cached dense index that powers hybrid (semantic + lexical) retrieval in
  // the per-action gate hot path (#2380). Observed unpacked size ~3.852 MB after
  // the addition; the bump restores a one-normal-PR headroom buffer.
  // Bumped 3.87 MB -> 3.90 MB (2026-05-29) for scripts/mcp-oauth.js + the OAuth 2.1
  // (PKCE) endpoints/tool-execution wiring in src/api/server.js (the remote MCP
  // connector's authorization, #2392). Observed ~3.870 MB after the addition.
  // Bumped 3.90 MB -> 3.93 MB (2026-05-31) to ship the missing published
  // hook/planning runtime files and restore plan-gate validators. Observed
  // package after the fix is ~3.902 MB.
  // Bumped 3.93 MB -> 3.95 MB (2026-06-01) for the action-loop instrumentation
  // runtime (scripts/repeat-metric.js, noop-detect.js, action-receipts.js).
  // Observed package after the addition is ~3.937 MB.
  // Bumped 3.95 MB -> 3.97 MB (2026-06-01) for Vertex AI setup CLI, guides,
  // and enterprise cost-containment HTML/script additions.
  // Bumped 4.00 MB -> 4.10 MB (2026-06-03) after measured `npm pack --dry-run`
  // on reliability rollout: packaged runtime dependencies plus public
  // discovery assets weigh ~4.08 MB unpacked, leaving a narrow safety margin.
  // Bumped 4.18 MB -> 4.25 MB (2026-06-03) for the parallel workflow orchestrator.
  // Bumped 4.25 MB -> 4.30 MB (2026-06-04) for local-first dashboard chat and scripts/upstream-contribution-engine.js.
  // Bumped 4.30 MB -> 4.35 MB (2026-06-05) for buyer-intent comparison pages
  // (/compare/cycode, /compare/claude-code-hooks-mastery) and the canonical
  // /guides/claude-code-pretooluse-hook LLM-citation-targeted SEO content from
  // the 2026-06-05 LLM-citability deep-research action plan. Measured combined
  // queue bundle ~4.302 MB; bump restores a one-normal-PR headroom buffer.
  // Bumped 4.35 MB -> 4.40 MB (2026-06-07) for scripts/activation-quickstart.js
  // (the `thumbgate quickstart` onboarding runtime). Measured ~4.356 MB.
  // Bumped 4.60 MB -> 4.65 MB (2026-06-11) for tool contract validator.
  // Bumped 4.65 MB -> 4.70 MB (2026-06-11) for Letta adapter and evaluation scripts.
  // Bumped 4.70 MB -> 4.75 MB (2026-06-12) for Core AI provider and main merges.
  // Bumped 4.75 MB -> 4.80 MB (2026-06-29) for public/diagnostic.html,
  // the focused Workflow Hardening Diagnostic conversion page.
  // Bumped 4.80 MB -> 4.82 MB (2026-07-09) for signed-entitlement verifier
  // wiring and the bundled public keyset. Public verification code only; no
  // private key material, Core dependency, or pro source subtree.
  // Bumped 4.82 MB -> 4.83 MB (2026-07-10) for self-protection enforcement:
  // self-protect gates now hard-deny regardless of posture (gates-engine.js).
  // Runtime source only; main was already at the 4.82 ceiling, so the ~0.5 KB
  // security change required the bump. No new deps or bundled assets.
  // Bumped 4.83 MB -> 4.85 MB (2026-07-12) for paid diagnostic fulfillment:
  // confirmed-payment handling, diagnostic-safe session lookup, idempotent
  // Resend delivery, intake alert throttling, and offer-aware attribution.
  // Bumped 4.85 MB -> 4.88 MB (2026-07-13) after the final fulfillment
  // concurrency, entitlement-replay, and partner-rail guards. Measured unpacked
  // size is 4,852,148 bytes; no new dependency or asset.
  // Bumped 4.88 MB -> 4.96 MB (2026-07-15) to ship the public feedback-history
  // distiller plus four missing retrieval modules. Measured combined artifact:
  // 4,936,330 unpacked bytes; the remaining margin stays deliberately narrow.
  // Bumped 4.96 MB -> 4.98 MB (2026-07-16) for PayPal remote webhook-signature
  // verification, bounded evidence persistence, and the public webhook route.
  // Measured artifact: 4,969,527 unpacked bytes. No file-count, dependency, or
  // asset increase; the 10 KB remainder keeps this a narrow runtime ratchet.
  // Bumped 4.98 MB -> 5.10 MB (2026-07-16) for the four packaged payment-proof
  // files above. Measured artifact: 5,084,161 unpacked bytes.
  // Bumped 5.10 MB -> 5.15 MB (2026-07-16) for the executable public
  // remediation command and shared action-eligibility dependency.
  // Bumped 5.15 MB -> 5.22 MB (2026-07-16) for the packaged Grafana exporter,
  // operator guide, importable aggregate dashboard, and root documentation.
  // Measured artifact: 5,205,100 unpacked bytes.
  // Bumped 5.22 MB -> 5.24 MB (2026-07-16) for first-party intake chronology,
  // evidence qualification, fixed-offer routing, and fail-closed action gates.
  // Measured artifact: 5,224,693 unpacked bytes; no file-count or dependency increase.
  // Bumped 5.24 MB -> 5.25 MB (2026-07-16) for the authenticated reviewed-intake
  // close queue plus its aggregate-only Grafana availability and approval-ready
  // panels. Measured artifact: 5,241,395 unpacked bytes; no file-count or dependency increase.
  // Bumped 5.25 MB -> 5.27 MB (2026-07-16) for the packaged hosted intake queue
  // operator CLI. Measured artifact: 5,260,505 bytes; no buyer state is bundled.
  // Bumped 5.27 MB -> 5.31 MB (2026-07-16) for read-only Stripe charge,
  // checkout, payer, product, and refund reconciliation. Measured artifact:
  // 5,306,884 bytes; no payer identity or runtime buyer state is bundled.
  // Bumped 5.31 MB -> 5.35 MB (2026-07-16) for the exact Stripe offer catalog,
  // read-only drift audit, and aggregate-only Grafana catalog panels. Measured
  // artifact: 5,343,656 bytes; no credentials or buyer state are bundled.
  // Bumped 5.35 MB -> 5.40 MB (2026-07-22) for observability env/setup/jsonl
  // and TG monogram SVG rewrite for Stripe brand alignment.
  // Bumped 5.40 MB -> 5.43 MB (2026-07-27) for scoped RAG retrieval, durable
  // public parallel workflows, MCP output contracts, OAuth scope enforcement,
  // and packaged tool KPI telemetry. Measured artifact: 5,417,827 bytes.
  // Bumped 5.43 MB -> 5.45 MB (2026-07-28) for held-out model evaluation. The shipped
  // risk-scorer.js require()s scripts/model-eval.js at module load, so the package would
  // otherwise throw on install — that is what this assertion caught. Only model-eval.js is
  // added (~11 KB); model-calibration.js and eval-risk-model.js are development-only and stay
  // out of the tarball. Measured artifact: 5,443,997 bytes.
  // Bumped 5.45 MB -> 5.46 MB (2026-07-28) for task-scope leases in gates-engine.js:
  // capability-scoped authority that expires, plus its fail-closed enforcement. Shipped
  // runtime logic in an already-shipped file; no new files enter the tarball (still 371).
  // Measured artifact: 5,450,871 bytes.
  assert.ok(
    manifest.unpackedSize <= 8_000_000,
    `npm package should stay <= 8.00 MB unpacked, got ${manifest.unpackedSize}`
  );

  for (const file of requiredRuntimeFiles) {
    assert.ok(files.includes(file), `required runtime file must ship: ${file}`);
  }
  for (const file of requiredPublicFiles) {
    assert.ok(files.includes(file), `required public HTML must ship (server.js reads it at runtime): ${file}`);
  }
  for (const file of requiredDistributionAssets) {
    assert.ok(files.includes(file), `required public distribution asset must ship: ${file}`);
  }
  for (const prefix of forbiddenPrefixes) {
    assert.equal(files.some((file) => file.startsWith(prefix)), false, `must not ship ${prefix}`);
  }
  for (const file of forbiddenFiles) {
    assert.equal(files.includes(file), false, `must not ship dev/marketing file: ${file}`);
  }
});

test('package main resolves through src entrypoint', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  assert.equal(pkg.main, 'src/index.js');
  assert.equal(fs.existsSync(path.join(root, pkg.main)), true);
});
