# Roadmap: RLHF Bidirectional Feature Sync

## Overview

Two live production systems — `rlhf-feedback-loop` (Node.js RLHF product library, v0.5.0) and `Subway_RN_Demo` (React Native app with Python ML stack) — receive a surgical, bidirectional capability sync. ML features (Thompson Sampling, LanceDB, sequence tracking, diversity, RLAIF) flow from Subway into rlhf-feedback-loop. Governance features (budget guard, intent router, ContextFS, self-healing) flow from rlhf-feedback-loop into Subway. Every phase ships with tests and a proof report. No tech debt, no placeholders.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Phases 2 and 3 are independent and can run in parallel
- Phase 4 depends on Phase 2 (LanceDB needs ML baseline)
- Phase 5 depends on Phases 2 and 3

- [x] **Phase 1: Contract Alignment** - Audit exports and resolve schema divergence before any code movement
- [x] **Phase 2: ML into rlhf-feedback-loop** - Port Thompson Sampling, sequence tracking, and diversity from Subway (completed 2026-03-04)
- [x] **Phase 3: Governance into Subway** - Port budget guard, intent router, ContextFS, and self-healing from rlhf-feedback-loop (completed 2026-03-04)
- [x] **Phase 4: LanceDB Vector Storage** - Integrate LanceDB into rlhf-feedback-loop with cross-language verification (completed 2026-03-04)
- [x] **Phase 5: RLAIF and DPO Optimization** - Self-scoring and preference pair optimization atop stable ML infrastructure (completed 2026-03-04)
- [ ] **Phase 6: Feedback Attribution** - Trace feedback signals to specific agent actions; pre-tool guard using attributed context
- [ ] **Phase 7: Data Quality** - Validate-feedback auditor, rich context enrichment, and inferOutcome granular classification
- [ ] **Phase 8: Loop Closure** - Feedback-to-rules distillation, plan gate, inbox reader, and memory bridge
- [ ] **Phase 9: Intelligence** - Context engine routing and skill quality tracker correlating tool metrics to feedback
- [ ] **Phase 10: Training Export** - PyTorch JSON, CSV, and action analysis export formats with DPO validation gate
- [ ] **Phase 11: Subway Upgrades** - LanceDB, DPO optimizer, Thompson Sampling JS, and self-healing ported to Subway
- [ ] **Phase 12: Proof Gate** - Full v2 proof reports generated; npm test passes with 0 failures

## Phase Details

### Phase 1: Contract Alignment
**Goal**: Both repos share a verified, compatible contract — function names mapped, schemas aligned, timestamps normalized — so every subsequent port is safe to execute
**Depends on**: Nothing (first phase)
**Requirements**: CNTR-01, CNTR-02, CNTR-03
**Success Criteria** (what must be TRUE):
  1. Running `grep -n "module.exports"` across both repos produces an explicit alias map with zero unresolved name collisions
  2. `rubricEvaluation` parameter is handled identically in both `feedback-schema.js` files with a documented diff resolution
  3. All timestamp fields in both repos produce valid `Date` objects when parsed through a shared `parseTimestamp()` helper — no `NaN` values
  4. A baseline test count is recorded for both repos (54 for rlhf-feedback-loop) and CI passes green before any ports begin
**Plans**: 3 plans

Plans:
- [x] 1-01-PLAN.md — Runtime export audit script + proof/contract-audit-report.md (CNTR-01)
- [x] 1-02-PLAN.md — rubricEvaluation gate + parseTimestamp() in Subway's feedback-schema.js (CNTR-02, CNTR-03 Subway)
- [x] 1-03-PLAN.md — parseTimestamp() in rlhf's feedback-schema.js + test suite + baseline count record (CNTR-03 rlhf)

