## March 12, 2026: Commercial truth correction

Scope:

- Replaced stale `$5/mo` and `$10/mo` self-serve subscription language on live-facing surfaces with the actual public offer: Pro Pack (`$9` one-time).
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
- This surface is an operational billing proxy only; it does not claim booked revenue or invoice truth because the persisted stores track paid events, API keys, customer IDs, and usage rather than Stripe ledger amounts.

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
