# Roadmap: ThumbGate

## Milestones

- [x] **v1.0 Bidirectional Feature Sync** - Phases 1-5 (shipped 2026-03-04)
- [x] **v2.0 Production Readiness** - Phases 6-12 (shipped 2026-03-04)
- [x] **v3.0 Commercialization** - Phases 13-17 (shipped 2026-03-04)

## Phases

<details>
<summary>v1.0 Bidirectional Feature Sync (Phases 1-5) - SHIPPED 2026-03-04</summary>

### Phase 1: Contract Alignment
**Goal**: Both repos share a verified, compatible contract — function names mapped, schemas aligned, timestamps normalized — so every subsequent port is safe to execute
**Depends on**: Nothing (first phase)
**Requirements**: CNTR-01, CNTR-02, CNTR-03
**Success Criteria** (what must be TRUE):
  1. Running `grep -n "module.exports"` across both repos produces an explicit alias map with zero unresolved name collisions
  2. `rubricEvaluation` parameter is handled identically in both `feedback-schema.js` files with a documented diff resolution
  3. All timestamp fields in both repos produce valid `Date` objects when parsed through a shared `parseTimestamp()` helper — no `NaN` values
  4. A baseline test count is recorded for both repos (54 for thumbgate) and CI passes green before any ports begin
**Plans**: 3 plans

Plans:
- [x] 1-01-PLAN.md — Runtime export audit script + proof/contract-audit-report.md (CNTR-01)
- [x] 1-02-PLAN.md — rubricEvaluation gate + parseTimestamp() in Subway's feedback-schema.js (CNTR-02, CNTR-03 Subway)
- [x] 1-03-PLAN.md — parseTimestamp() in rlhf's feedback-schema.js + test suite + baseline count record (CNTR-03 rlhf)

### Phase 2: ML into thumbgate
**Goal**: thumbgate gains Thompson Sampling posteriors, exponential time-decay, LSTM/Transformer sequence tracking, and diversity tracking — all tested and verified against Subway's implementation
**Depends on**: Phase 1
**Requirements**: ML-01, ML-02, ML-03, ML-04, ML-05, ML-06
**Success Criteria** (what must be TRUE):
  1. `train_from_feedback.py` runs in thumbgate and produces `feedback_model.json` with per-category `alpha`/`beta` posteriors and `reliability_score` fields
  2. Feedback older than 7 days receives a lower weight than recent feedback — verifiable by inspecting the exponential decay calculation in `parseTimestamp()` + decay weight output
  3. `feedback-sequences.jsonl` is written and contains sliding windows of N=10 feedback entries per category
  4. `diversity-tracking.json` exists and contains per-domain `coverage_score` and a `diversityScore` metric
  5. All ML features pass unit tests (test count increases from Phase 1 baseline) and `proof/ml-features-report.md` exists with evidence
**Plans**: 5 plans

Plans:
- [x] 02-01-PLAN.md — Thompson Sampling JS module (scripts/thompson-sampling.js) — ML-01, ML-02
- [x] 02-02-PLAN.md — Python trainer (scripts/train_from_feedback.py) + sequence/diversity side-effects in feedback-loop.js — ML-03, ML-04
- [x] 02-03-PLAN.md — TDD: Thompson Sampling + time-decay tests (tests/thompson-sampling.test.js) — ML-01, ML-02, ML-05
- [x] 02-04-PLAN.md — TDD: sequence and diversity tests (tests/feedback-sequences.test.js, tests/diversity-tracking.test.js) — ML-03, ML-04, ML-05
- [x] 02-05-PLAN.md — npm ml:* scripts + proof/ml-features-report.md — ML-06

