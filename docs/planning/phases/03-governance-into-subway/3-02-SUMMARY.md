---
phase: 03-governance-into-subway
plan: 02
subsystem: governance
tags: [mcp-policy, intent-router, policy-bundles, GOV-02, GOV-05, jest]

requires:
  - phase: 01-contract-alignment
    provides: baseline-60-node-runner-tests (regression gate)
provides:
  - mcp-policy.js in Subway (.claude/scripts/feedback/)
  - intent-router.js in Subway (.claude/scripts/feedback/)
  - mcp-allowlists.json in Subway (.claude/config/)
  - subagent-profiles.json in Subway (.claude/config/)
  - policy-bundles/default-v1.json in Subway (.claude/config/policy-bundles/)
  - policy-bundles/constrained-v1.json in Subway (.claude/config/policy-bundles/)
  - scripts/__tests__/intent-router.test.js (10 Jest tests)
  - jest.scripts.config.js (scripts-only test runner)
affects: [3-03-PLAN, 3-04-PLAN, GOV-02, GOV-05]

tech-stack:
  added: [jest.scripts.config.js (node testEnvironment for scripts)]
  patterns: [PATH SURGERY pattern for porting ThumbGate scripts to Subway .claude/ subdirectory, policy-bundle-based intent risk stratification]

key-files:
  created:
    - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/mcp-policy.js
    - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/intent-router.js
    - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/mcp-allowlists.json
    - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/subagent-profiles.json
    - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/policy-bundles/default-v1.json
    - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/config/policy-bundles/constrained-v1.json
    - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/intent-router.test.js
    - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/jest.scripts.config.js
    - proof/governance/3-02-intent-router-subway.md
  modified: []

key-decisions:
  - "PATH SURGERY for Subway: PROJECT_ROOT = path.join(__dirname, '..', '..', '..') — 3 levels up from .claude/scripts/feedback/ reaches Subway_RN_Demo/"
  - "DEFAULT_BUNDLE_DIR in intent-router.js uses path.join(PROJECT_ROOT, '.claude', 'config', 'policy-bundles') — unlike ThumbGate where config is at repo root, Subway keeps config under .claude/"
  - "jest.scripts.config.js created as a Rule 3 (blocking) auto-fix — main jest.config.js excludes scripts/ dir via testPathIgnorePatterns, so governance tests need a separate config"
  - "policy-bundles JSON files carry _comment key noting tool names are ThumbGate-origin pending Subway-specific cleanup in a future pass"

patterns-established:
  - "PATH SURGERY pattern: when porting ThumbGate scripts to Subway .claude/scripts/feedback/, always change PROJECT_ROOT to 3-level join; always adjust config subpaths from config/ to .claude/config/"
  - "jest.scripts.config.js pattern: infrastructure tests that belong in scripts/__tests__/ must use this config to bypass testPathIgnorePatterns"

requirements-completed: [GOV-02, GOV-05]

duration: 20min
completed: 2026-03-04
---

# Phase 3 Plan 02: Intent Router + MCP Policy Ported to Subway Summary

**mcp-policy.js and intent-router.js ported to Subway with 3-level PROJECT_ROOT path surgery; 4 config files deployed to .claude/config/; 10-test Jest suite covering checkpoint_required, ready, error cases, and getMcpAllowlist.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-03-04T00:00:00Z
- **Completed:** 2026-03-04T00:20:00Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Ported mcp-policy.js and intent-router.js from ThumbGate/scripts/ to Subway .claude/scripts/feedback/ with correct 3-level PROJECT_ROOT path surgery
- Deployed 4 config files (mcp-allowlists.json, subagent-profiles.json, default-v1.json, constrained-v1.json) to Subway .claude/config/
- Wrote 10-test Jest suite for GOV-05: planIntent checkpoint_required, planIntent ready, error cases, getMcpAllowlist, listIntents — all pass 0 failures
- Auto-fixed blocking jest.config.js testPathIgnorePatterns issue by creating jest.scripts.config.js
- ThumbGate regression check: 60 node-runner tests (58 test:api + 2 test:proof), 0 failures — baseline preserved

## Task Commits

1. **Task 1 + Task 2: port mcp-policy, intent-router, config files + 10-test Jest suite** - `01358b0` (feat)

## Files Created/Modified

- `.claude/scripts/feedback/mcp-policy.js` — Subway copy; PROJECT_ROOT 3-level join; resolves .claude/config/mcp-allowlists.json
- `.claude/scripts/feedback/intent-router.js` — Subway copy; PROJECT_ROOT 3-level join; DEFAULT_BUNDLE_DIR uses .claude/config/policy-bundles/
- `.claude/config/mcp-allowlists.json` — 3-profile tool allowlist (default, readonly, locked)
- `.claude/config/subagent-profiles.json` — 3-profile subagent config (pr_workflow, review_workflow, secure_runtime)
- `.claude/config/policy-bundles/default-v1.json` — balanced bundle (4 intents); _comment key added
- `.claude/config/policy-bundles/constrained-v1.json` — conservative bundle (3 intents); _comment key added
- `scripts/__tests__/intent-router.test.js` — 10 Jest test cases (GOV-05)
- `jest.scripts.config.js` — node testEnvironment config for scripts/__tests__/ (auto-fix deviation)
- `proof/governance/3-02-intent-router-subway.md` — ThumbGate-repo proof artifact

## Decisions Made

- PROJECT_ROOT uses `path.join(__dirname, '..', '..', '...')` in both scripts — 3 levels up from `.claude/scripts/feedback/` to Subway_RN_Demo/
- DEFAULT_BUNDLE_DIR in intent-router.js changed from `config/policy-bundles` (ThumbGate pattern) to `.claude/config/policy-bundles` (Subway pattern)
- Policy bundle JSON files have `_comment` top-level key noting ThumbGate-origin tool names for future cleanup

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created jest.scripts.config.js to enable running scripts/__tests__/**
- **Found during:** Task 2 (intent-router Jest test suite)
- **Issue:** main `jest.config.js` has `testPathIgnorePatterns` that excludes `<rootDir>/scripts/`, so `npx jest scripts/__tests__/intent-router.test.js` finds 0 tests
- **Fix:** Created `jest.scripts.config.js` with `testEnvironment: 'node'`, `testMatch: scripts/__tests__/**/*.test.js`, and no scripts exclusion in testPathIgnorePatterns
- **Files modified:** `jest.scripts.config.js` (new file in Subway)
- **Verification:** `npx jest --config jest.scripts.config.js scripts/__tests__/intent-router.test.js --no-coverage` — 10 passed, 0 failed
- **Committed in:** 01358b0

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking testPathIgnorePatterns)
**Impact on plan:** Necessary infrastructure fix. The test file placement in scripts/__tests__/ is correct per plan spec; the jest.config.js exclusion is an existing behavior that required a separate config. No scope creep.

## Issues Encountered

- Subway's `jest.config.js` excludes `scripts/` via `testPathIgnorePatterns` — pre-existing behavior, not changed. Resolved by separate config.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- GOV-02: intent-router.js callable in Subway with full config chain working
- GOV-05: 10 Jest tests pass; test command: `npx jest --config jest.scripts.config.js scripts/__tests__/intent-router.test.js --no-coverage`
- Ready for Plan 3-03 (budget-guard.js port) and Plan 3-04 (self-heal)

---
*Phase: 03-governance-into-subway*
*Completed: 2026-03-04*
