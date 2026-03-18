## March 17, 2026: Workflow hardening sprint intake and commercial-truth operator metrics

Scope:

- Replaced the public Workflow Hardening Sprint `mailto:` dependency with a hosted sprint-intake form on the landing page, including structured CTA tracking and success/failure handling.
- Added `scripts/workflow-sprint-intake.js` as the single owner for sprint-intake lead capture, writing contactable workflow leads to the active local feedback runtime as `workflow-sprint-leads.jsonl`.
- Added `POST /v1/intake/workflow-sprint` to the hosted API and wired the landing form to it.
- Strengthened public machine-readable positioning with `Organization`, `SoftwareApplication`, `BuyAction`, and `CommunicateAction` schema on the public landing page.
- Routed active outreach and social assets to the hosted sprint-intake path instead of stale email-first or legacy-growth messaging.
- Integrated workflow-sprint lead counts into the admin billing/CFO summary so pipeline capture is visible in the same truth surface as booked revenue, while explicitly keeping leads separate from revenue claims.
- Corrected operator scripts so `pulse.js` and `money-watcher.js` key off booked revenue and paid orders instead of unreconciled paid-stage funnel events.
- Hardened `tests/delegation-runtime.test.js` temp-dir cleanup so clean-worktree coverage runs no longer fail with transient `ENOTEMPTY` teardown errors.

Commands run in the dedicated clean verification worktree at `/tmp/rlhf-verify-first-dollar-20260317` on exact branch head `ba83de2`:

```bash
npm ci
npm test
npm run test:coverage
env RLHF_PROOF_DIR=/tmp/rlhf-verify-first-dollar-ba83de2/proof-adapters npm run prove:adapters
env RLHF_AUTOMATION_PROOF_DIR=/tmp/rlhf-verify-first-dollar-ba83de2/proof-automation npm run prove:automation
npm run self-heal:check
git status --short
```

Additional targeted GTM/commercial regressions run in the implementation worktree:

```bash
node --test tests/public-landing.test.js tests/api-server.test.js tests/workflow-hardening-sprint.test.js tests/social-marketing-assets.test.js tests/version-metadata.test.js tests/commercial-signals.test.js tests/billing.test.js tests/cli.test.js
```

Observed result:

- `npm ci` completed with `0` vulnerabilities.
- `npm test` passed end-to-end on exact branch head `ba83de2`.
- `npm run test:coverage` passed with `1108` passed, `0` failed, `1` skipped.
- All-files coverage on the verified tree: `90.18%` lines, `76.29%` branches, `93.55%` functions.
- `env RLHF_PROOF_DIR=/tmp/rlhf-verify-first-dollar-ba83de2/proof-adapters npm run prove:adapters`: `46` passed, `0` failed.
- `env RLHF_AUTOMATION_PROOF_DIR=/tmp/rlhf-verify-first-dollar-ba83de2/proof-automation npm run prove:automation`: `55` passed, `0` failed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.
- `git status --short` remained empty after the full clean-worktree suite.
- Targeted GTM/commercial regression pack passed with `98` tests passed, `0` failed.

Requirements verified:

- The public sprint offer now has a direct hosted intake path for qualified workflow demand instead of forcing an email handoff.
- Sprint-intake leads are captured as structured local runtime records and exposed in the admin billing/CFO summary without being misrepresented as revenue.
- Public positioning, outreach assets, billing truth surfaces, and operator scripts now agree on the same commercial story: Workflow Hardening Sprint for pipeline, Pro for self-serve recurring revenue.
- Clean-worktree verification is stable again after hardening the delegation test teardown.

## March 16, 2026: Databricks post-merge safety follow-up

Scope:

- Fixed the merged Databricks analytics export so its default output root now uses `getFeedbackPaths()` instead of a legacy `.claude` fallback, keeping implicit bundle writes inside the same safe data boundary used by the API and MCP adapters.
- Normalized Databricks bundle-relative paths to POSIX separators before embedding them in `manifest.json` and `load_databricks.sql`, preventing Windows-hosted exports from generating backslash-separated paths that Databricks SQL cannot read.
- Added regression coverage for:
  - default export-path selection when `.rlhf/` is present
  - API default export path behavior
  - MCP default export path behavior
  - bundle-relative path normalization

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/rlhf-databricks-followup`:

```bash
npm ci
node --test tests/databricks-export.test.js tests/api-server.test.js tests/mcp-server.test.js
npm test
npm run test:coverage
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
```

Observed result:

- `npm ci` completed with `0` vulnerabilities.
- Targeted Databricks regressions passed: `51` tests passed, `0` failed.
- `npm test` passed end-to-end on the follow-up branch after the post-merge fixes were applied.
- `npm run test:coverage` passed with `1041` tests, `1040` passed, `0` failed, `1` skipped.
- All-files coverage on the follow-up branch: `83.47%` lines, `69.70%` branches, `86.40%` functions.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `46` passed, `0` failed.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `47` passed, `0` failed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.

Requirements verified:

- The Databricks export no longer escapes the safe feedback root when no explicit `outputPath` is provided.
- The Databricks SQL bootstrap always uses forward-slash bundle-relative paths, including on Windows-originated exports.
- API and MCP default exports now inherit the same root-selection behavior as the shared RLHF feedback pipeline.

## March 16, 2026: Databricks analytics bundle export

Scope:

- Added `scripts/export-databricks-bundle.js` to export the local RLHF control plane into a Databricks-ready analytics bundle instead of coupling the runtime system to an external warehouse.
- Export now emits `feedback_events.jsonl`, `memory_records.jsonl`, `feedback_sequences.jsonl`, `feedback_attributions.jsonl`, `proof_reports.jsonl`, `manifest.json`, and a bootstrap `load_databricks.sql` template with catalog/schema placeholders.
- Added the bundle export to every primary surface:
  - CLI: `npx mcp-memory-gateway export-databricks`
  - HTTP API: `POST /v1/analytics/databricks/export`
  - MCP: `export_databricks_bundle`
- Updated policy and adapter metadata so intent planning, OpenAPI parity, and Gemini function declarations expose the new analytics-plane export consistently.
- Kept the smart-learning review fix on the same branch and verified it still passes after the Databricks export surface was added.

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/rlhf-smart-learning-fix`:

```bash
npm test
npm run test:coverage
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
```

Observed result:

- Targeted Databricks/API/MCP/OpenAPI/CLI regressions passed: `101` tests passed, `0` failed.
- `npm test` passed end-to-end on the worktree after the analytics export surface and smart-learning fix were combined.
- `npm run test:coverage` passed with `1024` tests, `1023` passed, `0` failed, `1` skipped.
- All-files coverage on the verified tree: `83.44%` lines, `69.92%` branches, `86.33%` functions.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `46` passed, `0` failed.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `43` passed, `0` failed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.

Requirements verified:

- The Databricks export is reachable and consistent across CLI, HTTP API, MCP, ChatGPT OpenAPI, and Gemini declarations.
- The bundle contains local RLHF memory, attribution, sequence, and proof-report tables without mutating the control-plane storage model.
- The generated SQL bootstrap keeps external warehouse details parameterized rather than hard-coding catalog/schema paths into the product.
- Codegraph-aware intent planning, recall, and proof flows still pass after the analytics export path was introduced.

## March 15, 2026: AgentRx-style failure diagnostics

Scope:

- Added `scripts/failure-diagnostics.js` with a narrow failure taxonomy for `invalid_invocation`, `tool_output_misread`, `intent_plan_misalignment`, `guardrail_triggered`, and `system_failure`.
- Compiled diagnosis constraints from workflow contract rules, gate policies, session constraints, approval checkpoints, and MCP tool schemas.
- Added the `diagnose_failure` MCP tool and made it profile-aware so locked/read-only profiles diagnose disallowed tool calls correctly instead of pretending the full tool catalog is available.
- Threaded diagnoses into the verification loop, self-healing health checks, dashboard aggregation, analytics, and prevention-rule generation through a shared `diagnostic-log.jsonl` path.
- Removed false-positive fallback diagnoses so vague or unsupported negative signals no longer inflate root-cause metrics.
- Updated `README.md` so the MCP tool inventory and profile counts match the shipped product surface.

Commands run in the dedicated worktree at `/Users/ganapolsky_i/workspace/git/igor/rlhf/.claude/worktrees/agent-agentrx`:

```bash
npm ci
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

Observed result:

- `npm ci` completed with `0` vulnerabilities.
- `npm test` passed end-to-end on the post-fix tree after the review-found diagnostic gaps were closed.
- `npm run test:coverage` passed with `1018` tests, `1017` passed, `0` failed, `1` skipped.
- All-files coverage on the post-fix tree: `83.43%` lines, `69.93%` branches, `86.36%` functions.
- `npm run prove:adapters`: `46` passed, `0` failed.
- `npm run prove:automation`: `43` passed, `0` failed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.

Evidence artifacts verified:

- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`