### Phase 3: Governance into Subway
**Goal**: Subway gains production-grade governance — budget enforcement, risk-stratified action planning, semantic context caching, and self-healing CI — all ported from thumbgate with zero new npm dependencies
**Depends on**: Phase 1
**Requirements**: GOV-01, GOV-02, GOV-03, GOV-04, GOV-05, GOV-06
**Success Criteria** (what must be TRUE):
  1. Calling `budget-guard.js` in Subway with a simulated $10.01 spend rejects the operation and leaves the ledger intact
  2. `intent-router.js` in Subway classifies a test intent and returns a policy bundle with correct approval requirements
  3. `contextfs.js` in Subway stores and retrieves context across 5 namespaces, and a second lookup for a Jaccard-similar query (>=0.7) returns a cache hit without re-computation
  4. Running `npm run test:governance` in Subway runs all governance Jest tests; `npm run self-heal:check` produces a health report
  5. All governance features pass unit tests and `proof/governance-into-subway/gov-sync-report.md` exists with evidence
**Plans**: 4 plans

Plans:
- [x] 3-01-PLAN.md — Port budget-guard.js + contextfs.js to Subway with Jest tests (GOV-01, GOV-03, GOV-05 partial)
- [x] 3-02-PLAN.md — Port mcp-policy.js + config files + intent-router.js with Jest tests (GOV-02, GOV-05 partial)
- [x] 3-03-PLAN.md — Port self-heal.js + self-healing-check.js with Subway-adapted DEFAULT_CHECKS + Jest tests + test:governance npm script (GOV-04, GOV-05)
- [x] 3-04-PLAN.md — Generate proof report + mark GOV requirements complete (GOV-06)

### Phase 4: LanceDB Vector Storage
**Goal**: thumbgate stores feedback vectors in an embedded LanceDB table with cross-language schema compatibility verified against Subway's Python stack
**Depends on**: Phase 2
**Requirements**: VEC-01, VEC-02, VEC-03, VEC-04, VEC-05
**Success Criteria** (what must be TRUE):
  1. A Python script creates a `rlhf_memories` LanceDB table and a Node.js script reads it back with the correct row count — cross-language smoke test passes
  2. `@lancedb/lancedb@0.26.2` and `apache-arrow@18.1.0` are installed and imported via `await import()` dynamic pattern with no `require()` ESM errors
  3. A semantic similarity search query against the `rlhf_memories` table returns historically relevant feedback entries ranked by 384-dim embedding distance
  4. All LanceDB features pass unit tests and `proof/lancedb-report.md` exists with cross-language schema verification evidence
**Plans**: 4 plans

Plans:
- [x] 4-01-PLAN.md — Install deps + create scripts/vector-store.js with dynamic import ESM/CJS pattern (VEC-01, VEC-02, VEC-03)
- [x] 4-02-PLAN.md — Wire upsertFeedback() side-effect into feedback-loop.js captureFeedback() (VEC-01)
- [x] 4-03-PLAN.md — TDD: vector-store tests with stub embed, upsert + search coverage (VEC-04, VEC-05)
- [x] 4-04-PLAN.md — Proof report script + proof/lancedb-report.md + REQUIREMENTS.md update (VEC-05)

### Phase 5: RLAIF and DPO Optimization
**Goal**: thumbgate gains self-auditing (RLAIF heuristic scoring against CLAUDE.md constraints) and DPO batch optimization that builds preference pairs from stable Thompson posteriors
**Depends on**: Phase 2, Phase 3
**Requirements**: DPO-01, DPO-02, DPO-03, DPO-04
**Success Criteria** (what must be TRUE):
  1. `selfAudit()` runs against a sample feedback entry and produces a constraint-graded score; every call is wrapped by budget-guard and logged to `self-score-log.jsonl`
  2. DPO batch optimization reads existing positive/negative feedback pairs, produces a preference pair dataset, and updates Thompson posteriors — output observable in `feedback_model.json`
  3. Meta-policy rule extraction produces at least one actionable rule from feedback trends and writes it to the rules store
  4. All RLAIF/DPO features pass unit tests and `proof/rlaif-report.md` exists with evidence; total API cost for the phase stays under $1.00 as enforced by budget-guard
**Plans**: 3 plans