### Phase 2: ML into rlhf-feedback-loop
**Goal**: rlhf-feedback-loop gains Thompson Sampling posteriors, exponential time-decay, LSTM/Transformer sequence tracking, and diversity tracking — all tested and verified against Subway's implementation
**Depends on**: Phase 1
**Requirements**: ML-01, ML-02, ML-03, ML-04, ML-05, ML-06
**Success Criteria** (what must be TRUE):
  1. `train_from_feedback.py` runs in rlhf-feedback-loop and produces `feedback_model.json` with per-category `alpha`/`beta` posteriors and `reliability_score` fields
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
**Goal**: Subway gains production-grade governance — budget enforcement, risk-stratified action planning, semantic context caching, and self-healing CI — all ported from rlhf-feedback-loop with zero new npm dependencies
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
**Goal**: rlhf-feedback-loop stores feedback vectors in an embedded LanceDB table with cross-language schema compatibility verified against Subway's Python stack
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
**Goal**: rlhf-feedback-loop gains self-auditing (RLAIF heuristic scoring against CLAUDE.md constraints) and DPO batch optimization that builds preference pairs from stable Thompson posteriors
**Depends on**: Phase 2, Phase 3
**Requirements**: DPO-01, DPO-02, DPO-03, DPO-04
**Success Criteria** (what must be TRUE):
  1. `selfAudit()` (not `selfScore()`) runs against a sample feedback entry and produces a constraint-graded score; every call is wrapped by budget-guard and logged to `self-score-log.jsonl`
  2. DPO batch optimization reads existing positive/negative feedback pairs, produces a preference pair dataset, and updates Thompson posteriors — output observable in `feedback_model.json`
  3. Meta-policy rule extraction produces at least one actionable rule from feedback trends and writes it to the rules store
  4. All RLAIF/DPO features pass unit tests and `proof/rlaif-report.md` exists with evidence; total API cost for the phase stays under $1.00 as enforced by budget-guard
**Plans**: 3 plans

Plans:
- [x] 5-01-PLAN.md — rlaif-self-audit.js + dpo-optimizer.js + wire selfAudit into feedback-loop.js (DPO-01, DPO-02)
- [x] 5-02-PLAN.md — meta-policy.js rule extraction from memory-log.jsonl trends (DPO-03)
- [x] 5-03-PLAN.md — Test suites + prove-rlaif.js proof gate + package.json wiring (DPO-04)

### Phase 6: Feedback Attribution
**Goal**: Every feedback signal is traceable to the specific agent action that caused it, and pre-tool execution is guarded by attributed feedback context — making the RLHF loop causally grounded
**Depends on**: Phase 5 (builds on stable feedback-loop.js pipeline)
**Requirements**: ATTR-01, ATTR-02, ATTR-03
**Success Criteria** (what must be TRUE):
  1. A feedback entry captured after an agent tool call carries an `actionId` and `agentAction` field that identifies the exact operation (tool name, arguments digest, timestamp) that triggered it
  2. A pre-tool guard call with a known-bad action returns a `block` or `warn` decision derived from attributed feedback history, not from hard-coded rules
  3. Calling the guard with a never-seen action returns `allow` — no false positives from missing attribution data
  4. Unit tests cover attribution capture, guard allow/block/warn paths, and edge cases (no prior feedback, malformed action); all pass with 0 failures
**Plans**: 4 plans

Plans:
- [ ] 06-01-PLAN.md — Port feedback-attribution.js + wire recordAction/attributeFeedback into captureFeedback() (ATTR-01)
- [ ] 06-02-PLAN.md — Port hybrid-feedback-context.js pre-tool guard engine (ATTR-02)
- [ ] 06-03-PLAN.md — TDD: node:test suites for both attribution modules (ATTR-03)
- [ ] 06-04-PLAN.md — Proof gate + npm scripts + requirements closure (ATTR-03)