Requirements verified:

- `diagnose_failure` no longer fabricates `tool_output_misread` for vague or unclassified failures with no real evidence.
- `diagnose_failure` now respects MCP profile allowlists and emits policy-backed invalid-invocation diagnoses for disallowed tools.
- Failed verification runs persist diagnoses into the shared analytics path instead of dying inside transient return payloads.
- `self-heal:check` persists unhealthy-check diagnoses into the same shared analytics path when run via CLI.
- Dashboard and prevention-rule outputs now include persisted verification and self-heal diagnoses, not only diagnoses attached during feedback capture.
- The README tool inventory now matches the shipped MCP surface: essential profile remains `5` tools, full profile is `12` tools including `diagnose_failure`.

## March 13, 2026: PR hygiene and runtime-state cleanup

Scope:

- Removed accidental tracked `.claude/worktrees/agent-*` gitlinks from the repository index so disposable worktree lanes stop polluting `main`.
- Removed tracked live `.rlhf/*` runtime artifacts from version control and aligned `.gitignore` with the repo policy that RLHF memory/state is local operational data.
- Persisted the runtime-state hygiene rule in `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`.
- Archived unique orphan branches before deletion and removed clean redundant worktrees/branches with no active PR or verification role.

Commands run:

```bash
git fetch --all --prune
git worktree add /Users/ganapolsky_i/workspace/git/igor/rlhf-pr-hygiene-20260313 -b chore/pr-hygiene-20260313 origin/main
npm ci
env RLHF_API_KEY=ci-secret npm test
env RLHF_API_KEY=ci-secret npm run test:coverage
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation
env RLHF_PROOF_DIR="$(mktemp -d)" npm run self-heal:check
npm audit --json
git diff --check
```

Observed result:

- GitHub open PRs: `0`.
- `main` CI was already green on `bbfa45576d3ea7136e544e68662253079646feeb`.
- `npm ci` completed with `0` vulnerabilities.
- `env RLHF_API_KEY=ci-secret npm test` passed end-to-end.
- `env RLHF_API_KEY=ci-secret npm run test:coverage` passed with `971` passed, `0` failed, `1` skipped and all-files coverage at `82.59%` lines, `68.77%` branches, `85.37%` functions.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `38` passed, `0` failed.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `37` passed, `0` failed.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run self-heal:check`: `Overall: HEALTHY` with `4/4` checks healthy.
- `npm audit --json` reported `0` open vulnerabilities.
- `git diff --check` passed with no whitespace or patch-format defects.

Cleanup evidence:

- Tracked branch count: `22 -> 18`.
- Worktree count: `18 -> 7`.
- Archived before deletion:
  - `archive/20260313/chore-stripe-incident-response`
  - `archive/20260313/docs-update-product-tiers`
  - `archive/20260313/feat-deep-document-infrastructure`
  - `archive/20260313/feat-fix-verification-failures`
  - `archive/20260313/feat-free-tier-limits`
  - `archive/20260313/feat-step-feedback-export`
  - `archive/20260313/pr-190-readonly`
  - `archive/20260313/worktree-agent-a6591335`
  - `archive/20260313/worktree-agent-a7dc457b`
- Removed clean redundant worktrees/branches:
  - `chore/pr-cleanup-20260312`
  - `feat/context-hub-preflight`
  - `feat/local-provider-abstraction`
  - `worktree-agent-ade17c3c`
  - detached verification worktree `/Users/ganapolsky_i/workspace/git/igor/rlhf-techdebt-audit`
  - stale `main` worktree `/Users/ganapolsky_i/workspace/git/igor/rlhf-partner-aware-orchestration`
- Repository hygiene change size: `42` tracked runtime artifacts removed from source control, `1286` tracked lines deleted.

Requirements verified:

- Disposable worktree lanes are no longer a versioned part of the product repository.
- RLHF runtime state now matches the documented local-only operating model instead of creating tracked churn in every session.
- Unique orphan branches were preserved before deletion, while clean redundant lanes were removed outright.
- The verification suite still passes after moving runtime state out of version control.

## March 13, 2026: Technical debt audit and CI hardening

Scope:

- Fixed the free-tier gate loading regression in `scripts/gates-engine.js` so core default gates always load and free-tier capping applies only to auto-promoted add-on gates.
- Removed dead duplicate `/healthz` routing in `src/api/server.js`.
- Removed the legacy in-memory recall limiter in `adapters/mcp/server-stdio.js`, switched recall usage to the shared rate-limiter, and kept the free-tier upgrade nudge without dropping recall results.
- Hardened `tests/recall-limit.test.js` so CI-provided secrets like `RLHF_API_KEY` cannot bypass the free-tier assertions.
- Added exact feedback-memory deduplication in `scripts/contextfs.js` so repeated identical lessons no longer create duplicate ContextFS entries.
- Hardened CI to install and verify the `workers/` package, aligned Stripe worker code with the current SDK API version, and removed the repo-local `wrangler` dependency because the current npm advisories did not leave a clean vendored release line.
- Deleted six duplicate RLHF memory entries that were already storing the same lessons.

Baseline snapshot before changes:

Commands run in dedicated baseline worktree at `57a7498e42578270a2dc1421c1bfd8d06f07dded`:

```bash
git worktree add /Users/ganapolsky_i/workspace/git/igor/rlhf-audit-baseline 57a7498e42578270a2dc1421c1bfd8d06f07dded
npm ci
npm --prefix workers ci
node --test tests/contextfs.test.js tests/intent-router.test.js tests/verification-loop.test.js tests/mcp-server.test.js
npm --prefix workers audit --json
npm run test:coverage
```

Observed baseline result:

- Core RAG/orchestration snapshot passed: `57` tests passed, `0` failed across `tests/contextfs.test.js`, `tests/intent-router.test.js`, `tests/verification-loop.test.js`, and `tests/mcp-server.test.js`.
- `npm --prefix workers audit --json` reported `4` moderate vulnerabilities in the worker dependency chain (`esbuild`, `wrangler`, `miniflare`, `undici`).
- `npm run test:coverage` exited non-zero on the pre-audit tree with `957` passed, `4` failed, `1` skipped.
- Baseline coverage summary still emitted: `82.07%` lines, `68.96%` branches, `85.52%` functions.
- The failing baseline regressions were:
  - `tests/gates-engine.test.js`: protected-branch and `.env` gate expectations failed.
  - `tests/recall-limit.test.js`: sixth recall call never emitted the upgrade nudge.

Commands run on the audit branch:

```bash
npm ci
npm --prefix workers ci
npm run test:gates
node --test tests/contextfs.test.js
RLHF_API_KEY=ci-secret node --test tests/recall-limit.test.js
RLHF_API_KEY=ci-secret npm run test:api
node --test tests/mcp-server.test.js tests/api-server.test.js
RLHF_API_KEY=ci-secret npm test
RLHF_API_KEY=ci-secret npm run test:coverage
npm run test:workers
env RLHF_PROOF_DIR="$(mktemp -d)" RLHF_API_KEY=ci-secret npm run prove:adapters
env RLHF_PROOF_DIR="$(mktemp -d)" RLHF_API_KEY=ci-secret npm run prove:automation
env RLHF_PROOF_DIR="$(mktemp -d)" RLHF_API_KEY=ci-secret npm run prove:workflow-contract
env RLHF_PROOF_DIR="$(mktemp -d)" RLHF_API_KEY=ci-secret npm run prove:autoresearch
RLHF_API_KEY=ci-secret npm run self-heal:check
npm --prefix workers audit --json
wrangler deploy --dry-run
```

Observed result:

- `npm test` passed end-to-end after the audit changes.
- `npm run test:coverage` passed with `968` passed, `0` failed, `1` skipped.
- Current coverage summary on the final audit head: `82.42%` lines, `68.76%` branches, `85.10%` functions.
- `npm run test:gates`, `node --test tests/contextfs.test.js`, `RLHF_API_KEY=ci-secret node --test tests/recall-limit.test.js`, and `node --test tests/mcp-server.test.js tests/api-server.test.js` all passed.
- `RLHF_API_KEY=ci-secret npm run test:api` passed, proving the recall-limit regression is fixed under the same hosted-key environment GitHub Actions uses.
- `npm run test:workers` passed after the worker package gained a dedicated type-check test script.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `38` passed, `0` failed.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `37` passed, `0` failed.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:workflow-contract`: `6` passed, `0` failed.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:autoresearch`: `Phase 9 proof: 5 passed, 0 failed`.
- `RLHF_API_KEY=ci-secret npm run self-heal:check`: `Overall: HEALTHY` with `4/4` checks healthy.
- `npm --prefix workers ci`, `npm run test:workers`, and `npm --prefix workers audit --json` all passed with `0` vulnerabilities after removing the direct `wrangler` dependency from the repo-local worker package.
- `wrangler deploy --dry-run` passed from `workers/` via the globally installed Wrangler CLI (`4.63.0`).

Requirements verified:

- Free-tier users keep the default safety gates (`force-push`, `protected-branch-push`, `.env` edits) while still capping auto-promoted add-on gates.
- Recall requests now share the real rate-limiter state and still return useful content after the free tier is exhausted.
- Recall-limit verification no longer depends on CI secrets or shared test-state, so the free-tier upgrade nudge is exercised deterministically in GitHub Actions.
- Exact duplicate feedback-memory lessons no longer create duplicate ContextFS records, and the repository’s duplicate tracked memory entries were removed.
- The worker package is now covered by CI install and test steps instead of being outside the main pipeline.
- The worker package no longer vendors a vulnerable Wrangler release in-repo; deploys and `wrangler types` continue to use the globally installed CLI already required by `workers/README.md`.

## March 13, 2026: Partner-aware orchestration MVP

Scope:

- Added `config/partner-routing.json` and `scripts/partner-orchestration.js` to define reusable partner profiles, aliases, token-budget rules, and reward coefficients.
- Threaded optional `partnerProfile` through the HTTP API, MCP adapter, and OpenAPI surfaces so intent planning can return a partner-specific strategy summary.
- Updated the intent router and verification loop to adapt action ranking, token budgets, retry behavior, and Thompson updates for `partner_<profile>` reliability learning.
- Extended the automation proof harness and regression suite to verify partner-aware planning and emitted strategy metadata.

Commands run:

```bash
npm ci
node --test tests/intent-router.test.js tests/verification-loop.test.js tests/thompson-sampling.test.js tests/async-job-runner.test.js
node --test tests/api-server.test.js tests/mcp-server.test.js tests/prove-automation.test.js
npm test
npm run test:coverage
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation
env RLHF_PROOF_DIR="$(mktemp -d)" npm run self-heal:check
```

Observed result:

- Both targeted regression commands passed with `0` failures across partner orchestration, API, MCP, and automation-proof coverage.
- `npm test` passed end-to-end after adding partner-aware orchestration.
- `npm run test:coverage` passed with all-files coverage at `82.52%` lines, `68.69%` branches, and `85.19%` functions.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `38` passed, `0` failed.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `37` passed, `0` failed.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run self-heal:check`: `Overall: HEALTHY` with `4/4` checks healthy.

