---
phase: 01-contract-alignment
plan: 03
subsystem: feedback-schema
tags: [parseTimestamp, CNTR-03, baseline, test-coverage]
dependency_graph:
  requires: []
  provides: [parseTimestamp-ThumbGate, baseline-test-count]
  affects: [phase-2-gate, phase-3-gate]
tech_stack:
  added: []
  patterns: [node:test, ISO-8601-parsing]
key_files:
  created:
    - tests/feedback-schema.test.js
    - proof/baseline-test-count.md
  modified:
    - scripts/feedback-schema.js
    - package.json
decisions:
  - "parseTimestamp() uses new Date(String(ts).trim()) — handles Z-suffix, no-suffix, and UTC offset variants with a single expression; returns null (not NaN/throw) for bad input"
  - "test:api script in package.json now explicitly lists feedback-schema.test.js to include it in the node-runner count"
  - "node-runner total is 60 (58 test:api + 2 test:proof); script-runner total is 23 — these counts are the authoritative Phase 2 start gate"
metrics:
  duration: "10 minutes"
  completed: "2026-03-04"
  tasks_completed: 2
  files_modified: 4
---

# Phase 1 Plan 03: parseTimestamp ThumbGate-side + Baseline Test Count Summary

**One-liner:** parseTimestamp() ISO 8601 helper added to ThumbGate's feedback-schema.js with 6-case node:test suite; 60 node-runner + 23 script-runner baseline recorded as Phase 2 start gate.

## What Was Built

1. `parseTimestamp()` function in `scripts/feedback-schema.js` — handles Z-suffix, no-suffix (Python's `.replace("Z","")` pattern), UTC offset, null, undefined, and garbage inputs
2. `tests/feedback-schema.test.js` — 6 node:test cases covering all timestamp variants and edge cases
3. `package.json` — `test:api` command now includes `tests/feedback-schema.test.js`
4. `proof/baseline-test-count.md` — authoritative pre-Phase-2 CI gate with real counts (no placeholders)

## Verification Evidence

```
node -e "... parseTimestamp checks ..." => all pass
node --test tests/feedback-schema.test.js => 6 pass, 0 fail
npm test => 60 node-runner + 23 script-runner, exits 0
grep "parseTimestamp" scripts/feedback-schema.js | wc -l => 3
```

## CNTR-03 Completion

- ThumbGate side: parseTimestamp() added and exported from `scripts/feedback-schema.js` (this plan)
- Subway side: completed in Plan 02
- CNTR-03 is fully satisfied in both repos

## Baseline Test Count

| Runner | Count |
|--------|-------|
| node-runner (test:api) | 58 |
| node-runner (test:proof) | 2 |
| **node-runner total** | **60** |
| script-runner | 23 |
| **Grand total** | **83** |

Baseline record: `proof/baseline-test-count.md`

## Deviations from Plan

### Pre-existing Work Found

**[Rule 1 - Pre-committed] Task 1 (parseTimestamp in feedback-schema.js) was already committed**
- Found during: Initial file inspection
- Issue: Commit `363ca2b` had already added parseTimestamp() and exported it — Task 1 was done before this agent ran
- Action: Verified correctness (7 inline tests pass, export type=function, grep count=3) and proceeded to Task 2
- No re-work needed

**[Rule 2 - Auto-add] tests/feedback-schema.test.js was untracked (not yet committed)**
- Found during: git status check
- Issue: The test file existed on disk but was untracked; package.json already had it in test:api
- Fix: Committed the test file and package.json together as Task 2 Part A
- Commit: `67ef5fb`

None of the pre-existing state caused regressions. npm test exits 0 with 60 node-runner tests as expected.

## Self-Check: PASSED

- scripts/feedback-schema.js: FOUND, contains parseTimestamp (3 occurrences)
- tests/feedback-schema.test.js: FOUND (38 lines)
- proof/baseline-test-count.md: FOUND, contains real numeric counts
- Commits: 363ca2b (Task 1), 67ef5fb (Task 2 Part A), c8d57c1 (Task 2 Part B)
- npm test: exits 0, 60 node-runner + 23 script-runner
