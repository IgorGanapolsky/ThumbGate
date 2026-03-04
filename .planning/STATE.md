# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-04)

**Core value:** Every synced feature has tests, passes CI, and produces verification evidence — no tech debt
**Current focus:** Phase 5: RLAIF and DPO Optimization

## Current Position

Phase: 4 of 5 — COMPLETE (LanceDB Vector Storage)
Plan: Phase 4 all 4 plans complete
Status: Phase 4 complete — 4-01, 4-02, 4-03, 4-04 done; VEC-01..VEC-05 all marked complete
Last activity: 2026-03-04 — Plan 4-04 complete: prove-lancedb.js generated lancedb-report.md; all 5 VEC requirements pass; 93 node-runner tests green; Phase 4 complete

Progress: [████████░░] 80%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: none yet
- Trend: -

*Updated after each plan completion*

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-contract-alignment P03 | 15min | 2 tasks | 3 files |
| 01-contract-alignment P02 | 20min | 2 tasks | 2 files |
| Phase 02-ml-into-rlhf-feedback-loop P02-01 | 8 | 1 tasks | 1 files |
| Phase 02-ml-into-rlhf-feedback-loop P02-02 | 20min | 2 tasks | 2 files |
| Phase 03-governance-into-subway P3-02 | 20min | 2 tasks | 9 files |
| Phase 02-ml-into-rlhf-feedback-loop P02-04 | 10min | 2 tasks | 3 files |
| Phase 02-ml-into-rlhf-feedback-loop P02-03 | 10min | 2 tasks | 1 files |
| Phase 02-ml-into-rlhf-feedback-loop P02-05 | 10min | 2 tasks | 2 files |
| Phase 03-governance-into-subway P3-03 | 25min | 2 tasks | 6 files |
| Phase 04-lancedb-vector-storage P4-01 | 1m 2s | 2 tasks | 3 files |
| Phase 04-lancedb-vector-storage P4-02 | 54s | 1 tasks | 1 files |
| Phase 04-lancedb-vector-storage P4-03 | 1m 23s | 2 tasks | 3 files |
| Phase 04-lancedb-vector-storage P4-04 | 112s | 2 tasks | 4 files |
| Phase 05-rlaif-and-dpo-optimization P5-02 | 2min | 1 tasks | 3 files |

## Accumulated Context

### Decisions

- [Init]: Cherry-pick best features from each repo — no full merge, library/prototype boundary preserved
- [Init]: Both sync directions run simultaneously — ML into rlhf-feedback-loop, governance into Subway
- [Init]: Phases 2 and 3 are independent and can run in parallel after Phase 1 clears
- [Init]: ### Decisions