Evidence artifacts:

- Targeted `node --test` output covering `tests/intent-router.test.js`, `tests/verification-loop.test.js`, `tests/thompson-sampling.test.js`, `tests/async-job-runner.test.js`, `tests/api-server.test.js`, `tests/mcp-server.test.js`, and `tests/prove-automation.test.js`.
- Ephemeral adapter and automation proof reports emitted under temporary `RLHF_PROOF_DIR` directories so verification did not leave tracked proof churn in the repository.

Requirements verified:

- `partnerProfile` is accepted by the public API and MCP `plan_intent` and `list_intents` surfaces and reaches the runtime planner.
- Intent plans now emit partner strategy metadata and adapt token budgets plus action ranking for strict, fast, silent-blocker, tool-limited, and balanced counterparts.
- Verification updates now learn partner-specific reliability in Thompson sampling under `partner_<profile>` categories without weakening the existing hard gate model.
- The automation proof harness now checks for `intent.partner_strategy`, so the new orchestration behavior is covered by proof, not only by unit tests.

## March 12, 2026: Commercial truth correction

Scope:

- Replaced stale `$5/mo` and `$10/mo` self-serve subscription language on live-facing surfaces with the actual public offer: Pro (`$29/mo`).
- Removed unsupported scarcity and adoption framing from CLI and landing-page copy.
- Added `docs/COMMERCIAL_TRUTH.md` as the source of truth for pricing, traction, and proof claims.

Commands run:

```bash
node --test tests/version-metadata.test.js tests/api-server.test.js tests/cli.test.js
```

Requirements verified:

- Live-facing copy no longer presents a public recurring subscription as the current self-serve offer.
- Live-facing copy no longer treats repo metrics or hardcoded scarcity as customer proof.
- Pricing and traction claims now point back to a single source of truth.

## March 12, 2026: CFO billing summary control plane

Scope:

- Added a shared operational billing summary in `scripts/billing.js` that merges the funnel ledger with the local key store.
- Added admin-only `GET /v1/billing/summary` plus the repo-local `node bin/cli.js cfo` command so API, CLI, watcher, and strategist surfaces share the same summary shape.
- Replaced fake paid-line revenue guessing in operator scripts with the new billing summary proxy.

Commands run:

```bash
node --test tests/billing.test.js tests/api-server.test.js tests/cli.test.js tests/openapi-parity.test.js
npm test
npm run test:coverage
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation
env RLHF_PROOF_DIR="$(mktemp -d)" npm run self-heal:check
```

Observed result:

- Targeted regression coverage passed: `63` tests passed, `0` failed across billing, API server, CLI, and OpenAPI parity.
- `npm test` passed end-to-end after adding the CFO control plane.
- `npm run test:coverage` passed with all-files coverage at `82.18%` lines, `68.13%` branches, and `84.90%` functions.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `38` passed, `0` failed.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `35` passed, `0` failed.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run self-heal:check`: `Overall: HEALTHY` with `4/4` checks healthy.

Evidence artifacts:

- Command output from the targeted regression run is the primary proof for the new CFO control plane.
- Ephemeral `RLHF_PROOF_DIR` directories were used for adapter and automation proof runs to avoid tracked proof churn.

Requirements verified:

- Billing funnel telemetry, active keys, disabled keys, customer usage, and source attribution now resolve from one shared summary shape instead of ad hoc paid-line counting.
- `GET /v1/billing/summary` is admin-only and rejects provisioned billing keys.
- `node bin/cli.js cfo` returns the same machine-readable summary shape as the API surface, while reading the local ledger and key store in the current checkout.
- This surface is an operational billing proxy with ledger-backed `bookedRevenueCents` for providers that emit known amounts; it still does not claim invoice truth.

## March 12, 2026: Revenue Sprint & Conversion Optimization (historical, superseded)

Status:

- Historical pricing experiment notes only.
- Superseded by `docs/COMMERCIAL_TRUTH.md` for current public pricing and proof language.

Scope:

- Version sync across `package.json`, `mcpize.yaml`, and `server.json` to `v0.7.1`.
- Historical pricing experiment: tested a "Founding Member $5/mo" offer and urgency hooks before the current commercial-truth correction.
- Discovery optimization: Added high-ROI GitHub topics and updated `SKILL.md` auto-indexing keywords.
- Launch content package: Created `docs/marketing/LAUNCH_CONTENT.md` with Reddit, HN, and Discord assets.
- CLI `pro` command was, at that time, updated to reflect the same historical pricing experiment.

Commands run:

```bash
npm test
npm run test:proof
npm run test:coverage
npm run prove:adapters
npm run prove:automation
node bin/cli.js help
node bin/cli.js stats
gh repo view --json repositoryTopics
```

Observed results:

- `npm test`: 100% pass across all 329 tests.
- `npm run test:proof`: all proof gates PASS.
- `npm run prove:adapters`: `{ "passed": 24, "failed": 0 }`.
- `node bin/cli.js stats`: Successfully triggered **Revenue-at-Risk** analyzer showing operational loss metrics.
- `gh repo view`: Verified topics including `agentic-feedback-studio`, `veto-layer`, and `zero-config`.

Evidence artifacts:

- `public/index.html` points checkout and fallback flow at the canonical Railway hosted app.
- `docs/marketing/LAUNCH_CONTENT.md` exists and contains high-intent hooks.
- `SKILL.md` updated with `agent-memory` and `claude-code` keywords.

Requirements verified:

- Pricing and fallback routing align with the current hosted billing funnel.
- Repository is optimized for auto-discovery by AI search and MCP directories.
- Technical integrity is maintained with a 100% test pass rate.

## March 10, 2026: Main CI Railway deploy gate hardening on final hotfix diff

Commands:

```bash
node --test tests/deployment.test.js
npm test
npm run test:coverage
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation
env RLHF_PROOF_DIR="$(mktemp -d)" npm run self-heal:check
```

Observed result:

- Targeted deployment verification passed: `9` tests passed, `0` failed in `tests/deployment.test.js`.
- `npm test` passed end-to-end on the narrowed hotfix diff with only the Railway deploy regression coverage added.
- `npm run test:coverage` passed with overall coverage at `82.97%` lines, `69.36%` branches, and `86.81%` functions.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `24 passed`, `0 failed`.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `14 passed`, `0 failed`.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run self-heal:check`: `HEALTHY` with `4/4` checks healthy.

