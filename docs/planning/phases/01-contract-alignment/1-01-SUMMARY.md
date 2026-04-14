---
phase: 01-contract-alignment
plan: 01
subsystem: testing
tags: [node-builtin, require, export-diffing, compatibility-audit, cntr-01]

requires: []
provides:
  - "scripts/contract-audit.js: runtime export shape auditor for 3 shared scripts across both repos"
  - "proof/contract-audit-report.md: CNTR-01 evidence with alias map and compatibility verdicts"
affects:
  - "02-ml-features (needs alias map for captureFeedback/recordFeedback adapter)"
  - "03-governance (needs alias map for feedback-loop.js interface)"

tech-stack:
  added: []
  patterns:
    - "Runtime export diffing via require() + Object.keys() — authoritative over AST approaches"
    - "Verdict classification: COMPATIBLE / PARTIALLY COMPATIBLE / INCOMPATIBLE based on ThumbGate-only and subway-only overlap"
    - "Guard CLI with require.main === module to prevent side effects on require()"

key-files:
  created:
    - scripts/contract-audit.js
    - proof/contract-audit-report.md
  modified: []

key-decisions:
  - "Runtime require() + Object.keys() is authoritative over AST/static analysis for export shape diffing"
  - "feedback-schema.js reports 8 shared exports (not 7 as researched) — parseTimestamp was added in plan 1-03 which ran before this audit; runtime output is authoritative"
  - "Baseline CI count updated to 60 node-runner + 23 script-runner = 83 total (not 77 from research)"
  - "captureFeedback vs recordFeedback divergence in feedback-loop.js requires alias map, not rename — Phase 1 maps, Phase 2/3 ports"

patterns-established:
  - "Pattern: auditScript(relPath) — single function auditing one script across both repos, returns { script, thumbgateKeys, subwayKeys, shared, thumbgateOnly, subwayOnly, compatible }"
  - "Pattern: verdict() — COMPATIBLE/PARTIALLY COMPATIBLE/INCOMPATIBLE classification based on presence of primary function name divergence"

requirements-completed: [CNTR-01]

duration: 15min
completed: 2026-03-04
---

# Phase 1 Plan 01: Contract Audit Summary

**Node.js runtime export shape auditor (require + Object.keys) across 3 shared scripts between ThumbGate and Subway repos, producing machine-verifiable CNTR-01 evidence with alias map**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-04T15:00:00Z
- **Completed:** 2026-03-04T15:47:12Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `scripts/contract-audit.js` loads all 3 shared scripts from both repos via `require()` at runtime, computes shared/ThumbGate-only/subway-only export diffs, prints JSON to stdout, and writes `proof/contract-audit-report.md`
- `proof/contract-audit-report.md` contains compatibility verdicts, shared export tables, and alias map for all 3 scripts — machine-generated CNTR-01 evidence
- Audit JSON output validated against known divergence map from 1-RESEARCH.md; discrepancies documented (parseTimestamp export delta, baseline test count update)
- All 83 existing ThumbGate tests continue to pass after contract-audit.js was added (60 node-runner + 23 script-runner)

## Task Commits

1. **Task 1 + Task 2: contract-audit.js + proof report** - `b74d387` (feat)

Note: The task 2 assertion and report update were folded into the same commit as the initial implementation. The discrepancies section and baseline CI count were subsequently finalized in the 01-03 run at `f15811e`.

## Files Created/Modified

- `scripts/contract-audit.js` - Runtime export shape auditor; loads 3 shared scripts from both repos, diffs export keys, writes markdown report. Exports `{ auditScript }` for testability. CLI-guarded with `require.main === module`.
- `proof/contract-audit-report.md` - Generated CNTR-01 evidence: compatibility verdicts for all 3 scripts, shared export tables, alias map with 5 notable divergences, discrepancies section, baseline CI count.

## Decisions Made

- Used `require()` + `Object.keys()` over AST/static analysis: module evaluation is authoritative, catches computed exports that AST misses
- `verdict()` function uses presence of primary function name divergence (`captureFeedback`/`recordFeedback`) to distinguish INCOMPATIBLE from PARTIALLY COMPATIBLE
- Exited with code 1 on any `require()` failure (not silent skip) to surface missing Subway path immediately
- Documented discrepancy: `feedback-schema.js` shows 8 shared exports (not 7 from research) because `parseTimestamp` was added in plan 1-03 which ran before this audit

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated baseline CI count in report**
- **Found during:** Task 2 (Verify audit output matches research)
- **Issue:** Research predicted 54 node-runner tests (77 total). Actual runtime shows 60 node-runner (83 total) because 6 `parseTimestamp` tests were added when plan 1-03 ran before this plan.
- **Fix:** Updated `buildMarkdownReport()` to emit correct counts (60 node-runner, 83 total) and added Discrepancies section to the generated report documenting the delta.
- **Files modified:** scripts/contract-audit.js, proof/contract-audit-report.md
- **Verification:** `npm test` confirms 83 total tests pass; report contains correct counts
- **Committed in:** f15811e (finalized in 01-03 docs commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - stale count from research)
**Impact on plan:** Necessary for accuracy. The CNTR-01 artifact must reflect actual runtime state, not predictions.

## Issues Encountered

- `feedback-schema.js` actual shared export count is 8 (not 7 from research) because `parseTimestamp` was added in plan 1-03 execution before this plan ran. Runtime values are authoritative per plan instructions. Documented in Discrepancies section of the generated report.
- Prior execution had already committed `scripts/contract-audit.js` and initial `proof/contract-audit-report.md` — this summary completion documents the plan close-out.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CNTR-01 satisfied: `proof/contract-audit-report.md` is the machine-generated evidence of export compatibility state
- Alias map is ready for Phase 2 (ML features) and Phase 3 (governance) planners
- `captureFeedback` vs `recordFeedback` divergence documented — Phase 2/3 must implement alias adapter
- `validateMemoryStructure` (Subway-only) and `selfScore` (Subway-only) flagged for Phase 2 and Phase 5 respectively
- Baseline CI: 60 node-runner + 23 script-runner = 83 total passing — authoritative gate for Phase 2 and Phase 3

---
*Phase: 01-contract-alignment*
*Completed: 2026-03-04*