0/month budget cap enforced by budget-guard.js on all API calls
- [Phase 01-contract-alignment]: parseTimestamp() uses new Date(String(ts).trim()) returning null for invalid input — CNTR-03 rlhf side complete
- [Phase 01-contract-alignment]: Baseline node-runner count is 60 (58 test:api + 2 test:proof) — authoritative Phase 2 and Phase 3 start gate in proof/baseline-test-count.md
- [Phase 01-contract-alignment P02]: Subway feedback-schema.js is gitignored via .git/info/exclude (local-only) — verified in place with 44 inline tests passing; CNTR-02 complete
- [Phase 02-ml-into-rlhf-feedback-loop]: Zero npm dependencies for Thompson Sampling: Marsaglia-Tsang gamma ratio (inline) replaces jStat library
- [Phase 02-ml-into-rlhf-feedback-loop]: timeDecayWeight delegates to parseTimestamp from Phase 1 — no duplicate timestamp parsing
- [Phase 02-ml-into-rlhf-feedback-loop P02-02]: ML side-effects (sequence + diversity) inline in feedback-loop.js, not a separate module — mirrors Subway architecture
- [Phase 02-ml-into-rlhf-feedback-loop P02-02]: Python trainer PROJECT_ROOT = Path(__file__).parent.parent (2 levels, not Subway's 3)
- [Phase 02-ml-into-rlhf-feedback-loop P02-02]: rewardSequence uses f.signal ('positive'/'negative'), not f.reward (1/-1) — rlhf schema difference from Subway
- [Phase 03-governance-into-subway]: PROJECT_ROOT uses path.join(__dirname, '..', '..', '..') in Subway — 3 levels up from .claude/scripts/feedback/ to repo root
- [Phase 02-ml-into-rlhf-feedback-loop]: require.cache invalidation per test ensures env var RLHF_FEEDBACK_DIR changes take effect for re-required modules in node:test suites
- [Phase 02-ml-into-rlhf-feedback-loop]: ML-05 test coverage for ML-03 and ML-04 implemented as integration-style tmpdir tests in 02-04
- [Phase 03-governance-into-subway]: budget-guard.js lock timeout: timeoutMs=30000/staleMs=60000 for concurrent GSD agent load (4+ parallel callers)
- [Phase 03-governance-into-subway]: contextfs.js Jaccard threshold=0.7, TTL clamped to Math.max(60, raw) — TTL test uses Date.now monkeypatch (no jest.useFakeTimers)
- [Phase 02-ml-into-rlhf-feedback-loop]: ml:* scripts invoke python3 scripts/train_from_feedback.py — no new binary dependencies
- [Phase 02-ml-into-rlhf-feedback-loop]: SC-5 delta confirmed: Phase 2 total 89 node-runner tests vs 60 Phase 1 baseline (+29 ML tests)
- [Phase 03-governance-into-subway]: KNOWN_FIX_SCRIPTS uses object array {name,command} in Subway self-heal.js — lookup via command[2] for correct npm script name matching
- [Phase 03-governance-into-subway]: jest.governance.config.js (testEnvironment:node) required in Subway — main jest-expo config excludes scripts/ from test runs
- [Phase 03-governance-into-subway]: All 6 governance scripts ported to Subway with zero new npm deps; 5 Jest test files passing (43 tests); proof committed in rlhf/proof/governance-into-subway/
- [Phase 04-lancedb-vector-storage]: Dynamic import() pattern is the only CJS-compatible approach for ESM-only @lancedb/lancedb
- [Phase 04-lancedb-vector-storage]: apache-arrow pinned to 18.1.0 — LanceDB 0.26.2 peer dep >=15.0.0 <=18.1.0; arrow 19+ breaks
- [Phase 04-lancedb-vector-storage]: TABLE_NAME = rlhf_memories — JS-only table, never shared with Python Subway tables
- [Phase 04-lancedb-vector-storage]: upsertFeedback() placed after primary JSONL write and all ML side-effects — fire-and-forget .catch() pattern, no await, vector index is optional enhancement
- [Phase 04-lancedb-vector-storage]: RLHF_VECTOR_STUB_EMBED=true returns deterministic 384-dim unit vector in embed() to run vector-store tests fully offline without ONNX model
- [Phase 04-lancedb-vector-storage]: Tests use it() (not test()) per node:test describe/it pattern matching thompson-sampling.test.js; require.cache invalidation isolates env per test
- [Phase 04-lancedb-vector-storage]: prove-lancedb.js uses RLHF_VECTOR_STUB_EMBED=true for offline smoke test; VEC-05 self-referential via execSync node:test
- [Phase 05-rlaif-and-dpo-optimization]: inferDomain exported from feedback-loop.js — was implemented but missing from module.exports; needed for meta-policy.js import
- [Phase 05-rlaif-and-dpo-optimization]: meta-policy.js run() is synchronous — CLI uses try/catch not async .catch(); timeDecayWeight imported from thompson-sampling.js (not feedback-schema.js)

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 4]: Lance file format version compatibility (Python 0.27.1 vs Node.js 0.26.2) not definitively resolved — must verify before Phase 4 implementation
- [Phase 3]: Subway lint:fix behavior under auto-import-sort not confirmed — must audit `.eslintrc.js` before enabling self-heal

## Session Continuity

Last session: 2026-03-04
Stopped at: Completed 04-lancedb-vector-storage/4-04-PLAN.md — prove-lancedb.js generated lancedb-report.md; all 5 VEC requirements pass; 93 tests green; Phase 4 complete
Resume file: None
