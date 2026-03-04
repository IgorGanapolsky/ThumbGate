---
phase: 04-lancedb-vector-storage
plan: "01"
subsystem: vector-storage
tags: [lancedb, vector-store, esm-cjs-compat, embeddings, huggingface-transformers]
dependency_graph:
  requires: []
  provides: [scripts/vector-store.js, lancedb-deps-installed]
  affects: [scripts/feedback-loop.js, package.json]
tech_stack:
  added:
    - "@lancedb/lancedb@0.26.2 — embedded vector DB (ESM-only, dynamic import via getLanceDB())"
    - "apache-arrow@18.1.0 — Arrow serialization peer dep (pinned; 19+ incompatible with LanceDB 0.26.2)"
    - "@huggingface/transformers@3.8.1 — ONNX local embedding via all-MiniLM-L6-v2 (384 dims)"
  patterns:
    - "Dynamic import() inside async function — only correct CJS/ESM bridge for ESM-only packages"
    - "Module-level singleton cache (_lancedb, _pipeline) — avoids 200ms ESM re-import on every call"
    - "Float32Array.from() conversion before LanceDB add() — required for Arrow FixedSizeList schema"
key_files:
  created:
    - scripts/vector-store.js
  modified:
    - package.json
    - package-lock.json
decisions:
  - "Dynamic import pattern (await import()) is the only CJS-compatible approach for ESM-only @lancedb/lancedb"
  - "apache-arrow pinned to 18.1.0 — LanceDB 0.26.2 peer dep is >=15.0.0 <=18.1.0; arrow 19+ breaks"
  - "@huggingface/transformers@3.8.1 (not @xenova/transformers which is the v2 deprecated package)"
  - "TABLE_NAME = rlhf_memories — JS-only table; never shared with Python Subway tables"
metrics:
  duration: "1m 2s"
  completed: "2026-03-04T20:01:59Z"
  tasks_completed: 2
  files_modified: 3
---

# Phase 4 Plan 01: LanceDB + Transformers Install and vector-store.js Summary

**One-liner:** LanceDB 0.26.2 + HuggingFace Transformers 3.8.1 + Arrow 18.1.0 installed with dynamic import CJS wrapper providing upsertFeedback() and searchSimilar() for rlhf_memories table.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install pinned dependencies | de322c4 | package.json, package-lock.json |
| 2 | Create scripts/vector-store.js | 8e6adc8 | scripts/vector-store.js |

## What Was Built

### Task 1: Install pinned dependencies

Three npm packages installed at exact required versions:
- `@lancedb/lancedb@^0.26.2` — ESM-only embedded vector database
- `apache-arrow@^18.1.0` — Arrow serialization, peer dep of LanceDB (must be <=18.1.0)
- `@huggingface/transformers@^3.8.1` — ONNX embedding pipeline, replaces deprecated @xenova/transformers

The deprecated `boolean@3.2.0` warning from @huggingface/transformers is a transitive dep warning — expected and non-blocking.

### Task 2: Create scripts/vector-store.js

CJS module (`'use strict'`) wrapping LanceDB via dynamic import pattern:

```javascript
// Never require() — only dynamic import inside async functions
async function getLanceDB() {
  if (!_lancedb) _lancedb = await import('@lancedb/lancedb');
  return _lancedb;
}
```

Key design decisions:
- `_lancedb` and `_pipeline` module-level caches — first import ~200ms, subsequent ~0ms
- `embed()` converts `Float32Array` output to `number[]` via `Array.from()` — required for Arrow FixedSizeList schema
- `upsertFeedback()` checks `db.tableNames()` to decide create vs add
- `searchSimilar()` returns `[]` if table doesn't exist yet (safe default)
- `RLHF_FEEDBACK_DIR` env var support for test isolation
- TABLE_NAME = `'rlhf_memories'` — JS-only table, never crosses into Python Subway tables

## Verification Evidence

```
$ node -e "const vs = require('./scripts/vector-store'); console.log(Object.keys(vs))"
[ 'upsertFeedback', 'searchSimilar', 'TABLE_NAME' ]

$ grep "await import" scripts/vector-store.js
    _lancedb = await import('@lancedb/lancedb');
    const { pipeline } = await import('@huggingface/transformers');

$ grep "require.*lancedb" scripts/vector-store.js
(no output — correct)

$ node -e "const p = require('./package.json'); ['@lancedb/lancedb','apache-arrow','@huggingface/transformers'].forEach(d => console.log(d, p.dependencies[d]))"
@lancedb/lancedb ^0.26.2
apache-arrow ^18.1.0
@huggingface/transformers ^3.8.1
```

All four plan verification checks pass.

## Requirements Coverage

| Req | Description | Status |
|-----|-------------|--------|
| VEC-01 | LanceDB embedded table stores feedback vectors | DONE — upsertFeedback() creates/appends to rlhf_memories table |
| VEC-02 | ESM/CJS compatibility via dynamic import | DONE — getLanceDB() uses await import(), no require() calls |
| VEC-03 | apache-arrow pinned to <=18.1.0 | DONE — apache-arrow@18.1.0 in package.json |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- scripts/vector-store.js: FOUND
- package.json updated with @lancedb/lancedb, apache-arrow, @huggingface/transformers: FOUND
- Commit de322c4 (Task 1): FOUND
- Commit 8e6adc8 (Task 2): FOUND
- No require('@lancedb/lancedb') in vector-store.js: CONFIRMED
- Two dynamic import() calls present: CONFIRMED
