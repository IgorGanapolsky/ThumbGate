---
phase: 04-lancedb-vector-storage
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - scripts/vector-store.js
autonomous: true
requirements:
  - VEC-01
  - VEC-02
  - VEC-03

must_haves:
  truths:
    - "scripts/vector-store.js exports upsertFeedback() and searchSimilar() as async CJS functions"
    - "No require('@lancedb/lancedb') call exists — only dynamic import() inside async functions"
    - "apache-arrow is pinned to 18.1.0 in package.json (not 19+ or latest)"
    - "@lancedb/lancedb@0.26.2 and @huggingface/transformers@3.8.1 appear in package.json"
  artifacts:
    - path: "scripts/vector-store.js"
      provides: "LanceDB wrapper with upsertFeedback() and searchSimilar()"
      exports:
        - upsertFeedback
        - searchSimilar
        - TABLE_NAME
      contains: "await import('@lancedb/lancedb')"
    - path: "package.json"
      provides: "Pinned dependencies"
      contains: "@lancedb/lancedb"
  key_links:
    - from: "scripts/vector-store.js"
      to: "@lancedb/lancedb"
      via: "dynamic import inside getLanceDB() async function"
      pattern: "await import\\('@lancedb/lancedb'\\)"
    - from: "scripts/vector-store.js"
      to: "@huggingface/transformers"
      via: "dynamic import inside getEmbeddingPipeline() async function"
      pattern: "await import\\('@huggingface/transformers'\\)"
---

<objective>
Install LanceDB, Arrow, and HuggingFace Transformers, then create the vector-store.js module with dynamic-import ESM/CJS compatibility.

Purpose: thumbgate is CommonJS but @lancedb/lancedb is ESM-only. The dynamic import pattern is the only correct approach — this plan establishes the integration boundary with zero ERR_REQUIRE_ESM errors.
Output: package.json with pinned deps, scripts/vector-store.js with upsertFeedback() and searchSimilar().
</objective>

<execution_context>
@/Users/ganapolsky_i/.claude/get-shit-done/workflows/execute-plan.md
@/Users/ganapolsky_i/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/04-lancedb-vector-storage/4-RESEARCH.md
@scripts/feedback-loop.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install pinned dependencies</name>
  <files>package.json</files>
  <action>
    Run the following installs in order from the ThumbGate project root (/Users/ganapolsky_i/workspace/git/igor/ThumbGate):

    ```bash
    npm install @lancedb/lancedb@0.26.2
    npm install apache-arrow@18.1.0
    npm install @huggingface/transformers@3.8.1
    ```

    CRITICAL constraints:
    - apache-arrow MUST be pinned to exactly 18.1.0 — NOT latest (21.x), NOT 19.x. LanceDB 0.26.2 peer dep requires >=15.0.0 <=18.1.0. Arrow 19+ causes runtime Arrow schema errors.
    - @lancedb/lancedb MUST be 0.26.2 — NOT 0.27.0-beta.* (napi-rs v3 breaking changes, binary loading unstable).
    - @huggingface/transformers MUST be 3.8.1 — NOT @xenova/transformers (old package name for v2). onnxruntime-node is pulled transitively; do NOT pin it separately.

    After install, verify package.json contains all three packages at the correct versions. If npm produces WARN peer dep or ERESOLVE for arrow, it is expected due to the forced pin — use `--legacy-peer-deps` flag only if npm refuses.
  </action>
  <verify>
    node -e "const p = require('./package.json'); console.log(p.dependencies['@lancedb/lancedb'], p.dependencies['apache-arrow'], p.dependencies['@huggingface/transformers'])"
    Expected output: 0.26.2 (or ^0.26.2), 18.1.0 (or ^18.1.0), 3.8.1 (or ^3.8.1)
  </verify>
  <done>All three packages appear in package.json dependencies at the specified versions. npm install exits 0.</done>
</task>

