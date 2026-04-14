---
phase: 04-lancedb-vector-storage
plan: "02"
type: execute
wave: 2
depends_on:
  - "4-01"
files_modified:
  - scripts/feedback-loop.js
autonomous: true
requirements:
  - VEC-01

must_haves:
  truths:
    - "Every captureFeedback() call triggers a non-blocking vectorStore.upsertFeedback() side-effect"
    - "A failure in vector storage never propagates to the caller — primary JSONL write is the source of truth"
    - "getVectorStoreModule() follows the exact same try/catch lazy-require pattern as getContextFsModule()"
  artifacts:
    - path: "scripts/feedback-loop.js"
      provides: "Vector store integration in captureFeedback()"
      contains: "getVectorStoreModule"
  key_links:
    - from: "scripts/feedback-loop.js"
      to: "scripts/vector-store.js"
      via: "require('./vector-store') inside getVectorStoreModule() try/catch"
      pattern: "require\\('./vector-store'\\)"
    - from: "captureFeedback() in feedback-loop.js"
      to: "vectorStore.upsertFeedback()"
      via: "non-blocking .catch(() => {}) pattern after primary write"
      pattern: "upsertFeedback.*\\.catch"
---

<objective>
Wire the vector-store.js module into feedback-loop.js as a non-blocking side-effect in captureFeedback(), following the identical pattern already used for appendSequence() and updateDiversityTracking().

Purpose: Every feedback capture automatically indexes the entry in LanceDB for later semantic search — without risking the primary JSONL write.
Output: Modified scripts/feedback-loop.js with getVectorStoreModule() helper and upsertFeedback() call after primary write.
</objective>

<execution_context>
@/Users/ganapolsky_i/.claude/get-shit-done/workflows/execute-plan.md
@/Users/ganapolsky_i/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@docs/planning/ROADMAP.md
@docs/planning/STATE.md
@docs/planning/phases/04-lancedb-vector-storage/4-RESEARCH.md
@scripts/feedback-loop.js
@docs/planning/phases/04-lancedb-vector-storage/4-01-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add getVectorStoreModule() helper and upsertFeedback side-effect to feedback-loop.js</name>
  <files>scripts/feedback-loop.js</files>
  <action>
    Read /Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/feedback-loop.js in full before making any edits.

    STEP 1: Add `getVectorStoreModule()` helper function.

    Place it immediately after the `getContextFsModule()` function (around line 50). Pattern is identical to `getContextFsModule()`:

    ```javascript
    function getVectorStoreModule() {
      try {
        return require('./vector-store');
      } catch {
        return null;
      }
    }
    ```

    STEP 2: Wire the non-blocking upsertFeedback() call in captureFeedback().

    Location: After the updateDiversityTracking() try/catch block (currently the last ML side-effect before `summary.accepted += 1`). Add:

    ```javascript
      // Vector storage side-effect (non-blocking — primary write already succeeded)
      const vectorStore = getVectorStoreModule();
      if (vectorStore) {
        vectorStore.upsertFeedback(feedbackEvent).catch(() => {
          // Non-critical; primary feedback log is the source of truth
        });
      }
    ```

    CRITICAL: This block MUST be placed AFTER `appendJSONL(FEEDBACK_LOG_PATH, feedbackEvent)` and AFTER the existing ML side-effects (appendSequence, updateDiversityTracking). The primary write must always succeed first.

    Do NOT change any other logic. Do NOT add awaits — the entire point is non-blocking async fire-and-forget.
  </action>
  <verify>
    1. grep -n "getVectorStoreModule\|upsertFeedback" /Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/feedback-loop.js
       Expected: Shows getVectorStoreModule function definition and the upsertFeedback().catch() call inside captureFeedback.

    2. node scripts/feedback-loop.js --test
       Expected: All existing tests pass. The vector side-effect fires but since no table exists yet it silently fails (caught by .catch).

    3. npm test
       Expected: All tests pass with same count as before this plan. The wiring must not break existing test suite.
  </verify>
  <done>
    - getVectorStoreModule() function exists in feedback-loop.js.
    - vectorStore.upsertFeedback(feedbackEvent).catch(() => {}) block exists after updateDiversityTracking in captureFeedback().
    - npm test passes with no regressions.
  </done>
</task>

</tasks>

<verification>
Run from /Users/ganapolsky_i/workspace/git/igor/ThumbGate:
1. `grep -c "getVectorStoreModule" scripts/feedback-loop.js` → 2 (definition + usage)
2. `grep -A3 "upsertFeedback" scripts/feedback-loop.js` → shows the .catch pattern
3. `npm test` → exits 0, test count same as Phase 3 baseline (89+ tests)
</verification>

<success_criteria>
- getVectorStoreModule() helper is defined following the getContextFsModule() pattern.
- upsertFeedback().catch() is called after primary write in captureFeedback().
- npm test passes with no regressions.
- No await added to the upsertFeedback call in the main function body (fire-and-forget).
</success_criteria>

<output>
After completion, create `docs/planning/phases/04-lancedb-vector-storage/4-02-SUMMARY.md`
</output>