Evidence artifacts:

- Focused deployment regression output from `node --test tests/deployment.test.js`.
- Ephemeral machine-readable proof reports emitted under temporary `RLHF_PROOF_DIR` directories during the adapter and automation proof runs.

Requirements verified:

- The CI deploy workflow now refuses to enter the Railway deploy path unless explicit repo configuration is present for token, project, environment, and health-check inputs.
- The workflow no longer depends on the previously hard-coded Cloud Run health URL when validating a Railway deploy.
- The hotfix is scoped to deploy-gate behavior plus regression coverage; no unrelated runtime or proof harness changes were required to keep the branch green.

## March 10, 2026: CLI and adapter proof handshake hardening under full-suite load

Commands:

```bash
node --test --experimental-test-coverage --test-concurrency=1 tests/cli.test.js
node --test --test-concurrency=1 tests/prove-adapters.test.js
npm test
npm run test:coverage
npm run prove:adapters
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
```

Observed result:

- Targeted CLI coverage verification passed: `22` tests passed, `0` failed in `tests/cli.test.js`.
- Targeted adapter proof verification passed: `38` tests passed, `0` failed in `tests/prove-adapters.test.js`.
- `npm test` passed end-to-end after hardening the subprocess handshake budget used by the CLI and adapter proof harnesses.
- `npm run test:coverage` passed with `720` tests passed, `0` failed, and `1` skipped.
- Coverage summary: `83.17%` lines, `69.34%` branches, `86.86%` functions.
- `npm run prove:adapters`: `24 passed`, `0 failed`.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `14 passed`, `0 failed`.
- `npm run self-heal:check`: `HEALTHY` with `4/4` checks healthy.

Evidence artifacts:

- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`

Requirements verified:

- The CLI `serve` handshake test no longer flakes under full-suite coverage because the helper tolerates realistic subprocess startup latency and surfaces child process spawn errors explicitly.
- The adapter proof harness no longer times out its MCP stdio checks under heavy test load because its subprocess handshake budget matches observed startup behavior.
- Fatal adapter-proof errors now identify the exact MCP or adapter stage that failed instead of attributing late-stage transport failures to the preceding API step.

## March 10, 2026: MCP launcher hardening and proof-cleanup reliability

Commands:

```bash
npm ci
node --test tests/adapters.test.js tests/install-mcp.test.js tests/cli.test.js
node --test tests/prove-adapters.test.js tests/prove-lancedb.test.js
npm test
npm run prove:adapters
npm run prove:automation
node scripts/prove-lancedb.js
npm run self-heal:check
npm run test:coverage
```

Observed result:

- `npm ci` completed successfully with `0 vulnerabilities`.
- Targeted launcher verification passed: `39` tests passed, `0` failed across `tests/adapters.test.js`, `tests/install-mcp.test.js`, and `tests/cli.test.js`.
- Targeted proof cleanup verification passed: `39` tests passed, `0` failed across `tests/prove-adapters.test.js` and `tests/prove-lancedb.test.js`.
- `npm test` passed end-to-end after hardening MCP launcher generation and retry-based cleanup in the proof scripts.
- `npm run prove:adapters`: `24 passed`, `0 failed`.
- `npm run prove:automation`: `14 passed`, `0 failed`.
- `node scripts/prove-lancedb.js`: `5 passed`, `0 failed`, `0 warned`.
- `npm run self-heal:check`: `HEALTHY` with `4/4` checks healthy.
- `npm run test:coverage` passed with overall coverage at `83.16%` lines, `69.30%` branches, and `86.86%` functions (`719` passed, `0` failed, `1` skipped).

Evidence artifacts:

- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`
- `proof/lancedb-report.json`
- `proof/lancedb-report.md`

Requirements verified:

- Source checkouts now install canonical MCP entries that launch the local stdio server directly via `node adapters/mcp/server-stdio.js`.
- Portable docs and adapter examples now use the version-pinned launcher `npx -y mcp-memory-gateway@0.7.1 serve` instead of an unpinned `npx` call that can be shadowed by stale local installs.
- Re-running the MCP installer upgrades stale config entries instead of treating them as already configured.
- Adapter and LanceDB proof cleanup now uses retry-capable recursive removal so ephemeral filesystem contention no longer flakes CI.
- Transient `.rlhf` reminder/A2UI/test-run files are now ignored as local runtime state and do not pollute git hygiene during verification.

## March 10, 2026: Value-led GTM surfaces and hermetic ADK coverage

Commands:

```bash
npm ci
node --test tests/api-server.test.js tests/version-metadata.test.js
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

Observed result:

- `npm ci` completed successfully with `0 vulnerabilities`.
- Targeted landing-page verification passed: `25` tests passed, `0` failed across `tests/api-server.test.js` and `tests/version-metadata.test.js`.
- `npm test` passed end-to-end after the public messaging and GTM doc changes.
- `npm run test:coverage` passed with a serialized Node test runner (`--test-concurrency=1`) so suites that rewrite `process.env` do not race each other during coverage.
- The ADK consolidation path stayed hermetic under test:
  - first-run anchor-only consolidation no longer exits early
  - `ADK_FAKE_CONSOLIDATION=true` is honored only under `NODE_ENV=test`
  - the anchor-memory test opts into deterministic consolidation instead of a live Gemini path
- Coverage summary: `83.20%` lines, `69.28%` branches, `86.78%` functions.
- `npm run prove:adapters`: `24 passed`, `0 failed`.
- `npm run prove:automation`: `14 passed`, `0 failed`.
- `npm run self-heal:check`: `HEALTHY` with `4/4` checks healthy.

Evidence artifacts:

- Targeted landing/API verification was exercised directly by the commands above.
- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`

The command output above is the primary evidence for this run. The tracked proof artifacts listed here were refreshed locally by the proof commands and serve as machine-readable corroboration.

Requirements verified:

- Public-facing GTM surfaces now lead with one workflow outcome instead of generic agent infrastructure.
- The landing page preserves `SoftwareApplication` and `FAQPage` JSON-LD while adding buyer-facing FAQ and comparison content.
- The GTM plan link referenced by the landing page now resolves to `docs/GO_TO_MARKET_REVENUE_WEDGE_2026-03.md`.
- The ADK consolidator and spike/anchor coverage path is deterministic again and no longer blocks the proof gate.

## March 9, 2026: Symphony workflow contract and hermetic coverage

Commands:

```bash
npm ci
npm test
npm run test:coverage
npm run prove:workflow-contract
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

Observed result:

- Clean install completed with `0 vulnerabilities`.
- `npm test` passed end-to-end, including the new `test:workflow` contract gate.
- `npm run test:coverage` passed after hardening `tests/adk-consolidator.test.js` to use explicit deterministic consolidation in test mode instead of relying on a live Gemini key.
- Coverage summary: `83.39%` lines, `67.58%` branches, `86.63%` functions.
- `npm run prove:workflow-contract`: `4 passed`, `0 failed`.
- `npm run prove:adapters`: `21 passed`, `0 failed`.
- `npm run prove:automation`: `14 passed`, `0 failed`.
- `npm run self-heal:check`: `HEALTHY` with `4/4` checks healthy.

Evidence artifacts:

- `proof/workflow-contract/report.json`
- `proof/workflow-contract/report.md`
- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`

Requirements verified:

- Repo-owned `WORKFLOW.md` contract exists and encodes scope, hard stops, proof commands, and done criteria.
- Agent intake is bounded by `.github/ISSUE_TEMPLATE/ready-for-agent.yml`.
- PR handoff now requires proof-first structure via `.github/pull_request_template.md`.
- CI runs machine validation for the workflow contract and uploads workflow-proof artifacts.

## Phase 6: Feedback Attribution

- Proof report: `proof/attribution-report.md`
- Machine evidence: `proof/attribution-report.json`
- Requirements: ATTR-01 (recordAction + attributeFeedback), ATTR-02 (pre-tool guard), ATTR-03 (test coverage)

## Phase 5 RLAIF and DPO Optimization proof

Command:

```bash
node scripts/prove-rlaif.js
```

Observed result:

