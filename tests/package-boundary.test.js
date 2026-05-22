const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

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

  assert.deepEqual(mcpMissing, []);
  assert.deepEqual(apiMissing, []);
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
    'scripts/gates-engine.js',
    'scripts/hf-papers.js',
    'scripts/self-healing-check.js',
    'scripts/silent-failure-cluster.js',
    'scripts/statusline.sh',
    'scripts/statusline-meta.js',
    'scripts/tool-registry.js',
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
  const forbiddenPrefixes = [
    'public/js/',
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
    'scripts/decision-trace.js',
    'scripts/sales-pipeline.js',
    'scripts/post-to-x.js',
    'scripts/post-to-x-retry.sh',
    'scripts/reddit-dm-outreach.js',
    'scripts/reddit-monitor-cron.sh',
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
    'scripts/tool-kpi-tracker.js',
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
  assert.ok(
    manifest.fileCount <= 264,
    `npm package should stay <= 264 files, got ${manifest.fileCount}`
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
  assert.ok(
    manifest.unpackedSize <= 3_820_000,
    `npm package should stay <= 3.82 MB unpacked, got ${manifest.unpackedSize}`
  );

  for (const file of requiredRuntimeFiles) {
    assert.ok(files.includes(file), `required runtime file must ship: ${file}`);
  }
  for (const file of requiredPublicFiles) {
    assert.ok(files.includes(file), `required public HTML must ship (server.js reads it at runtime): ${file}`);
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