Plans:
- [x] 5-01-PLAN.md — rlaif-self-audit.js + dpo-optimizer.js + wire selfAudit into feedback-loop.js (DPO-01, DPO-02)
- [x] 5-02-PLAN.md — meta-policy.js rule extraction from memory-log.jsonl trends (DPO-03)
- [x] 5-03-PLAN.md — Test suites + prove-rlaif.js proof gate + package.json wiring (DPO-04)

</details>

<details>
<summary>v2.0 Production Readiness (Phases 6-12) - SHIPPED 2026-03-04</summary>

### Phase 6: Feedback Attribution
**Goal**: Every feedback signal is traceable to the specific agent action that caused it, and pre-tool execution is guarded by attributed feedback context
**Depends on**: Phase 5
**Requirements**: ATTR-01, ATTR-02, ATTR-03
**Success Criteria** (what must be TRUE):
  1. A feedback entry captured after an agent tool call carries an `actionId` and `agentAction` field that identifies the exact operation that triggered it
  2. A pre-tool guard call with a known-bad action returns a `block` or `warn` decision derived from attributed feedback history, not from hard-coded rules
  3. Calling the guard with a never-seen action returns `allow` — no false positives from missing attribution data
  4. Unit tests cover attribution capture, guard allow/block/warn paths, and edge cases; all pass with 0 failures
**Plans**: 4 plans

Plans:
- [x] 06-01-PLAN.md — Port feedback-attribution.js + wire recordAction/attributeFeedback into captureFeedback() (ATTR-01)
- [x] 06-02-PLAN.md — Port hybrid-feedback-context.js pre-tool guard engine (ATTR-02)
- [x] 06-03-PLAN.md — TDD: node:test suites for both attribution modules (ATTR-03)
- [x] 06-04-PLAN.md — Proof gate + npm scripts + requirements closure (ATTR-03)

### Phase 7: Data Quality
**Goal**: Every feedback entry is audited for schema correctness, semantic quality, and anomaly risk; captured entries carry rich contextual metadata and granular outcome classifications
**Depends on**: Phase 6
**Requirements**: QUAL-01, QUAL-02, QUAL-03, QUAL-04
**Success Criteria** (what must be TRUE):
  1. Running `validate-feedback` on a batch produces a per-entry audit report flagging schema violations, semantic noise, and statistical anomalies
  2. A newly captured feedback entry includes `domain`, `filePaths`, `errorType`, and `outcomeCategory` fields populated by the enrichment pipeline
  3. `inferOutcome` classifies a feedback entry into a granular category beyond the binary up/down signal
  4. All data quality features have unit tests covering happy path, validation failures, and enrichment edge cases; all pass with 0 failures
**Plans**: 3 plans

Plans:
- [x] 07-01-PLAN.md — Port validate-feedback.js to scripts/ with RLHF schema adaptations (QUAL-01)
- [x] 07-02-PLAN.md — Add inferOutcome() + richContext enrichment to captureFeedback() (QUAL-02, QUAL-03)
- [x] 07-03-PLAN.md — Test suite + prove-data-quality.js + npm scripts wiring (QUAL-04)

### Phase 8: Loop Closure
**Goal**: Feedback patterns automatically distill into actionable behavior rules, plans are gated before execution, and feedback flows bidirectionally through inbox and memory bridge
**Depends on**: Phase 6
**Requirements**: LOOP-01, LOOP-02, LOOP-03, LOOP-04, LOOP-05
**Success Criteria** (what must be TRUE):
  1. Running `feedback-to-rules` against a seeded feedback log produces at least one actionable rule written to `prevention-rules.md` in CLAUDE.md-compatible format
  2. The plan gate rejects a PRD markdown file with a missing required section and passes a structurally valid PRD
  3. The feedback inbox reader returns entries in cursor order and resumes from a stored cursor position on the next call
  4. The feedback-to-memory bridge accepts a JSON feedback entry on stdin and emits a valid MCP memory format object on stdout
  5. All loop closure features have unit tests; all pass with 0 failures
**Plans**: 4 plans

