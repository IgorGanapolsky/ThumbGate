# Contract Audit Report

Generated: 2026-03-04T16:36:33.661Z

This report is machine-generated evidence for CNTR-01: export mapping audit confirming compatibility between rlhf-feedback-loop and Subway_RN_Demo shared scripts.

## feedback-schema.js

**Verdict: COMPATIBLE**

### Shared Exports

| Export | Present in RLHF | Present in Subway |
|--------|----------------|------------------|
| `GENERIC_TAGS` | yes | yes |
| `MIN_CONTENT_LENGTH` | yes | yes |
| `VALID_CATEGORIES` | yes | yes |
| `VALID_TITLE_PREFIXES` | yes | yes |
| `parseTimestamp` | yes | yes |
| `prepareForStorage` | yes | yes |
| `resolveFeedbackAction` | yes | yes |
| `validateFeedbackMemory` | yes | yes |

## feedback-loop.js

**Verdict: INCOMPATIBLE**

### Shared Exports

| Export | Present in RLHF | Present in Subway |
|--------|----------------|------------------|
| `FEEDBACK_LOG_PATH` | yes | yes |
| `analyzeFeedback` | yes | yes |
| `feedbackSummary` | yes | yes |

### RLHF-Only Exports (missing from Subway)

- `MEMORY_LOG_PATH`
- `PREVENTION_RULES_PATH`
- `SUMMARY_PATH`
- `buildPreventionRules`
- `captureFeedback`
- `getFeedbackPaths`
- `readJSONL`
- `writePreventionRules`

### Subway-Only Exports (missing from RLHF)

- `SELF_SCORE_LOG_PATH`
- `recordFeedback`
- `selfScore`

## export-dpo-pairs.js

**Verdict: PARTIALLY COMPATIBLE**

### Shared Exports

| Export | Present in RLHF | Present in Subway |
|--------|----------------|------------------|
| `buildDpoPairs` | yes | yes |
| `domainOverlap` | yes | yes |
| `extractDomainKeys` | yes | yes |
| `inferPrompt` | yes | yes |
| `toJSONL` | yes | yes |

### RLHF-Only Exports (missing from Subway)

- `DEFAULT_LOCAL_MEMORY_LOG`
- `exportDpoFromMemories`
- `readJSONL`

### Subway-Only Exports (missing from RLHF)

- `validateMemoryStructure`

## Alias Map

Notable divergences between repos requiring an alias or adapter in Phases 2/3:

| Function | RLHF Export | Subway Export | Status |
|---|---|---|---|
| Feedback capture | `captureFeedback` | `recordFeedback` | INCOMPATIBLE — alias required in Phase 2/3 |
| Self-assessment | absent | `selfScore` | Subway-only — document for Phase 5 (RLAIF) |
| Feedback summary | `feedbackSummary(recentN)` | `feedbackSummary(recentN, logPath)` | Signature divergence — compatible at export level, behavior differs |
| Memory validation | absent | `validateMemoryStructure` | Subway-only — flag for Phase 2 planner |
| Rubric evaluation | `resolveFeedbackAction` accepts `rubricEvaluation` | `resolveFeedbackAction` accepts `rubricEvaluation` | COMPATIBLE — CNTR-02 resolved |

## Discrepancies vs Research Notes

The following discrepancies were found between the 1-RESEARCH.md predictions and actual runtime output:

| Prediction (1-RESEARCH.md) | Actual (Runtime) | Notes |
|---|---|---|
| feedback-schema.js: 7 shared exports | 8 shared exports | `parseTimestamp` was added in plan 1-03 before this audit ran. Runtime is authoritative. |
| Baseline: 54 node-runner tests | 60 node-runner tests | 6 `parseTimestamp` tests added in tests/api-server.test.js (from contextfs.test.js) when plan 1-03 was executed. |
| Total: 77 tests (54+23) | 83 tests (60+23) | Same delta: parseTimestamp tests added to node-runner suite. |

## Baseline CI

All 3 scripts audited. Baseline CI: 60 node-runner tests + 23 script-runner tests = 83 total passing.