- Summary: `4 passed`, `0 failed`
- Evidence artifacts:
  - `proof/rlaif-report.json`
  - `proof/rlaif-report.md`
- Requirements verified:
  - DPO-01: selfAudit() returns score float in [0,1] with 6 constraints; selfAuditAndLog() writes self-score-log.jsonl
  - DPO-02: dpoOptimizer.run() writes dpo-model.json with generated + pairs_processed fields
  - DPO-03: extractMetaPolicyRules() extracts rules from seeded negative entries; meta-policy-rules.json written
  - DPO-04: node --test all 3 RLAIF test files: 24 passing tests, 0 failures; delta from Phase 4 baseline (93): +24 RLAIF tests = 117 total



## Automated test suite

Command:

```bash
npm test
```

Result summary:

- `test:schema`: 7 passed, 0 failed
- `test:loop`: 10 passed, 0 failed
- `test:dpo`: 6 passed, 0 failed
- `test:api`: 52 passed, 0 failed
- `test:proof`: 2 passed, 0 failed

## Adapter compatibility proof harness

Command:

```bash
npm run prove:adapters
```

Observed result:

- Summary: `21 passed`, `0 failed`
- Evidence artifacts:
  - `proof/compatibility/report.json`
  - `proof/compatibility/report.md`
- Verified checks include:
  - API auth and feedback/context/intents routes
  - Rubric-based gating for positive feedback (`422` when guardrails/disagreement fail)
  - Rubric-aware context evaluation payloads
  - API auth config hardening (`RLHF_API_KEY` required unless insecure mode enabled)
  - Context namespace traversal rejection on API + MCP surfaces
  - Intent router checkpoint flow (`checkpoint_required` for unapproved high-risk intents)
  - MCP initialize/list/call flow (including `plan_intent` and rubric-gated `capture_feedback`)
  - MCP locked-profile write denial
  - OpenAPI parity for ChatGPT adapter
  - Gemini declaration validity
  - Subagent profile and MCP policy consistency

## Automation proof harness

Command:

```bash
npm run prove:automation
```

Observed result:

- Summary: `14 passed`, `0 failed`
- Evidence artifacts:
  - `proof/automation/report.json`
  - `proof/automation/report.md`
- Verified checks include:
  - rubric-pass positive promotion
  - rubric-gated positive rejection for guardrail/disagreement violations
  - rubric failure dimensions in prevention rules
  - rubric metadata in DPO output
  - API + MCP rubric gate behavior
  - intent checkpoint enforcement
  - rubric-aware context evaluation
  - semantic-cache hit behavior for similar context queries
  - self-healing helper execution health checks

## Self-healing automation verification

Commands:

```bash
npm run self-heal:check
node scripts/self-healing-check.js --json > proof/automation/self-healing-health.json
node scripts/self-heal.js --reason=manual > proof/automation/self-heal-run.json
```

Observed result:

- Health status: `healthy` (4/4 checks healthy: budget, tests, adapter proof, automation proof)
- Self-heal execution: `healthy: true`, no failing fix steps
- Evidence artifacts:
  - `proof/automation/self-healing-health.json`
  - `proof/automation/self-heal-run.json`

## API smoke verification

Command sequence:

- Start API with `RLHF_API_KEY=test-key` on port `8791`
- `GET /healthz` with bearer token
- `GET /v1/feedback/stats` without token (expect 401)
- `POST /v1/feedback/capture` with valid payload
- `GET /v1/feedback/summary`

Observed results:

- Health endpoint responded with status `ok`
- Unauthorized stats call returned `401`
- Capture endpoint returned `accepted: true` and produced memory record
- Summary endpoint returned markdown summary payload

## Security regression checks

- Unauthorized API request returns `401` (default auth required).
- API initialization fails fast if `RLHF_API_KEY` is missing and insecure mode is not explicitly enabled.
- API rejects external output paths outside feedback root.
- MCP `prevention_rules` blocks external `outputPath`.
- MCP `export_dpo_pairs` blocks external `memoryLogPath`.
- MCP allowlists enforce profile-scoped tool access (`default`, `readonly`, `locked`).
- Rubric anti-hacking gate blocks unsafe positive memory promotion when guardrails fail or judges disagree.

## Autonomous GitOps verification

GitHub API checks:

- `allow_auto_merge: true`
- `delete_branch_on_merge: true`
- `main` branch protection retains:
  - required approvals: `1`
  - required check contexts: `["test"]`
  - required linear history: `true`
  - required conversation resolution: `true`

Workflow syntax validation command:

```bash
for f in .github/workflows/*.yml; do ruby -e 'require "yaml"; YAML.load_file(ARGV[0]); puts "OK #{ARGV[0]}"' "$f"; done
```

Observed result:

- All workflow files parsed successfully (`OK` for each).

## Budget status

Command:

```bash
npm run budget:status
```

Observed result:

- Month: `2026-03`
- Tracked spend: `0`
- Budget: `10`
- Remaining: `10`

## PaperBanana verification

Command:

```bash
npm run diagrams:paperbanana
```

Observed blocker:

- PaperBanana call reached Gemini endpoint and failed with `400 INVALID_ARGUMENT` (`API_KEY_INVALID`).
- This proves integration path is wired, but the provided key is not currently valid for generation.

Current status:

- Diagram pipeline is implemented and budget-guarded.
- Final diagram artifacts require a valid Gemini/Google API key.
- Failed generation attempts do not increase budget ledger spend.

## 2026-03-06 MCP startup hardening verification

Scope:

- Added MCP stdio transport compatibility for both `Content-Length` framed JSON-RPC and newline-delimited JSON requests.
- Fixed CLI `serve` bootstrap to explicitly start the stdio listener when loaded via `require()`.
- Removed duplicate/dead `serve` switch branch collision with `start-api`.
- Hardened proof/test reliability for external Subway repo discovery and proof test determinism.

Commands run:

```bash
node --test tests/cli.test.js tests/prove-adapters.test.js
npm run test:proof
npm test
npm run prove:adapters
npm run prove:automation
```

Observed results:

- `tests/cli.test.js`: pass (includes framed + newline `initialize` handshake coverage)
- `tests/prove-adapters.test.js`: pass with adapter proof checks increased to `>=21`
- `npm run test:proof`: pass (`75` pass, `0` fail)
- `npm test`: pass (all scripted test phases complete)
- `npm run prove:adapters`: `{ "passed": 21, "failed": 0 }`
- `npm run prove:automation`: `{ "passed": 14, "failed": 0 }`

Artifacts updated:

- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`

## 2026-03-17 Workflow Hardening Sprint Revenue-Motion Verification

Scope:

- Tightened the landing page around the Workflow Hardening Sprint as the front-line commercial motion.
- Added a current sprint brief for one workflow, one owner, and one proof review.
- Aligned README, pitch, Anthropic partner strategy, outreach targets, cold outreach, LinkedIn, Reddit, and X assets to the same workflow-hardening story.
- Added regression coverage so the public and sales surfaces do not drift back to generic AI-employee or infrastructure-first language.

Commands run:

```bash
npm ci
node --test tests/public-landing.test.js tests/api-server.test.js tests/social-marketing-assets.test.js tests/version-metadata.test.js tests/anthropic-partner-strategy.test.js tests/workflow-hardening-sprint.test.js
npm test
npm run test:coverage
RLHF_PROOF_DIR=/tmp/rlhf-workflow-hardening-20260317T133407/proof/compatibility npm run prove:adapters
RLHF_AUTOMATION_PROOF_DIR=/tmp/rlhf-workflow-hardening-20260317T133407/proof/automation npm run prove:automation
npm run self-heal:check
```

Observed results:

- Targeted GTM regression suite: `58` pass, `0` fail.
- `npm test`: pass.
- `npm run test:coverage`: pass with Node test runner coverage summary:
  - line coverage: `84.39%`
  - branch coverage: `70.73%`
  - function coverage: `87.26%`
- `npm run prove:adapters`: pass with `46` passed, `0` failed.
- `npm run prove:automation`: pass with `55` passed, `0` failed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.
- Proof artifacts for adapter and automation verification were redirected to `/tmp/rlhf-workflow-hardening-20260317T133407/proof` so the clean worktree did not churn tracked `proof/` artifacts.

Behavioral proof points:

- `public/index.html` now sells the Workflow Hardening Sprint first, keeps Pro truthful and secondary, exposes a proof CTA, and adds Sprint FAQ/schema support without fake partner claims.
- `docs/WORKFLOW_HARDENING_SPRINT.md` now defines the actual service offer, qualification rules, deliverables, contact path, and proof-pack requirement.
- `docs/PITCH.md`, `docs/ANTHROPIC_MARKETPLACE_STRATEGY.md`, `docs/OUTREACH_TARGETS.md`, and `docs/marketing/cold-outreach-sequence.md` now align on the same 30-day revenue motion: founder-led outbound, one workflow, one owner, one proof review.
- `docs/marketing/social-posts.md`, `docs/marketing/linkedin-ai-reliability-post.md`, `docs/marketing/reddit-posts.md`, and `docs/marketing/x-launch-thread.md` now frame the product as workflow hardening instead of generic AI-employee hype.
- `tests/public-landing.test.js`, `tests/api-server.test.js`, `tests/social-marketing-assets.test.js`, `tests/version-metadata.test.js`, `tests/anthropic-partner-strategy.test.js`, and `tests/workflow-hardening-sprint.test.js` now guard the new commercial story against future drift.

Artifacts updated:

- `README.md`
- `docs/WORKFLOW_HARDENING_SPRINT.md`
- `docs/PITCH.md`
- `docs/ANTHROPIC_MARKETPLACE_STRATEGY.md`
- `docs/OUTREACH_TARGETS.md`
- `docs/marketing/cold-outreach-sequence.md`
- `docs/marketing/social-posts.md`
- `docs/marketing/linkedin-ai-reliability-post.md`
- `docs/marketing/reddit-posts.md`
- `docs/marketing/x-launch-thread.md`
- `public/index.html`

## 2026-03-17 Self-Heal Proof Isolation Verification

Scope:

- Fixed `scripts/self-healing-check.js` so proof-bearing health checks run with an isolated temporary `RLHF_PROOF_DIR`.
- Prevented `self-heal:check` from failing on clean merge commits due to shared tracked `proof/` artifacts instead of real behavioral regressions.
- Added regression coverage to prove the health checker both injects and cleans temporary proof directories.

Commands run:

```bash
git diff --check
node --test tests/self-healing-check.test.js
npm ci
npm test
npm run test:coverage
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
```

Observed results:

- `git diff --check`: completed cleanly.
- `node --test tests/self-healing-check.test.js`: `14` passed, `0` failed.
- `npm ci`: completed successfully; `audited 151 packages` and `found 0 vulnerabilities`.
- `npm test`: passed.
- `npm run test:coverage`: `1100` tests, `1099` passed, `0` failed, `1` skipped; coverage `84.40%` lines, `70.77%` branches, `87.18%` functions.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `46` passed, `0` failed.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `55` passed, `0` failed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.

Behavioral proof points:

- `DEFAULT_CHECKS` now marks both `prove_adapters` and `prove_automation` for proof-directory isolation.
- `collectHealthReport` provisions a temp `RLHF_PROOF_DIR` per proof check and removes it after execution.
- The repaired `self-heal:check` now stays healthy under the same heavy `tests + prove_*` workload that failed on merge commit `9b5f5a1`.

Artifacts updated:

- `docs/VERIFICATION_EVIDENCE.md`

## 2026-03-17 Growth Observability + Tracking Readiness Verification

Scope:

- Tighten the public category from generic memory phrasing to an AI reliability system for one sharp agent.
- Add optional GA4 and Google Search Console support alongside the existing Plausible + first-party telemetry stack.
- Auto-record SEO landing views from organic and AI-search referrers.
- Surface instrumentation readiness directly in the dashboard so traffic, funnel, revenue, and attribution gaps are explicit.

Commands run in the implementation worktree:

```bash
npm ci
npm test
npm run test:coverage
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
```

Observed results:

- `npm ci`: passed, `150` packages installed, `0` vulnerabilities.
- `npm test`: passed on `feat/growth-observability`.
- `npm run test:coverage`: passed with overall coverage `84.37%` lines / `70.58%` branches / `87.17%` functions.
- `npm run prove:adapters`: passed, `46/46`.
- `npm run prove:automation`: passed, `55/55`.
- `npm run self-heal:check`: `Overall: HEALTHY`, `4/4` healthy.
- `git diff --check`: clean before commit.

Behavioral proof points:

- The landing page keeps Plausible and first-party telemetry, and now injects GA4 and Search Console only when explicit env vars are set.
- Search and AI-search referrers now produce `seo_landing_view` telemetry instead of hiding in generic landing-page traffic.
- The dashboard now reports whether traffic analytics, SEO verification, buyer-loss capture, and revenue attribution are configured and actually receiving events.
- Public and active product copy now lead with AI reliability without orchestration tax instead of drifting back toward generic memory-layer framing.

## 2026-03-17 Claude Workflow Hardening GTM Verification

Scope:

- Repositioned the public landing page around Claude workflow hardening, code modernization, and consultancy/platform-team use cases while keeping the no-orchestration-tax core message intact.
- Added a proof-forward hero CTA and explicit proof-pack link to `VERIFICATION_EVIDENCE.md`.
- Rewrote `docs/ANTHROPIC_MARKETPLACE_STRATEGY.md` as the current Anthropic partner strategy for Claude workflow hardening with packaged offers, buyer story, proof-pack rules, and claim hygiene.
- Updated `docs/marketing/x-launch-thread.md` to a role-based workflow-hardening thread aligned with the public landing message.
- Added regression coverage for the new partner strategy, landing copy, API root rendering, social-marketing messaging, and version-metadata expectations.

Commands run:

```bash
npm ci
node --test tests/public-landing.test.js tests/api-server.test.js tests/anthropic-partner-strategy.test.js
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

Observed results:

- Targeted partner/landing/API tests: pass (`43` pass, `0` fail).
- `npm test`: pass.
- `npm run test:coverage`: pass with overall coverage:
  - line coverage: `84.35%`
  - branch coverage: `70.74%`
  - function coverage: `87.14%`
- `npm run prove:adapters`: pass with `46` pass, `0` fail.
- `npm run prove:automation`: pass with `55` pass, `0` fail.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.

Behavioral proof points:

- `public/index.html` now sells the product as Claude workflow hardening with seven concrete buyer/use-case cards, three packaged offers, and a proof-pack CTA instead of generic continuity-only framing.
- `public/index.html` preserves `SoftwareApplication` and `FAQPage` JSON-LD while adding consultancy/code-modernization FAQ coverage and keeping the no-orchestration-tax contract intact.
- `docs/ANTHROPIC_MARKETPLACE_STRATEGY.md` is now a current-state partner strategy doc, not a stale historical note, and explicitly forbids false partner-membership claims while linking commercial truth and proof.
- `docs/marketing/x-launch-thread.md` now aligns the social message with workflow hardening and code modernization instead of generic "AI employee" hype.
- `tests/public-landing.test.js`, `tests/api-server.test.js`, `tests/anthropic-partner-strategy.test.js`, `tests/social-marketing-assets.test.js`, and `tests/version-metadata.test.js` enforce the new GTM messaging and claim-hygiene contracts.
## 2026-03-17 AI Reliability Social Asset Verification

Scope:

- Repositioned the active social launch copy from a generic memory tool toward an AI reliability system for coding agents.
- Added a canonical operator kit for LinkedIn, X, and Reddit under `docs/marketing/`.
- Added local/private SVG source assets for a six-slide LinkedIn carousel and an X summary card under `docs/marketing/assets/`.
- Added a regression test to keep the new positioning and asset inventory from drifting.

Commands run:

```bash
node --test tests/social-marketing-assets.test.js
npm run test:workflow
git diff --check
```

Observed results:

- `tests/social-marketing-assets.test.js`: pass
- `npm run test:workflow`: pass
- `git diff --check`: clean

Behavioral proof points:

- `docs/marketing/social-posts.md` is now the canonical social launch kit and points to current LinkedIn, X, and Reddit assets instead of older memory-first launch copy.
- `docs/marketing/linkedin-ai-reliability-post.md` contains the current long-form founder post plus the six-slide carousel script and first-comment CTA.
- `docs/marketing/x-launch-thread.md` contains the current nine-post thread focused on reliability, not just memory.
- `docs/marketing/reddit-posts.md` contains the current `r/ClaudeCode` post plus a showcase-safe `r/ClaudeAI` variant.
- `docs/marketing/assets/` contains local/private export-ready SVG assets for LinkedIn and X, avoiding shared-workspace dependency for final posting assets.

## 2026-03-17 Reliability-Without-Orchestration Positioning Verification

Scope:

- Repositioned the public landing page and package metadata around reliability without orchestration or subagent handoff overhead.
- Added explicit FAQ and hero copy that keeps one sharp agent as the primary product story.
- Tightened the continuity guide so it clearly frames the Gateway as the downstream reliability layer, not another planner or swarm.
- Added a positioning contract test so README, package metadata, guide copy, and landing-page assertions cannot drift back to generic memory-layer messaging.