Plans:
- [x] 08-01-PLAN.md — Port feedback-to-rules.js + analyze/toRules (LOOP-01)
- [x] 08-02-PLAN.md — Port plan-gate.js + validatePlan/formatReport (LOOP-02)
- [x] 08-03-PLAN.md — Port feedback-inbox-read.js + cursor-based reading (LOOP-03)
- [x] 08-04-PLAN.md — Port feedback-to-memory.js + test suite + prove-loop-closure.js (LOOP-04, LOOP-05)

### Phase 9: Intelligence
**Goal**: Queries route to pre-computed knowledge bundles for low-latency retrieval, and skill quality is tracked by correlating tool call metrics to nearby feedback signals
**Depends on**: Phase 6
**Requirements**: INTL-01, INTL-02, INTL-03
**Success Criteria** (what must be TRUE):
  1. A context engine query routes to the correct knowledge bundle within one lookup and returns a populated context pack
  2. After a sequence of tool calls and feedback captures, the skill tracker produces a per-skill quality score derived from timestamp-proximity correlation
  3. A skill with consistent positive feedback scores higher than a skill with mixed feedback in the same time window
  4. Unit tests cover routing logic, correlation algorithm, edge cases; all pass with 0 failures
**Plans**: 1 plan

Plans:
- [x] 09-01-PLAN.md — context-engine.js + skill-quality-tracker.js + tests + proof (INTL-01, INTL-02, INTL-03)

### Phase 10: Training Export
**Goal**: Feedback data is exportable in PyTorch JSON, CSV summary, and action analysis formats, with a DPO export gate preventing malformed data from entering training pipelines
**Depends on**: Phase 6, Phase 7
**Requirements**: XPRT-01, XPRT-02, XPRT-03, XPRT-04, XPRT-05
**Success Criteria** (what must be TRUE):
  1. Running `npm run feedback:export:pytorch` produces a valid PyTorch JSON file with `prompt`, `chosen`, `rejected` fields for each preference pair
  2. Running `npm run feedback:export:csv` produces a CSV file with one row per feedback entry, correct column headers, and properly escaped values
  3. Running `npm run feedback:export:actions` produces an action analysis report summarizing tool call patterns, success rates, and top failure modes
  4. The DPO export gate rejects a memory-log entry with a missing `chosen` field and passes a structurally valid pair
  5. All export features have unit tests covering format correctness, gate rejection, and empty-dataset edge cases; all pass with 0 failures
**Plans**: 1 plan

Plans:
- [x] 10-01-PLAN.md — training-export.js + prove-training-export.js + tests (XPRT-01, XPRT-02, XPRT-03, XPRT-04, XPRT-05)

### Phase 11: Subway Upgrades
**Goal**: Subway gains LanceDB vector storage, DPO offline batch optimization, Thompson Sampling JS posteriors, and self-healing GH Action workflows
**Depends on**: Phase 5
**Requirements**: SUBW-01, SUBW-02, SUBW-03, SUBW-04, SUBW-05
**Success Criteria** (what must be TRUE):
  1. Subway's LanceDB vector store upserts a feedback entry and retrieves it by semantic similarity — verified by a Jest test in the Subway repo
  2. Subway's DPO optimizer reads Subway's feedback log and produces a preference pair dataset
  3. Thompson Sampling JS module in Subway updates `alpha`/`beta` posteriors from Subway's feedback data and saves `feedback_model.json`
  4. Self-healing GH Action workflows run in Subway's CI and produce a health report
  5. All Subway upgrades have Jest tests and a `proof/subway-upgrades-report.md` with evidence; all tests pass with 0 failures
**Plans**: 4 plans

Plans:
- [x] 11-01-PLAN.md — Port vector-store.js to Subway + Jest tests (SUBW-01)
- [x] 11-02-PLAN.md — Port dpo-optimizer.js to Subway + Jest tests (SUBW-02)
- [x] 11-03-PLAN.md — Port thompson-sampling.js to Subway + Jest tests (SUBW-03)
- [x] 11-04-PLAN.md — Port self-healing workflows + test:governance + prove-subway-upgrades.js (SUBW-04, SUBW-05)

