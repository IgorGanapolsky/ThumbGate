---
phase: 06-feedback-attribution
plan: "02"
subsystem: pre-tool-guard
tags: [hybrid-feedback-context, pretool-guard, attribution, ATTR-02]
dependency_graph:
  requires: []
  provides: [scripts/hybrid-feedback-context.js]
  affects: [scripts/feedback-attribution.js, .claude/memory/feedback/attributed-feedback.jsonl]
tech_stack:
  added: []
  patterns: [atomic-write-tmp-rename, compiled-artifact-fast-path, two-keyword-match-guard, fnv1a-hash]
key_files:
  created:
    - scripts/hybrid-feedback-context.js
  modified: []
decisions:
  - "PATHS.guardArtifact resolves to .claude/memory/feedback/pretool-guards.json — ROOT = path.join(__dirname, '..') (ThumbGate scripts/ 1 level from repo root)"
  - "hasTwoKeywordHits + count >= 2 filter enforces ATTR-03 no-false-positive invariant — evaluatePretool with no prior negative data always returns mode: allow"
  - "compileGuardArtifact prefers attributed patterns (sources includes attributedFeedback) over raw negatives — attributed guards sorted first"
  - "writeGuardArtifact uses atomic tmp rename: ${outPath}.tmp.${process.pid}.${Date.now()} — safe for concurrent GSD agent writes"
  - "evaluatePretool orchestrates compiled → state fallback — fast path trusts compiled artifact if present, skips state build"
metrics:
  duration: "135 seconds"
  completed: "2026-03-04T21:15:05Z"
  tasks_completed: 1
  files_created: 1
  files_modified: 0
requirements:
  - ATTR-02
---

# Phase 06 Plan 02: Hybrid Feedback Context — Pre-Tool Guard Engine Summary

**One-liner:** Pre-tool guard engine with compiled artifact fast path — block/warn/allow decisions derived from attributed feedback JSONL, enforcing ATTR-03 no-false-positive invariant via two-keyword match and count >= 2 filter.

## What Was Built

`scripts/hybrid-feedback-context.js` (676 lines, CJS) — the pre-tool execution guard that:

1. Reads from 4 JSONL sources: feedback-log, inbox, pending_cortex_sync, attributed-feedback
2. Deduplicates entries by id, builds recurring negative patterns (count >= 2)
3. Compiles patterns into a fast guard artifact (`pretool-guards.json`) via `compileGuardArtifact()`
4. Evaluates pre-tool calls: compiled artifact path first, live state fallback
5. Returns `{mode: 'block'|'warn'|'allow', reason, source}` — never blocks on no prior data

## Exports Verified

| Function | Purpose |
|---|---|
| `buildHybridState(opts)` | Reads all 4 JSONL sources, deduplicates, builds state |
| `evaluatePretool(toolName, toolInput, opts)` | Orchestrates compiled → state fallback |
| `compileGuardArtifact(state, opts)` | Builds deduped guards array from state |
| `writeGuardArtifact(filePath, artifact)` | Atomic write via tmp rename |
| `readGuardArtifact(filePath)` | Reads + validates guards array |
| `evaluateCompiledGuards(artifact, toolName, toolInput)` | Fast path check |
| `evaluatePretoolFromState(state, toolName, toolInput)` | Live path check |
| `deriveConstraints(state, max)` | Produces up to 5 actionable constraint strings |
| `buildAdditionalContext(state, constraints, maxChars)` | Formats summary for pre-tool injection |

## Verification Evidence

```
# All 5 plan verification steps passed:
node -e "require('./scripts/hybrid-feedback-context')"         → no error
evaluatePretool('Read','never-seen').mode === 'allow'          → true
buildHybridState().counts.total === number                     → true
grep "attributedFeedback" scripts/hybrid-feedback-context.js  → PATHS key + preferred strategy confirmed
node scripts/hybrid-feedback-context.js --compile-guards /tmp → {"guardCount":0,"outPath":...}
```

## CLI Behavior

- `--pretool <toolName> <toolInputJson>` — exits 2 on block, 0 on allow/warn
- `--compile-guards [outPath]` — writes guard artifact, outputs JSON summary
- Default — prints full state + constraints + additional context

## Deviations from Plan

None — plan executed exactly as written. Subway source did not exist as a physical file (find returned nothing), so the module was implemented from scratch following the detailed spec in 06-02-PLAN.md. All behavioral invariants are preserved.

## Commits

| Task | Name | Commit | Files |
|---|---|---|---|
| 1 | Port hybrid-feedback-context.js | 9676103 | scripts/hybrid-feedback-context.js (+676 lines) |

## Self-Check: PASSED

- `scripts/hybrid-feedback-context.js` exists: FOUND
- Commit `9676103` exists: FOUND
- All 9 required exports verified: PASSED
- No-false-positive invariant verified: PASSED