### Phase 7: Data Quality
**Goal**: Every feedback entry that enters the system is audited for schema correctness, semantic quality, and anomaly risk; captured entries carry rich contextual metadata and granular outcome classifications
**Depends on**: Phase 6 (attribution fields needed for full context enrichment)
**Requirements**: QUAL-01, QUAL-02, QUAL-03, QUAL-04
**Success Criteria** (what must be TRUE):
  1. Running `validate-feedback` on a batch of feedback entries produces a per-entry audit report flagging schema violations, semantic noise (vague or empty context strings), and statistical anomalies (outlier scores)
  2. A newly captured feedback entry includes `domain`, `filePaths`, `errorType`, and `outcomeCategory` fields populated by the enrichment pipeline — observable in the JSONL log
  3. `inferOutcome` classifies a feedback entry into a granular category (`quick-success`, `factual-error`, `partial-success`, etc.) beyond the binary up/down signal — verifiable by inspecting the entry's `outcomeCategory` field
  4. All data quality features have unit tests covering happy path, validation failures, and enrichment edge cases; all pass with 0 failures
**Plans**: TBD

### Phase 8: Loop Closure
**Goal**: Feedback patterns automatically distill into actionable behavior rules, plans are gated before execution, and feedback flows bidirectionally through inbox and memory bridge — closing the full RLHF loop
**Depends on**: Phase 6 (attributed feedback needed for meaningful rule distillation)
**Requirements**: LOOP-01, LOOP-02, LOOP-03, LOOP-04, LOOP-05
**Success Criteria** (what must be TRUE):
  1. Running `feedback-to-rules` against a seeded feedback log produces at least one actionable rule written to `prevention-rules.md` in CLAUDE.md-compatible format
  2. The plan gate rejects a PRD markdown file with a missing required section and passes a structurally valid PRD — observable via exit code and error message
  3. The feedback inbox reader returns entries in cursor order and resumes from a stored cursor position on the next call — no re-reads of already-processed entries
  4. The feedback-to-memory bridge accepts a JSON feedback entry on stdin and emits a valid MCP memory format object on stdout — verifiable with a round-trip test
  5. All loop closure features have unit tests; all pass with 0 failures
**Plans**: TBD

### Phase 9: Intelligence
**Goal**: Queries route to pre-computed knowledge bundles for low-latency retrieval, and skill quality is tracked by correlating tool call metrics to nearby feedback signals — making the system self-aware of what works
**Depends on**: Phase 6 (attribution metadata needed to correlate tool calls to feedback)
**Requirements**: INTL-01, INTL-02, INTL-03
**Success Criteria** (what must be TRUE):
  1. A context engine query routes to the correct knowledge bundle within one lookup and returns a populated context pack — no linear scan of all feedback entries
  2. After a sequence of tool calls and feedback captures, the skill tracker produces a per-skill quality score derived from timestamp-proximity correlation — observable in a skills report file
  3. A skill with consistent positive feedback scores higher than a skill with mixed feedback in the same time window
  4. Unit tests cover routing logic, correlation algorithm, edge cases (no nearby feedback, ties); all pass with 0 failures
**Plans**: TBD

### Phase 10: Training Export
**Goal**: Feedback data is exportable in PyTorch JSON, CSV summary, and action analysis formats, and the DPO export gate prevents malformed data from entering training pipelines
**Depends on**: Phase 6 (attribution fields needed for action analysis), Phase 7 (quality-validated data only)
**Requirements**: XPRT-01, XPRT-02, XPRT-03, XPRT-04, XPRT-05
**Success Criteria** (what must be TRUE):
  1. Running `npm run feedback:export:pytorch` produces a valid PyTorch JSON file with `prompt`, `chosen`, `rejected` fields for each preference pair
  2. Running `npm run feedback:export:csv` produces a CSV file with one row per feedback entry, correct column headers, and properly escaped values
  3. Running `npm run feedback:export:actions` produces an action analysis report summarizing tool call patterns, success rates, and top failure modes
  4. The DPO export gate rejects a memory-log entry with a missing `chosen` field and passes a structurally valid pair — preventing bad data in training output
  5. All export features have unit tests covering format correctness, gate rejection, and empty-dataset edge cases; all pass with 0 failures
