---
phase: 08-loop-closure
plan: "02"
subsystem: loop-closure
tags: [plan-gate, prd-validation, structural-gate, rlhf]
dependency_graph:
  requires: []
  provides: [scripts/plan-gate.js, validatePlan, formatReport, countTableRows, countContracts, countValidationScenarios, getStatus]
  affects: [gsd-plan execution pipeline]
tech_stack:
  added: []
  patterns: [structural-markdown-validation, regex-section-parsing, exit-code-gate]
key_files:
  created: [scripts/plan-gate.js]
  modified: []
decisions:
  - "plan-gate.js lives in rlhf/scripts/ (not scripts/__tests__) — it's a CLI tool, not a test runner"
  - "validatePlan gates on: >=3 clarifying questions, >=1 interface/type contract, >=2 validation checklist items, Status != COMPLETE"
  - "countTableRows subtracts header + separator rows from markdown table line count"
  - "getStatus returns null (not empty string) when Status section missing — consistent with null-safe callers"
metrics:
  duration: 3min
  completed: 2026-03-04
  tasks: 1
  files: 1
---

# Phase 8 Plan 02: plan-gate.js Port Summary

Ported Subway's plan-gate.js to rlhf/scripts/ as a structural PRD validation gate.

## What Was Built

`scripts/plan-gate.js` — PRD markdown structural validation with 4 gates:

1. **Clarifying Questions**: `>= 3` resolved questions in table (countTableRows)
2. **Contracts Defined**: `>= 1` interface/type keyword in Contracts code block (countContracts)
3. **Validation Checklist**: `>= 2` unchecked `[ ]` items (countValidationScenarios)
4. **Status**: not `COMPLETE` — prevents re-approving finished plans (getStatus)

CLI: `node scripts/plan-gate.js <plan.md> [--json]` — exits 0 on pass, 1 on block.

## Deviations from Plan

None — executed exactly as specified.

## Self-Check: PASSED

- scripts/plan-gate.js: EXISTS
- validatePlan exported: CONFIRMED
- invalid PRD returns allPass=false: CONFIRMED
- valid PRD returns allPass=true: CONFIRMED
- prove-loop-closure.js LOOP-02: PASS