<task type="auto">
  <name>Task 2: Create scripts/vector-store.js with dynamic import pattern</name>
  <files>scripts/vector-store.js</files>
  <action>
    Create /Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/vector-store.js using the exact implementation from 4-RESEARCH.md Pattern 1 + Pattern 3.

    Key requirements:
    1. File starts with `'use strict';` — project is CJS.
    2. Module-level `_lancedb = null` and `_pipeline = null` caches — prevents re-importing on every upsertFeedback() call (first ESM import takes ~200ms; second is instant from cache).
    3. `getLanceDB()` does `_lancedb = await import('@lancedb/lancedb')` — NEVER `require()`.
    4. `getEmbeddingPipeline()` does `await import('@huggingface/transformers')` then `pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true })`.
    5. `embed(text)` calls the pipeline with `{ pooling: 'mean', normalize: true }` and returns `Array.from(output.data)` — MUST convert Float32Array to plain number[] or LanceDB throws TypeError on Arrow serialization.
    6. `upsertFeedback(feedbackEvent)` builds `lanceDir` from `process.env.THUMBGATE_FEEDBACK_DIR` (appending `/lancedb`) OR falls back to `path.join(PROJECT_ROOT, '.claude', 'memory', 'feedback', 'lancedb')`. Calls `db.tableNames()` to check if table exists, uses `db.openTable()` + `table.add([record])` if yes, `db.createTable(TABLE_NAME, [record])` if no. Table name: `'thumbgate_memories'`.
    7. Record schema: `{ id, text, vector, signal, tags, timestamp, context }` where:
       - `text` = joined string of feedbackEvent.context, feedbackEvent.tags, feedbackEvent.whatWentWrong, feedbackEvent.whatWorked (filtered, joined with '. ')
       - `tags` = `(feedbackEvent.tags || []).join(',')` (stored as string)
       - `vector` = result of embed(text) as plain number[]
    8. `searchSimilar(queryText, limit = 5)` checks table exists, embeds queryText, calls `table.search(vector).limit(limit).toArray()`, returns results (empty array if table missing).
    9. `module.exports = { upsertFeedback, searchSimilar, TABLE_NAME }`.

    PROJECT_ROOT = `path.join(__dirname, '..')` (one level up from scripts/ to repo root).

    Do NOT add anything not in this spec. The module must remain under ~100 lines.
  </action>
  <verify>
    node -e "const vs = require('./scripts/vector-store'); console.log(typeof vs.upsertFeedback, typeof vs.searchSimilar, vs.TABLE_NAME)"
    Expected: function function thumbgate_memories
    Also verify no require('@lancedb/lancedb') exists:
    grep -n "require.*lancedb" /Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/vector-store.js
    Expected: no output (only dynamic import() should be present)
  </verify>
  <done>
    - require('./scripts/vector-store') loads without error.
    - upsertFeedback and searchSimilar are functions.
    - TABLE_NAME === 'thumbgate_memories'.
    - No require('@lancedb/lancedb') in file (only dynamic import).
  </done>
</task>

</tasks>

<verification>
Run from /Users/ganapolsky_i/workspace/git/igor/ThumbGate:
1. `node -e "const vs = require('./scripts/vector-store'); console.log(Object.keys(vs))"` → prints [ 'upsertFeedback', 'searchSimilar', 'TABLE_NAME' ]
2. `grep "await import" scripts/vector-store.js` → shows two dynamic imports (lancedb + transformers)
3. `grep "require.*lancedb" scripts/vector-store.js` → no output
4. `node -e "const p = require('./package.json'); ['@lancedb/lancedb','apache-arrow','@huggingface/transformers'].forEach(d => console.log(d, p.dependencies[d]))"` → all three at correct versions
</verification>

<success_criteria>
- package.json: @lancedb/lancedb@0.26.2, apache-arrow@18.1.0, @huggingface/transformers@3.8.1 in dependencies
- scripts/vector-store.js: exports upsertFeedback, searchSimilar, TABLE_NAME
- Zero require() calls to @lancedb/lancedb — only dynamic import()
- Module loads in CJS environment without ERR_REQUIRE_ESM
</success_criteria>

<output>
After completion, create `.planning/phases/04-lancedb-vector-storage/4-01-SUMMARY.md`
</output>