**Plans**: TBD

### Phase 11: Subway Upgrades
**Goal**: Subway gains LanceDB vector storage, DPO offline batch optimization, Thompson Sampling JS posteriors, and self-healing GH Action workflows — all ported from rlhf-feedback-loop with tests and proof
**Depends on**: Phase 5 (stable rlhf implementations to port from); independent of Phases 7-10
**Requirements**: SUBW-01, SUBW-02, SUBW-03, SUBW-04, SUBW-05
**Success Criteria** (what must be TRUE):
  1. Subway's LanceDB vector store upserts a feedback entry and retrieves it by semantic similarity — verified by a Jest test in the Subway repo
  2. Subway's DPO optimizer reads Subway's feedback log and produces a preference pair dataset — output observable in a Subway proof file
  3. Thompson Sampling JS module in Subway updates `alpha`/`beta` posteriors from Subway's feedback data and saves `feedback_model.json`
  4. Self-healing GH Action workflows run in Subway's CI and produce a health report — visible in GitHub Actions output
  5. All Subway upgrades have Jest tests and a `proof/subway-upgrades-report.md` with evidence; all tests pass with 0 failures
**Plans**: TBD

### Phase 12: Proof Gate
**Goal**: All v2 features are provably complete — proof reports cover every phase, the full test suite passes with increased count and zero failures, and the project meets its production-readiness claim
**Depends on**: Phases 6, 7, 8, 9, 10, 11 (all prior phases must be complete)
**Requirements**: PROOF-01, PROOF-02
**Success Criteria** (what must be TRUE):
  1. A `proof/` directory entry exists for every v2 phase (attribution, data-quality, loop-closure, intelligence, training-export, subway-upgrades) with machine-readable JSON and human-readable markdown
  2. Running `npm test` from the repo root completes with 0 failures and a test count strictly greater than the v1 final count (142 tests)
  3. No proof report contains a TODO, placeholder, or estimated result — all numbers are from actual test runs
**Plans**: TBD

## Progress

**Execution Order (v2):**
Phase 6 → Phases 7, 8 (parallel, both depend on 6) → Phase 9 (depends on 6) → Phase 10 (depends on 6, 7; can parallel with 9) → Phase 11 (independent, parallel with 7-10) → Phase 12

**Dependency graph (v2):**
- Phase 6: depends on Phase 5
- Phase 7: depends on Phase 6 (independent of 8, 9, 10, 11 — can parallel)
- Phase 8: depends on Phase 6 (independent of 7, 9, 10, 11 — can parallel)
- Phase 9: depends on Phase 6
- Phase 10: depends on Phase 6, Phase 7
- Phase 11: depends on Phase 5 (independent of 6-10 — can parallel)
- Phase 12: depends on Phases 6, 7, 8, 9, 10, 11

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Contract Alignment | 3/3 | Complete | 2026-03-04 |
| 2. ML into rlhf-feedback-loop | 5/5 | Complete | 2026-03-04 |
| 3. Governance into Subway | 4/4 | Complete | 2026-03-04 |
| 4. LanceDB Vector Storage | 4/4 | Complete | 2026-03-04 |
| 5. RLAIF and DPO Optimization | 3/3 | Complete | 2026-03-04 |
| 6. Feedback Attribution | 3/4 | In Progress|  |
| 7. Data Quality | 0/TBD | Not started | - |
| 8. Loop Closure | 0/TBD | Not started | - |
| 9. Intelligence | 0/TBD | Not started | - |
| 10. Training Export | 0/TBD | Not started | - |
| 11. Subway Upgrades | 0/TBD | Not started | - |
| 12. Proof Gate | 0/TBD | Not started | - |