### Phase 12: Proof Gate
**Goal**: All v2 features are provably complete — proof reports cover every phase, the full test suite passes with increased count and zero failures
**Depends on**: Phases 6-11
**Requirements**: PROOF-01, PROOF-02
**Success Criteria** (what must be TRUE):
  1. A `proof/` directory entry exists for every v2 phase with machine-readable JSON and human-readable markdown
  2. Running `npm test` from the repo root completes with 0 failures and a test count strictly greater than the v1 final count (142 tests)
  3. No proof report contains a TODO, placeholder, or estimated result — all numbers are from actual test runs
**Plans**: 1 plan

Plans:
- [x] 12-01-PLAN.md — prove-v2-milestone.js + all proof reports generated (PROOF-01, PROOF-02)

</details>

## v3.0 Commercialization (In Progress)

**Milestone Goal:** Deploy hosted API, add Stripe billing, publish plugins to all 5 platforms, get first paying customer.

**Phase Dependencies:**
- Phase 13 (Deployment): first — nothing works without a hosted API
- Phase 14 (Billing): depends on Phase 13 — needs live HTTPS endpoint for Stripe webhooks
- Phase 15 (Plugin Distribution): can run parallel with Phase 14 — plugins work with local or hosted API
- Phase 16 (Discovery): depends on Phase 14 + Phase 15 — needs billing live and plugins published before marketing
- Phase 17 (Proof Gate): last — gate on all prior phases passing

### Phase 13: Deployment
**Goal**: The API server is containerized and publicly accessible via HTTPS on Railway, with configurable environment and health monitoring — making every downstream integration testable against a real endpoint
**Depends on**: Phase 12
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-03, DEPLOY-04
**Success Criteria** (what must be TRUE):
  1. `docker build` completes without error and `docker run` starts the API server with all scripts accessible
  2. A `curl https://<railway-domain>/health` from a machine with no local repo returns HTTP 200 with a JSON body containing `version` and `uptime` fields
  3. Changing an environment variable in the Railway dashboard takes effect on the next request without redeployment
  4. The deployed API returns valid JSON for at least one feedback endpoint — confirming full stack is wired, not just the health route
**Plans**: TBD

### Phase 14: Billing
**Goal**: A developer can pay $49/mo and immediately receive a working API key that grants access and is metered — making the first dollar of revenue possible
**Depends on**: Phase 13
**Requirements**: BILL-01, BILL-02, BILL-03, BILL-04
**Success Criteria** (what must be TRUE):
  1. Clicking the Stripe Checkout button in test mode completes a $49/mo subscription without error and redirects to a success page showing the provisioned API key
  2. A request to any protected endpoint with a valid provisioned key returns the expected response; the same request with an invalid or expired key returns HTTP 401
  3. After 10 API calls with a provisioned key, the usage meter reflects exactly 10 requests for that key's billing period
  4. A Stripe `customer.subscription.deleted` webhook disables the associated API key within one webhook delivery
**Plans**: TBD

### Phase 15: Plugin Distribution
**Goal**: Any developer on any of the 5 supported platforms can install the RLHF plugin with a single command and be capturing feedback within 5 minutes
**Depends on**: Phase 13
**Requirements**: PLUG-01, PLUG-02, PLUG-03, PLUG-04, PLUG-05, PLUG-06
**Success Criteria** (what must be TRUE):
  1. Running `npx thumbgate init` on a clean machine with no prior setup creates a working local config and captures a test feedback entry
  2. Following the Claude Code plugin README installs the skill and the `capture-feedback` command is available in Claude Code without any manual file editing
  3. Following the Codex config.toml README installs the MCP plugin and Codex can invoke the feedback capture tool
  4. Each of the 5 platform READMEs contains a complete setup walkthrough that a developer can follow in under 5 minutes with zero prior knowledge of RLHF
**Plans**: TBD

