---
phase: 08-loop-closure
plan: "04"
subsystem: loop-closure
tags: [feedback-to-memory, mcp-memory, schema-validation, rlhf]
dependency_graph:
  requires: [scripts/feedback-schema.js]
  provides: [scripts/feedback-to-memory.js, convertFeedbackToMemory]
  affects: [mcp__memory__remember integration]
tech_stack:
  added: []
  patterns: [stdin-json-pipeline, mcp-memory-schema, validation-boundary]
key_files:
  created: [scripts/feedback-to-memory.js]
  modified: []
decisions:
  - "feedback-to-memory.js delegates to resolveFeedbackAction + prepareForStorage from feedback-schema.js — reuses existing validation logic"
  - "convertFeedbackToMemory returns { ok, actionType, memory } on success — structural parity with Subway's round-trip format"
  - "stdin mode for pipeline integration: echo '{}' | node feedback-to-memory.js"
  - "bare negative/positive without context returns ok=false with reason — prevents empty memories"
metrics:
  duration: 3min
  completed: 2026-03-04
  tasks: 1
  files: 1
---

# Phase 8 Plan 04: feedback-to-memory.js Port + Test Suite Summary

Ported Subway's feedback-to-memory.js and created the full loop-closure test suite.

## What Was Built

1. **`scripts/feedback-to-memory.js`** — Stdin JSON to MCP memory format bridge:
   - Delegates to `resolveFeedbackAction()` + `prepareForStorage()` from feedback-schema.js
   - Returns `{ ok: true, actionType, memory }` or `{ ok: false, reason, issues? }`
   - `actionType`: 'store-mistake' (negative) | 'store-learning' (positive)
   - Memory title prefix: 'MISTAKE:' | 'SUCCESS:' per MCP convention
   - CLI: `echo '{"signal":"negative",...}' | node scripts/feedback-to-memory.js`

2. **`tests/loop-closure.test.js`** — 44 node:test cases across 4 describe blocks:
   - feedback-to-rules: 12 tests (parseFeedbackFile, classifySignal, normalize, analyze, toRules)
   - plan-gate: 14 tests (countTableRows, countContracts, countValidationScenarios, getStatus, validatePlan, formatReport)
   - feedback-inbox-read: 9 tests (readInbox, loadCursor, getNewEntries, cursor filtering, strip _lineIndex)
   - feedback-to-memory: 9 tests (valid negative, valid positive, bare rejected, unknown signal, context-only, tags preserved, required fields)

3. **`scripts/prove-loop-closure.js`** — 5-check proof gate (LOOP-01..05)

## Deviations from Plan

None — executed exactly as specified.

## Self-Check: PASSED

- scripts/feedback-to-memory.js: EXISTS
- convertFeedbackToMemory exported: CONFIRMED
- valid negative → MISTAKE: prefix, error category: CONFIRMED
- valid positive → SUCCESS: prefix, learning category: CONFIRMED
- bare negative/positive → rejected: CONFIRMED
- tests/loop-closure.test.js: EXISTS (44 tests, 0 failures)
- prove-loop-closure.js: EXISTS (5/5 LOOP requirements passing)
- proof/loop-closure-report.json: EXISTS
- proof/loop-closure-report.md: EXISTS
