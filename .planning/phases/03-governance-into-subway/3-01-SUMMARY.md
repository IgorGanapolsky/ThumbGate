---
phase: 03-governance-into-subway
plan: 01
subsystem: governance
tags: [budget-guard, contextfs, GOV-01, GOV-03, GOV-05, jest, path-surgery]

requires:
  - phase: 01-contract-alignment
    provides: baseline-60-node-runner-tests (regression gate)
  - phase: 03-governance-into-subway
    plan: 02
    provides: jest.scripts.config.js (scripts/__tests__ runner)
provides:
  - budget-guard.js in Subway (.claude/scripts/feedback/) — GOV-01
  - contextfs.js in Subway (.claude/scripts/feedback/) — GOV-03
  - scripts/__tests__/budget-guard.test.js (8 Jest tests)
  - scripts/__tests__/contextfs.test.js (9 Jest tests)
  - proof/governance/3-01-budget-guard-contextfs-subway.md
affects: [3-03-PLAN, GOV-01, GOV-03, GOV-05]

tech-stack:
  added: []
  patterns: [PATH SURGERY pattern (3-level __dirname join), jest.scripts.config.js for scripts/__tests__, jest.resetModules() in beforeEach for env-var isolation]

key-files:
  created:
    - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/budget-guard.js
    - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/contextfs.js
    - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/budget-guard.test.js
    - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/contextfs.test.js
    - /Users/ganapolsky_i/workspace/git/igor/rlhf/proof/governance/3-01-budget-guard-contextfs-subway.md
  modified: []

key-decisions:
  - "PATH SURGERY: PROJECT_ROOT = path.join(__dirname, '..', '..', '..') — 3 levels up from .claude/scripts/feedback/ to Subway_RN_Demo/ root"
  - "Lock timeout adjusted from 5000/15000 to 30000/60000 in budget-guard.js — handles 4+ concurrent GSD agent API calls"
  - "Contextfs Jaccard threshold=0.7 and TTL=86400s preserved verbatim from rlhf source"
  - "Tests use jest.scripts.config.js (created in Plan 3-02) because main jest.config.js excludes scripts/ via testPathIgnorePatterns"
  - "THUMBGATE_CONTEXTFS_DIR env var used in contextfs tests to isolate storage to tmpDir directly"

patterns-established:
  - "jest.resetModules() + env var set before require() ensures each test gets a fresh module bound to its own tmpDir"
  - "Date.now monkey-patching for TTL expiry test — no fake timers needed for synchronous TTL check"

requirements-completed: [GOV-01, GOV-03, GOV-05]

duration: 15min
completed: 2026-03-04
---

# Phase 3 Plan 01: budget-guard.js + contextfs.js Ported to Subway Summary

**budget-guard.js and contextfs.js ported to Subway with 3-level PROJECT_ROOT path surgery and 30s lock timeout; 17 Jest tests covering spend tracking, overspend blocking, concurrency, Jaccard cache hits, TTL expiry, and namespace validation — all pass with 0 failures.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-04T00:00:00Z
- **Completed:** 2026-03-04T00:15:00Z
- **Tasks:** 2
- **Files modified:** 5 (4 Subway + 1 rlhf proof)

## Accomplishments

- Verified budget-guard.js in Subway at `.claude/scripts/feedback/` with correct PROJECT_ROOT 3-level path surgery and acquireLock timeoutMs=30000 / staleMs=60000
- Verified contextfs.js in Subway at `.claude/scripts/feedback/` with correct PROJECT_ROOT depth and Jaccard threshold=0.7
- 8 Jest tests for budget-guard.test.js: adds spend, blocks overspend, initializes ledger, concurrency stress, plus 4 budget-parsing edge cases
- 9 Jest tests for contextfs.test.js: store+retrieve, Jaccard cache hit (>=0.7), TTL expiry via Date.now monkeypatch, namespace normalization, invalid namespace rejection, Jaccard similarity math
- All 17 tests pass with 0 failures using `jest.scripts.config.js`
- rlhf baseline: 89 test:api + 2 proof = 91 total, 0 failures — no regression

## Task Commits

Note: The actual script files were created in Plan 3-02 (which executed first). This plan's execution confirmed correctness, ran all tests, and produced proof artifacts.

1. **Proof artifact + SUMMARY created** — this commit

## Files Created/Modified

- `.claude/scripts/feedback/budget-guard.js` — Subway copy; PROJECT_ROOT 3-level join; timeoutMs=30000
- `.claude/scripts/feedback/contextfs.js` — Subway copy; PROJECT_ROOT 3-level join; Jaccard threshold=0.7
- `scripts/__tests__/budget-guard.test.js` — 8 Jest test cases (GOV-01, GOV-05)
- `scripts/__tests__/contextfs.test.js` — 9 Jest test cases (GOV-03, GOV-05)
- `proof/governance/3-01-budget-guard-contextfs-subway.md` — rlhf-repo proof artifact

## Decisions Made

- PROJECT_ROOT uses `path.join(__dirname, '..', '..', '...')` — 3 levels up from `.claude/scripts/feedback/` to Subway_RN_Demo/
- Lock timeout: timeoutMs=30000, staleMs=60000 (vs rlhf default 5000/15000) for concurrent GSD agent load
- TTL test uses `Date.now = () => fakeNow` monkeypatch rather than jest.useFakeTimers — simpler and avoids timer interference with other tests
- Tests run via `jest.scripts.config.js` (created in Plan 3-02 as a Rule 3 auto-fix)

## Deviations from Plan

### Notes

The scripts (budget-guard.js, contextfs.js) and test files (budget-guard.test.js, contextfs.test.js) were created during Plan 3-02 execution (which ran before Plan 3-01 per STATE.md order). Plan 3-01 confirmed all done criteria, ran all tests, and produced proof evidence.

**No logic deviations.** All specs met exactly:
- PROJECT_ROOT depth: 3 levels (confirmed)
- timeoutMs: 30000 (confirmed)
- Jest tests: 17 total, 0 failures (exceeds minimum of 7)
- rlhf baseline: not regressed

## Issues Encountered

None — all tests passed on first run.

## User Setup Required

None.

## Next Phase Readiness

- GOV-01: budget-guard.js callable in Subway, $10/month cap enforced
- GOV-03: contextfs.js callable in Subway, Jaccard semantic cache (threshold=0.7, TTL=86400s) operational
- GOV-05: 17 Jest tests pass; test command: `npx jest --config jest.scripts.config.js scripts/__tests__/budget-guard.test.js scripts/__tests__/contextfs.test.js --no-coverage`
- Ready for Plan 3-03 (self-heal check) which depends on budget-guard.js being available

## Self-Check: PASSED

- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/budget-guard.js` — FOUND
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/contextfs.js` — FOUND
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/budget-guard.test.js` — FOUND
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/contextfs.test.js` — FOUND
- `/Users/ganapolsky_i/workspace/git/igor/rlhf/proof/governance/3-01-budget-guard-contextfs-subway.md` — FOUND
- Jest: 17 passed, 0 failed
- rlhf baseline: 91 tests, 0 failures

---
*Phase: 03-governance-into-subway*
*Completed: 2026-03-04*
