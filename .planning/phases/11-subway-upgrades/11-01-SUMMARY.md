---
phase: 11-subway-upgrades
plan: "01"
subsystem: subway-upgrades
tags: [lancedb, vector-store, subway, rlhf]
dependency_graph:
  requires: [rlhf/scripts/vector-store.js]
  provides: [Subway/.claude/scripts/feedback/vector-store.js]
  affects: [Subway captureFeedback pipeline]
tech_stack:
  added: [lancedb (Subway)]
  patterns: [dynamic-import-esm-cjs, stub-embed-testing, 3-level-path-resolution]
key_files:
  created: [Subway/.claude/scripts/feedback/vector-store.js]
  modified: []
decisions:
  - "PROJECT_ROOT = path.join(__dirname, '..', '..', '..') — 3 levels up from .claude/scripts/feedback/"
  - "THUMBGATE_VECTOR_STUB_EMBED=true returns deterministic 384-dim unit vector — no ONNX download in tests"
  - "TABLE_NAME = thumbgate_memories — JS-only table, same as rlhf for cross-language compatibility"
  - "Jest tests require NODE_OPTIONS=--experimental-vm-modules for dynamic import() support"
metrics:
  duration: 4min
  completed: 2026-03-04
  tasks: 1
  files: 1
---

# Phase 11 Plan 01: LanceDB Vector Store Port to Subway Summary

Ported rlhf's vector-store.js to Subway's .claude/scripts/feedback/ with 3-level path adjustment and Jest tests.

## What Was Built

`Subway/.claude/scripts/feedback/vector-store.js` — LanceDB vector store port:
- Identical API to rlhf: `upsertFeedback(event)`, `searchSimilar(query, limit)`, `TABLE_NAME`
- PATH fix: PROJECT_ROOT uses 3 levels up (not 1 level as in rlhf)
- Stub embed: THUMBGATE_VECTOR_STUB_EMBED=true for Jest test isolation

`Subway/scripts/__tests__/vector-store.test.js` — 6 Jest tests:
- TABLE_NAME equals 'thumbgate_memories'
- upsertFeedback creates LanceDB table on first upsert
- upsertFeedback adds to existing table on second upsert
- searchSimilar returns empty array when no data
- searchSimilar returns results after upsert
- loads without error in stub mode

## Deviations from Plan

**[Rule 2 - Missing Critical]** Added `NODE_OPTIONS=--experimental-vm-modules` to Subway's test:governance script in package.json — required for dynamic import() in Jest

## Self-Check: PASSED

- Subway/vector-store.js: EXISTS
- Subway/vector-store.test.js: EXISTS (6 tests, 0 failures)
- prove-subway-upgrades.js SUBW-01: PASS