### Phase 16: Discovery
**Goal**: Developers searching for RLHF tooling or browsing AI plugin stores can find the product, understand the value in under 60 seconds, and reach a working install or purchase flow
**Depends on**: Phase 14, Phase 15
**Requirements**: DISC-01, DISC-02, DISC-03, DISC-04
**Success Criteria** (what must be TRUE):
  1. Opening the landing page shows a pain-to-value narrative, a pricing section with a visible $49/mo Checkout button, and a live demo or screenshot — all above the fold on desktop
  2. The main README on GitHub shows one-liner install commands for all 5 platforms that copy-paste directly into the respective tool's config
  3. The ChatGPT GPT Store submission is prepared and submitted with title, description, and actions schema pointing to the deployed API
  4. The Claude MCP Hub submission document is complete with name, description, install command, and capabilities listed
**Plans**: 1 plan

Plans:
- [x] 16-01-PLAN.md — Landing page + GPT Store + MCP Hub submissions + README pricing (DISC-01, DISC-02, DISC-03, DISC-04)

### Phase 17: Proof Gate
**Goal**: All v3 delivery claims are verifiable — the deployed API, billing flow, npm package, and test suite are proven end-to-end before the milestone is declared complete
**Depends on**: Phase 13, Phase 14, Phase 15, Phase 16
**Requirements**: PROOF-01, PROOF-02, PROOF-03, PROOF-04
**Success Criteria** (what must be TRUE):
  1. `curl https://<railway-domain>/v1/feedback` returns valid JSON — confirming internet-accessible deployed API
  2. A Stripe test-mode checkout completes end-to-end: payment succeeds, API key is provisioned, key authenticates a subsequent request
  3. Running `npx thumbgate init` on a clean machine with the published npm package completes without error
  4. Running `npm test` passes all 314+ tests with 0 failures — no regressions from v3 changes
**Plans**: 1 plan

Plans:
- [x] 17-01-PLAN.md — prove-v3-milestone.js: PROOF-01..04 all PASS (7/7 checks); 362 tests, 0 failures (PROOF-01, PROOF-02, PROOF-03, PROOF-04)

## Progress

**Execution Order (v3):**
Phase 13 → Phase 14 + Phase 15 (parallel after 13) → Phase 16 (after 14 + 15) → Phase 17

**Dependency graph (v3):**
- Phase 13: depends on Phase 12 (v2 complete)
- Phase 14: depends on Phase 13 (needs live HTTPS for Stripe webhooks)
- Phase 15: depends on Phase 13 (plugins reference hosted API in config)
- Phase 16: depends on Phase 14 + Phase 15 (landing page needs Checkout button + published plugins)
- Phase 17: depends on Phases 13, 14, 15, 16 (full gate)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Contract Alignment | v1.0 | 3/3 | Complete | 2026-03-04 |
| 2. ML into thumbgate | v1.0 | 5/5 | Complete | 2026-03-04 |
| 3. Governance into Subway | v1.0 | 4/4 | Complete | 2026-03-04 |
| 4. LanceDB Vector Storage | v1.0 | 4/4 | Complete | 2026-03-04 |
| 5. RLAIF and DPO Optimization | v1.0 | 3/3 | Complete | 2026-03-04 |
| 6. Feedback Attribution | v2.0 | 4/4 | Complete | 2026-03-04 |
| 7. Data Quality | v2.0 | 3/3 | Complete | 2026-03-04 |
| 8. Loop Closure | v2.0 | 4/4 | Complete | 2026-03-04 |
| 9. Intelligence | v2.0 | 1/1 | Complete | 2026-03-04 |
| 10. Training Export | v2.0 | 1/1 | Complete | 2026-03-04 |
| 11. Subway Upgrades | v2.0 | 4/4 | Complete | 2026-03-04 |
| 12. Proof Gate | v2.0 | 1/1 | Complete | 2026-03-04 |
| 13. Deployment | v3.0 | Complete    | 2026-03-04 | 2026-03-04 |
| 14. Billing | v3.0 | 1/1 | Complete | 2026-03-04 |
| 15. Plugin Distribution | v3.0 | 1/1 | Complete | 2026-03-04 |
| 16. Discovery | v3.0 | 1/1 | Complete | 2026-03-04 |
| 17. Proof Gate | v3.0 | 1/1 | Complete | 2026-03-04 |
