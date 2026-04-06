---
phase: 04-lancedb-vector-storage
plan: "03"
type: tdd
wave: 2
depends_on:
  - "4-01"
files_modified:
  - tests/vector-store.test.js
autonomous: true
requirements:
  - VEC-04
  - VEC-05

must_haves:
  truths:
    - "upsertFeedback() stores a record and searchSimilar() retrieves it by semantic similarity"
    - "Tests use node --test runner with real tmpdir — no jest, no mocks of the LanceDB layer"
    - "Embedding is stubbed (fixed 384-dim vector) to avoid HuggingFace CDN download in unit tests"
    - "Tests clean up tmpdir in finally block — no leftover state between runs"
    - "All vector-store.test.js tests pass when run via node --test"
  artifacts:
    - path: "tests/vector-store.test.js"
      provides: "Unit tests for vector-store.js"
      contains: "node:test"
  key_links:
    - from: "tests/vector-store.test.js"
      to: "scripts/vector-store.js"
      via: "require('../scripts/vector-store') after env var set"
      pattern: "require\\('\\.\\./scripts/vector-store'\\)"
    - from: "tests/vector-store.test.js"
      to: "process.env.THUMBGATE_FEEDBACK_DIR"
      via: "tmpdir injection before module require"
      pattern: "THUMBGATE_FEEDBACK_DIR.*tmpDir"
---

<objective>
TDD: Write tests for vector-store.js covering upsertFeedback() persistence and searchSimilar() semantic retrieval. Tests stub the embedding function to avoid network dependency.

Purpose: Prove VEC-04 (semantic search returns relevant results) and VEC-05 (integration has tests) without network dependencies or test instability.
Output: tests/vector-store.test.js with RED→GREEN cycle complete.
</objective>

<execution_context>
@/Users/ganapolsky_i/.claude/get-shit-done/workflows/execute-plan.md
@/Users/ganapolsky_i/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/04-lancedb-vector-storage/4-RESEARCH.md
@scripts/vector-store.js
@tests/thompson-sampling.test.js
@.planning/phases/04-lancedb-vector-storage/4-01-SUMMARY.md
</context>

<feature>
  <name>LanceDB vector-store unit tests</name>
  <files>tests/vector-store.test.js, scripts/vector-store.js</files>
  <behavior>
    Test cases and expected behaviors:

    1. upsertFeedback() creates table on first call and returns without error
       Input: feedbackEvent { id: 'fb_001', signal: 'positive', context: 'Tests passed', tags: ['testing'], timestamp: ISO string }
       Expected: resolves without throwing; tmpDir/lancedb/ directory created

    2. searchSimilar() returns empty array when table does not exist
       Input: queryText = 'any query', tmpDir with no lancedb/ inside
       Expected: returns []

    3. upsertFeedback() then searchSimilar() returns the inserted record
       Input: insert fb_001 with context 'tests passed with full coverage', then search 'tests passing with evidence'
       Expected: results.length >= 1; results[0].id === 'fb_001'; results[0].signal === 'positive'

    4. Multiple upserts, searchSimilar returns correct top-k ranked results
       Input: insert fb_001 (context 'test coverage verified'), fb_002 (context 'budget limit exceeded'), search 'test verification'
       Expected: results.length >= 1; results[0].id === 'fb_001' (semantic nearest)

    Embedding strategy: To avoid HuggingFace CDN download, override the module's internal embed function by
    monkey-patching process.env or by requiring a local override. The safest approach:
    - Set THUMBGATE_VECTOR_STUB_EMBED=true before requiring vector-store.js
    - In vector-store.js, check this env var in embed() to return a deterministic 384-dim stub vector
      (e.g., Array(384).fill(0).map((_, i) => i === 0 ? 1.0 : 0.0) for all inputs — this is fine for unit tests since we only care about storage/retrieval, not ranking accuracy)
    - NOTE: The real embed() is still used in integration tests (gated by THUMBGATE_VEC_INTEGRATION=true env var)

    ALTERNATIVELY (simpler): Patch vector-store.js to export an internal `_setEmbedFn(fn)` function
    that tests can call to inject a stub. This avoids env var complexity. Use whichever approach
    is cleaner given the existing module structure.

    Use `require.cache` invalidation between tests that need fresh module state:
    delete require.cache[require.resolve('../scripts/vector-store')];

    Every test must use mkdtempSync + finally block for cleanup.
  </behavior>
  <implementation>
    RED: Write tests/vector-store.test.js with all 4 test cases. Run `node --test tests/vector-store.test.js` — tests MUST fail (module has no stub support yet).

    GREEN: Update scripts/vector-store.js to support embedding stub (either env var or _setEmbedFn export). Run `node --test tests/vector-store.test.js` — tests MUST pass. Run `npm test` — all existing tests must still pass.

    REFACTOR: If vector-store.js has any dead code, clean it. Run tests again.

    Commit messages:
    - RED: `test(04-03): add failing vector-store tests`
    - GREEN: `feat(04-03): add stub embed support to pass vector-store tests`
    - REFACTOR (if needed): `refactor(04-03): clean up vector-store module`
  </implementation>
</feature>

<verification>
Run from /Users/ganapolsky_i/workspace/git/igor/rlhf:
1. `node --test tests/vector-store.test.js` → all tests pass, output shows test names
2. `npm test` → exits 0, no regressions vs Phase 3 baseline
3. `grep -c "test(" tests/vector-store.test.js` → at least 4 test cases
</verification>

<success_criteria>
- tests/vector-store.test.js has at least 4 test cases.
- All 4 pass when run with node --test.
- npm test exits 0 with no regressions.
- Tests use tmpdir + finally cleanup — no leftover state.
- HuggingFace network call is stubbed so tests run offline.
</success_criteria>

<output>
After completion, create `.planning/phases/04-lancedb-vector-storage/4-03-SUMMARY.md`
</output>