Commands run:

```bash
node --test tests/public-landing.test.js tests/positioning-contract.test.js
npm test
npm run test:coverage
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
npm run test:workflow
git diff --check
```

Observed results:

- `tests/public-landing.test.js`: pass
- `tests/positioning-contract.test.js`: pass
- `npm test`: pass
- `npm run test:coverage`: pass
  - `1094` tests, `1093` passed, `0` failed, `1` skipped
  - coverage `84.39%` lines, `70.80%` branches, `87.14%` functions
- `npm run prove:adapters`: pass, `46/46`
- `npm run prove:automation`: pass, `55/55`
- `npm run self-heal:check`: `Overall: HEALTHY`, `4/4 healthy`
- `npm run test:workflow`: pass
- `git diff --check`: clean

Behavioral proof points:

- `public/index.html` now promises `Keep one sharp agent` and explicitly says the Gateway works without another orchestration layer or subagent handoff tax.
- `public/index.html` FAQ now answers whether subagents or orchestration are required and states that the product is meant to keep one sharp agent on task.
- `README.md` now leads with `Local-first reliability layer for AI coding agents` instead of generic context-and-memory phrasing.
- `package.json` now carries reliability-over-orchestration positioning into npm and marketplace metadata.
- `docs/guides/continuity-tools-integration.md` now documents the recommended split: continuity upstream, one base agent doing the work, Gateway downstream as the reliability layer.
- `docs/marketing/LAUNCH_CONTENT.md` now aligns older launch variants with the reliability-without-orchestration story instead of stale persistent-memory-first copy.
- `tests/positioning-contract.test.js` now guards the launch-content variants as well, so active GTM docs cannot silently drift back to memory-layer messaging.

## March 17, 2026: Cursor Marketplace packaging

Scope:

- Added a repo-root Cursor marketplace manifest at `.cursor-plugin/marketplace.json`.
- Added a dedicated Cursor plugin bundle in `plugins/cursor-marketplace/` with `.cursor-plugin/plugin.json`, `.mcp.json`, README, and committed logo asset.
- Switched the Cursor launcher to the portable published package entrypoint `npx -y mcp-memory-gateway@0.7.1 serve` instead of any checkout-local absolute path.
- Removed the stale `.mcp.json.plugin` legacy config file so the repo has one canonical Cursor packaging path.
- Extended `scripts/sync-version.js` so Cursor manifests and all pinned launcher docs stay version-synced on future releases.
- Added regression coverage for the repo-level marketplace contract, manifest/version consistency, and MCP launcher safety.

Commands run in the dedicated worktree at `/private/tmp/rlhf-cursor-marketplace-20260317T074440Z`:

```bash
npm ci
npm --prefix workers ci
node scripts/sync-version.js --check
node --test tests/adapters.test.js tests/version-metadata.test.js tests/cursor-plugin.test.js
npm test
npm run test:coverage
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
git diff --check
```

Observed result:

- `npm ci` completed with `0` vulnerabilities.
- `npm --prefix workers ci` completed with `0` vulnerabilities.
- `node scripts/sync-version.js --check`: `✔ All 16 targets in sync at v0.7.1`.
- Targeted Cursor packaging regressions passed: `18` tests passed, `0` failed.
- `npm test` passed end-to-end on the Cursor marketplace branch.
- `npm run test:coverage` passed with all-files coverage of `83.92%` lines, `70.52%` branches, and `86.81%` functions.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `46` passed, `0` failed.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `47` passed, `0` failed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.
- `git diff --check` completed cleanly.

Requirements verified:

- The Cursor marketplace root manifest resolves to a valid repo-relative plugin directory.
- The Cursor marketplace manifest, Cursor plugin manifest, Claude plugin manifest, and package version remain synchronized.
- The Cursor plugin launcher uses the published npm package and does not hardcode `/Users/...` checkout paths.
- The multi-plugin marketplace contract is internally consistent: the marketplace entry name matches the plugin manifest name.
- Version-sync automation now owns the pinned Cursor launcher docs instead of leaving release drift behind.

## 2026-03-13 Truthful Revenue Analytics Verification

Scope:

- Added a dedicated revenue ledger to separate booked revenue from generic paid-stage funnel telemetry.
- Preserved honest provider coverage: Stripe records booked revenue; GitHub Marketplace records paid orders and only records booked revenue when plan pricing is explicitly configured.
- Threaded attribution metadata (`source`, UTM fields, referrer, landing path, CTA id) through public checkout creation, funnel events, revenue events, API summaries, CLI CFO output, and the hosted landing page.
- Replaced hardcoded marketing proof-strip vanity numbers with stable evidence-backed claims on the public landing page.

Commands run:

```bash
npm ci
env RLHF_API_KEY=test-api-key node --test tests/billing.test.js tests/api-server.test.js tests/github-billing.test.js tests/cli.test.js tests/stripe-webhook-route.test.js
env RLHF_API_KEY=test-api-key node --test tests/openapi-parity.test.js tests/adapters.test.js tests/commerce-quality.test.js
env RLHF_API_KEY=ci-secret npm test
env RLHF_API_KEY=ci-secret npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

Observed results:

- `npm ci`: completed successfully; `audited 151 packages` and `found 0 vulnerabilities`.
- Targeted changed-surface suite: `76 passed`, `0 failed`.
- OpenAPI / adapter / commerce suite: `27 passed`, `0 failed`.
- `npm test`: completed successfully across schema, loop, API, proof, E2E, billing, CLI, watcher, workflow, autoresearch, gates, and hardening phases.
- `npm run test:coverage`: `971 passed`, `0 failed`, `1 skipped`; coverage `82.59%` lines, `68.77%` branches, `85.37%` functions.
- `npm run prove:adapters`: `38 passed`, `0 failed`.
- `npm run prove:automation`: `37 passed`, `0 failed`.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4 healthy` checks.

Behavioral proof points:

- `scripts/billing.js` now emits `bookedRevenueCents`, `paidOrders`, `amountKnownCoverageRate`, `unreconciledPaidEvents`, and attribution breakdowns from a dedicated revenue ledger instead of inferring money from stage counts.
- `tests/billing.test.js` proves Stripe booked revenue is summarized truthfully and GitHub Marketplace remains amount-unknown unless plan pricing is configured.
- `tests/api-server.test.js` proves checkout attribution survives the API path and shows up in the admin billing summary.
- `tests/cli.test.js` proves `node bin/cli.js cfo` emits the richer revenue + attribution summary shape.
- `tests/github-billing.test.js` proves GitHub Marketplace purchase events create paid-order records and optionally booked revenue when plan pricing config is present.
- `tests/openapi-parity.test.js` and `tests/adapters.test.js` prove the machine-readable adapter surface stayed in sync after the summary shape expansion.

Artifacts updated:

- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`

## 2026-03-09 Local Intelligence Verification

Scope:

- Hardware-aware local embedding profile selection with machine-readable fit evidence.
- Safe fallback embedding profile selection when the primary local profile fails.
- Boosted local risk scorer trained from RLHF feedback sequences.
- CLI surface for `model-fit`, `risk`, and `prove --target=local-intelligence`.

Commands run:

```bash
npm ci
node --test tests/cli.test.js
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run prove:local-intelligence
npm run self-heal:check
```

Observed results:

- `node --test tests/cli.test.js`: `20` passed, `0` failed.
- `npm test`: all suites pass, including:
  - `tests/local-model-profile.test.js`
  - `tests/risk-scorer.test.js`
  - `tests/vector-store.test.js`
  - `tests/feedback-sequences.test.js`
  - `tests/feedback-loop.test.js`
  - `tests/prove-local-intelligence.test.js`
- `npm run test:coverage`: pass with overall coverage `82.86%` lines, `68.01%` branches, `86.00%` functions.
- `npm run prove:adapters`: `{ "passed": 21, "failed": 0 }`
- `npm run prove:automation`: `{ "passed": 14, "failed": 0 }`
- `npm run prove:local-intelligence`: `Status: PASSED`
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.

Behavioral proof points:

- `FIT-01`: low-RAM override selects the `compact` embedding profile and writes `model-fit-report.json`.
- `FIT-02`: `vector-store` falls back to the safe embedding profile when the primary profile load fails.
- `RISK-01`: feedback capture flow trains and persists `risk-model.json` from sequence data.
- `RISK-02`: analytics expose boosted risk summary with `exampleCount=6`, `mode=boosted`, and top high-risk domain `testing`.

Artifacts updated:

- `proof/local-intelligence-report.json`
- `proof/local-intelligence-report.md`

## 2026-03-17 Reddit GTM Attribution Verification

Scope:

- Added first-party Reddit campaign attribution across the live landing page, hosted checkout bootstrap, fallback checkout URLs, billing funnel events, and telemetry analytics.
- Preserved semantic SEO/GEO structure while introducing Reddit-specific campaign messaging and subreddit-aware attribution logic on the public landing page.
- Added operator documentation for Reddit distribution in `docs/REDDIT_GTM_PLAYBOOK.md`.
- Expanded business analytics so Reddit community, post, comment, campaign-variant, and offer-code performance can be measured end-to-end instead of inferred from raw visit counts.

Commands run:

```bash
git diff --check
npm ci
node --test tests/telemetry-analytics.test.js
node --test tests/public-landing.test.js
node --test tests/billing.test.js
node --test --test-concurrency=1 tests/api-server.test.js
node --test tests/dashboard.test.js
npm test
npm run test:coverage
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
```

Observed results:

- `git diff --check`: completed cleanly.
- `npm ci`: completed successfully; `audited 151 packages` and `found 0 vulnerabilities`.
- Targeted changed-surface tests:
  - `tests/telemetry-analytics.test.js`: passed.
  - `tests/public-landing.test.js`: passed.
  - `tests/billing.test.js`: passed.
  - `tests/api-server.test.js`: passed.
  - `tests/dashboard.test.js`: passed.
- `npm test`: `1070` tests, `1069` passed, `0` failed, `1` skipped.
- `npm run test:coverage`: `1070` tests, `1069` passed, `0` failed, `1` skipped; coverage `84.14%` lines, `70.74%` branches, `86.83%` functions.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters`: `46` passed, `0` failed.
- `env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation`: `47` passed, `0` failed.
- `npm run self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.

Behavioral proof points:

- `public/index.html` now classifies Reddit-origin traffic, preserves `community`, `postId`, `commentId`, `campaignVariant`, and `offerCode`, shows a Reddit campaign banner, and pushes first-party `landing_page_view` telemetry before checkout.
- `src/api/server.js` now threads Reddit attribution through `/checkout/pro`, `/v1/billing/checkout`, checkout bootstrap telemetry, and hosted success/cancel return URLs without overwriting Stripe checkout `session_id`; visitor-session state is preserved separately via `visitor_session_id`.
- `scripts/telemetry-analytics.js` now reports `byCommunity`, `byOfferCode`, `byCampaignVariant`, `topCommunity`, `topOfferCode`, and `topCampaignVariant` for page views and CTA events.
- `scripts/billing.js` now reports acquisition, signup, paid, revenue, and conversion breakdowns by Reddit community, post, comment, campaign variant, and offer code, making first-dollar attribution measurable at the business layer.
- `tests/public-landing.test.js`, `tests/api-server.test.js`, `tests/billing.test.js`, and `tests/telemetry-analytics.test.js` prove the end-to-end Reddit attribution contract from landing click through checkout and analytics summaries.

Artifacts updated:

- `docs/REDDIT_GTM_PLAYBOOK.md`

## 2026-03-17 Agent Readiness Diagnostics Verification

Scope:

- Added `scripts/agent-readiness.js` to audit runtime isolation, bootstrap context, and MCP permission tiers.
- Added `doctor` CLI support in `bin/cli.js`.
- Surfaced readiness data in `scripts/dashboard.js`.
- Added context-pack visibility metadata in `scripts/contextfs.js`.
- Hardened memex indexing so `constructMemexPack()` preserves namespace-aware results.
- Fixed the coverage teardown race in `tests/delegation-runtime.test.js`.

Commands run:

```bash
npm ci
npm test
npm run test:coverage
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:adapters
env RLHF_PROOF_DIR="$(mktemp -d)" npm run prove:automation
npm run self-heal:check
```

Observed results:

- `npm ci`: passed, `0` vulnerabilities.
- `npm test`: passed.
- `npm run test:coverage`: passed with Node test runner coverage summary:
  - line coverage: `90.25%`
  - branch coverage: `76.67%`
  - function coverage: `93.68%`
- `npm run prove:adapters`: passed with `46 passed`, `0 failed`.
- `npm run prove:automation`: passed with `55 passed`, `0 failed`.
- `self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.

Behavioral proof points:

- `doctor --json` reports `overallStatus`, runtime mode, bootstrap readiness, MCP tier, and article-alignment flags.
- `generateDashboard()` exposes readiness truth instead of guessing bootstrap state; the dashboard reflects the repo's actual `.mcp.json` presence.
- `constructContextPack()` and `constructMemexPack()` expose visibility metadata including hidden candidate counts, char-budget hits, and visible titles.
- Memex pack construction no longer drops relevant entries because namespace metadata is preserved in indexed documents and recovered from `stableRef` when needed.

Artifacts updated:

- `README.md`
- `bin/cli.js`
- `scripts/agent-readiness.js`
- `scripts/contextfs.js`
- `scripts/dashboard.js`
- `tests/agent-readiness.test.js`
- `tests/cli.test.js`
- `tests/contextfs.test.js`
- `tests/dashboard.test.js`
- `tests/delegation-runtime.test.js`

## 2026-03-09 Technical Debt Audit Cleanup Verification

Scope:

- Added a portable `npm run test:coverage` command using Node's built-in coverage for `tests/**/*.test.js`.
- Removed the unused `stripe` SDK dependency; billing continues to use direct HTTPS calls in `scripts/billing.js`.
- Synced published version metadata across MCP manifests and public docs to `0.7.1`.
- Refreshed active proof artifacts and pruned stale milestone-era proof files that were no longer referenced.

Commands run:

```bash
npm uninstall stripe
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
node scripts/self-healing-check.js --json > proof/automation/self-healing-health.json
node scripts/self-heal.js --reason=manual > proof/automation/self-heal-run.json
```

Observed results:

- `npm test`: pass.
- `npm run test:coverage`: pass with Node test runner coverage summary:
  - line coverage: `81.61%`
  - branch coverage: `67.06%`
  - function coverage: `83.76%`
- `npm run prove:adapters`: pass with `21 passed`, `0 failed`.
- `npm run prove:automation`: pass with `14 passed`, `0 failed`.
- `self-healing-check`: `Overall: HEALTHY` with `4/4` healthy checks.
- `self-heal:run`: `healthy: true`, no failing fix steps.

Coverage caveat:

- `npm run test:coverage` measures `tests/**/*.test.js`.
- The inline script phases in `test:schema`, `test:loop`, and `test:dpo` still run in CI via `npm test`, but they are not yet folded into the single coverage percentage.

Artifacts updated:

- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`
- `proof/automation/self-healing-health.json`
- `proof/automation/self-heal-run.json`

Cross-project Codex startup proof:

```bash
cd /Users/ganapolsky_i/workspace/git/igor/trading
codex exec "Print OK only" --skip-git-repo-check
```

Observed result:

- MCP startup reports `ready: rlhf, sentry, github, context7, playwright`
- No `rlhf` timeout and no MCP handshake error
- Command completed with output `OK`

## 2026-03-06 Revenue Funnel + Billing Hardening Verification

Scope:

- Public top-of-funnel checkout endpoint (`POST /v1/billing/checkout`) with install correlation metadata.
- Append-only funnel telemetry ledger with acquisition/activation/paid stages.
- Admin boundary hardening: billing API keys cannot call admin provision endpoint.
- Funnel analytics endpoint (`GET /v1/analytics/funnel`) for conversion evidence.
- CLI install correlation (`installId`) persisted and linked to acquisition events.

Commands run:

```bash
npm run feedback:summary
npm run feedback:rules
npm run self-heal:check
npm test
npm run prove:adapters
npm run prove:automation
```

Observed results:

- `self-heal:check`: `Overall: HEALTHY` with `4/4` healthy checks.
- `npm test`: all suites pass; key monetization checks verified in:
  - `tests/api-server.test.js`
  - `tests/billing.test.js`
  - `tests/cli.test.js`
  - `tests/openapi-parity.test.js`
- `npm run prove:adapters`: `{ "passed": 21, "failed": 0 }`
- `npm run prove:automation`: `{ "passed": 14, "failed": 0 }`

Behavioral proof points:

- Public checkout succeeds without bearer auth and emits acquisition event.
- First authenticated billing-key usage emits exactly one activation event.
- Stripe and GitHub billing flows emit paid-stage funnel events.
- Static admin token is required for `POST /v1/billing/provision`; billing keys receive `403`.
- OpenAPI canonical + ChatGPT adapter include billing and funnel analytics routes with parity checks.

Artifacts updated:

- `proof/compatibility/report.json`
- `proof/compatibility/report.md`
- `proof/automation/report.json`
- `proof/automation/report.md`
