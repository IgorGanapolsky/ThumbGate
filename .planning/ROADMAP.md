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
- [ ] **Phase 5: RLAIF and DPO Optimization** - Self-scoring and preference pair optimization atop stable ML infrastructure

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
- [ ] 02-01-PLAN.md — Thompson Sampling JS module (scripts/thompson-sampling.js) — ML-01, ML-02
- [ ] 02-02-PLAN.md — Python trainer (scripts/train_from_feedback.py) + sequence/diversity side-effects in feedback-loop.js — ML-03, ML-04
- [ ] 02-03-PLAN.md — TDD: Thompson Sampling + time-decay tests (tests/thompson-sampling.test.js) — ML-01, ML-02, ML-05
- [ ] 02-04-PLAN.md — TDD: sequence and diversity tests (tests/feedback-sequences.test.js, tests/diversity-tracking.test.js) — ML-03, ML-04, ML-05
- [ ] 02-05-PLAN.md — npm ml:* scripts + proof/ml-features-report.md — ML-06

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
- [ ] 3-01-PLAN.md — Port budget-guard.js + contextfs.js to Subway with Jest tests (GOV-01, GOV-03, GOV-05 partial)
- [ ] 3-02-PLAN.md — Port mcp-policy.js + config files + intent-router.js with Jest tests (GOV-02, GOV-05 partial)
- [ ] 3-03-PLAN.md — Port self-heal.js + self-healing-check.js with Subway-adapted DEFAULT_CHECKS + Jest tests + test:governance npm script (GOV-04, GOV-05)
- [ ] 3-04-PLAN.md — Generate proof report + mark GOV requirements complete (GOV-06)

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
- [ ] 4-01-PLAN.md — Install deps + create scripts/vector-store.js with dynamic import ESM/CJS pattern (VEC-01, VEC-02, VEC-03)
- [ ] 4-02-PLAN.md — Wire upsertFeedback() side-effect into feedback-loop.js captureFeedback() (VEC-01)
- [ ] 4-03-PLAN.md — TDD: vector-store tests with stub embed, upsert + search coverage (VEC-04, VEC-05)
- [ ] 4-04-PLAN.md — Proof report script + proof/lancedb-report.md + REQUIREMENTS.md update (VEC-05)

### Phase 5: RLAIF and DPO Optimization
**Goal**: rlhf-feedback-loop gains self-auditing (RLAIF heuristic scoring against CLAUDE.md constraints) and DPO batch optimization that builds preference pairs from stable Thompson posteriors
**Depends on**: Phase 2, Phase 3
**Requirements**: DPO-01, DPO-02, DPO-03, DPO-04
**Success Criteria** (what must be TRUE):
  1. `selfAudit()` (not `selfScore()`) runs against a sample feedback entry and produces a constraint-graded score; every call is wrapped by budget-guard and logged to `self-score-log.jsonl`
  2. DPO batch optimization reads existing positive/negative feedback pairs, produces a preference pair dataset, and updates Thompson posteriors — output observable in `feedback_model.json`
  3. Meta-policy rule extraction produces at least one actionable rule from feedback trends and writes it to the rules store
  4. All RLAIF/DPO features pass unit tests and `proof/rlaif-report.md` exists with evidence; total API cost for the phase stays under $1.00 as enforced by budget-guard
**Plans**: TBD

## Progress

**Execution Order:**
Phase 1 → Phase 2 and Phase 3 (parallel) → Phase 4 → Phase 5

**Dependency graph:**
- Phase 1: no dependencies
- Phase 2: depends on Phase 1
- Phase 3: depends on Phase 1 (independent of Phase 2, can run in parallel)
- Phase 4: depends on Phase 2
- Phase 5: depends on Phase 2 and Phase 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Contract Alignment | 3/3 | Complete    | 2026-03-04 |
| 2. ML into rlhf-feedback-loop | 5/5 | Complete    | 2026-03-04 |
| 3. Governance into Subway | 4/4 | Complete    | 2026-03-04 |
| 4. LanceDB Vector Storage | 4/4 | Complete    | 2026-03-04 |
| 5. RLAIF and DPO Optimization | 0/TBD | Not started | - |
