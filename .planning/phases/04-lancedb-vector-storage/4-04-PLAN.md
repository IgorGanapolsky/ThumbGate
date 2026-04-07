---
phase: 04-lancedb-vector-storage
plan: "04"
type: execute
wave: 3
depends_on:
  - "4-01"
  - "4-02"
  - "4-03"
files_modified:
  - scripts/prove-lancedb.js
  - proof/lancedb-report.md
  - package.json
autonomous: true
requirements:
  - VEC-05

must_haves:
  truths:
    - "proof/lancedb-report.md exists and documents pass/fail status for VEC-01 through VEC-05"
    - "npm run prove:lancedb exits 0 and writes the proof report"
    - "VEC-02 evidence in report: references dynamic import() pattern by file and line"
    - "VEC-03 evidence in report: confirms apache-arrow@18.1.0 in package.json"
    - "VEC-05 self-referentially passes: test count delta from Phase 3 baseline is >= 4 new tests"
  artifacts:
    - path: "scripts/prove-lancedb.js"
      provides: "Proof script generating lancedb-report.md"
      contains: "VEC-01"
    - path: "proof/lancedb-report.md"
      provides: "Human-readable evidence for all VEC requirements"
      contains: "VEC-05"
  key_links:
    - from: "scripts/prove-lancedb.js"
      to: "proof/lancedb-report.md"
      via: "fs.writeFileSync to proof dir"
      pattern: "writeFileSync.*lancedb-report"
    - from: "scripts/prove-lancedb.js"
      to: "scripts/vector-store.js"
      via: "require + upsertFeedback + searchSimilar smoke test"
      pattern: "searchSimilar"
---

<objective>
Generate the LanceDB proof report by running a smoke test (insert + search) against a real tmpdir table, then writing proof/lancedb-report.md with per-requirement evidence for VEC-01 through VEC-05.

Purpose: This is the phase gate — without the proof report the phase is not done. Mirrors the prove-adapters.js and prove-automation.js pattern from Phases 2 and 3.
Output: scripts/prove-lancedb.js, proof/lancedb-report.md, npm run prove:lancedb script entry.
</objective>

<execution_context>
@/Users/ganapolsky_i/.claude/get-shit-done/workflows/execute-plan.md
@/Users/ganapolsky_i/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/04-lancedb-vector-storage/4-RESEARCH.md
@scripts/prove-adapters.js
@.planning/phases/04-lancedb-vector-storage/4-01-SUMMARY.md
@.planning/phases/04-lancedb-vector-storage/4-02-SUMMARY.md
@.planning/phases/04-lancedb-vector-storage/4-03-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create scripts/prove-lancedb.js proof script</name>
  <files>scripts/prove-lancedb.js, package.json</files>
  <action>
    Read /Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/prove-adapters.js first to understand the proof report pattern, then create /Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/prove-lancedb.js.

    The script must:
    1. Run a smoke test using real LanceDB (not stub embed): insert a test feedback entry, search for it, verify result returned.
       - Use os.mkdtempSync() for tmpdir; clean up in finally.
       - Set process.env.THUMBGATE_FEEDBACK_DIR = tmpDir before requiring vector-store.
       - Invalidate require.cache before requiring to pick up env var.
       - If THUMBGATE_VECTOR_STUB_EMBED env var is used in vector-store.js, set it to false (or unset) to use real embedding. If the test env has no network, catch and mark VEC-04 as 'warn' (network-dependent) not 'fail'.
    2. Inspect package.json to verify apache-arrow version and lancedb version for VEC-02, VEC-03 evidence.
    3. Grep scripts/vector-store.js for "await import" count to provide VEC-02 file evidence.
    4. Run `node --test tests/vector-store.test.js` as a child_process and capture pass/fail for VEC-05 evidence.
    5. Build a JSON report object with structure matching the proof report pattern from 4-RESEARCH.md:
       ```javascript
       const report = {
         phase: '04-lancedb-vector-storage',
         generated: new Date().toISOString(),
         requirements: {
           'VEC-01': { status: 'pass'|'fail', evidence: '...' },
           'VEC-02': { status: 'pass'|'fail', evidence: '...' },
           'VEC-03': { status: 'pass'|'fail', evidence: '...' },
           'VEC-04': { status: 'pass'|'warn'|'fail', evidence: '...' },
           'VEC-05': { status: 'pass'|'fail', evidence: '...' },
         },
         summary: { passed: N, failed: N, warned: N },
       };
       ```
    6. Write proof/lancedb-report.md as human-readable markdown (mirrors prove-adapters.js output format).
    7. Write proof/lancedb-report.json as the raw JSON (for machine consumption).
    8. Exit 0 if no 'fail' statuses; exit 1 if any 'fail'.

    Add to package.json scripts:
    ```json
    "prove:lancedb": "node scripts/prove-lancedb.js"
    ```
  </action>
  <verify>
    node scripts/prove-lancedb.js
    Expected: exits 0 (or 1 if VEC-04 fails due to network — check proof/lancedb-report.md for details).
    cat proof/lancedb-report.md
    Expected: markdown file with VEC-01 through VEC-05 rows showing pass/warn/fail status.
  </verify>
  <done>
    - scripts/prove-lancedb.js exists and exits 0 (or exits 1 only if VEC-04 is explicitly 'fail' due to network issue — network-gated warn is acceptable).
    - proof/lancedb-report.md exists with all 5 VEC requirement rows.
    - proof/lancedb-report.json exists.
    - npm run prove:lancedb is in package.json scripts.
  </done>
</task>

<task type="auto">
  <name>Task 2: Run npm test and confirm full suite passes; update REQUIREMENTS.md</name>
  <files>proof/lancedb-report.md</files>
  <action>
    STEP 1: Run the full test suite to confirm no regressions:
    ```bash
    cd /Users/ganapolsky_i/workspace/git/igor/ThumbGate && npm test
    ```
    All tests must pass. If any test is broken by Phase 4 additions, fix the breakage before proceeding.

    STEP 2: Update /Users/ganapolsky_i/workspace/git/igor/ThumbGate/.planning/REQUIREMENTS.md — mark VEC-01 through VEC-05 as complete:
    Change:
    ```
    - [ ] **VEC-01**: ...
    - [ ] **VEC-02**: ...
    - [ ] **VEC-03**: ...
    - [ ] **VEC-04**: ...
    - [ ] **VEC-05**: ...
    ```
    To:
    ```
    - [x] **VEC-01**: ...
    - [x] **VEC-02**: ...
    - [x] **VEC-03**: ...
    - [x] **VEC-04**: ...
    - [x] **VEC-05**: ...
    ```
    Also update the Traceability table to show "Complete" for all VEC requirements.

    STEP 3: Append the total test count delta to proof/lancedb-report.md:
    Run `node --test tests/vector-store.test.js 2>&1 | tail -5` to get pass count; document the delta from Phase 3 baseline (89 node-runner tests → 89 + N after Phase 4).
  </action>
  <verify>
    npm test
    Expected: exits 0, all tests pass.
    grep "\- \[x\] \*\*VEC" .planning/REQUIREMENTS.md | wc -l
    Expected: 5
  </verify>
  <done>
    - npm test exits 0 with no regressions.
    - REQUIREMENTS.md shows all 5 VEC requirements as [x] complete.
    - proof/lancedb-report.md documents the test count delta.
  </done>
</task>

</tasks>

<verification>
Run from /Users/ganapolsky_i/workspace/git/igor/ThumbGate:
1. `npm run prove:lancedb` → exits 0, writes proof/lancedb-report.md
2. `npm test` → exits 0, all tests pass
3. `ls proof/lancedb-report.md proof/lancedb-report.json` → both exist
4. `grep -c "VEC-0[1-5]" proof/lancedb-report.md` → 5
5. `grep "\[x\].*VEC" .planning/REQUIREMENTS.md | wc -l` → 5
</verification>

<success_criteria>
- npm run prove:lancedb exits 0.
- proof/lancedb-report.md exists with VEC-01..VEC-05 all documented.
- npm test exits 0 with no regressions from Phase 3.
- REQUIREMENTS.md has all 5 VEC requirements marked [x].
</success_criteria>

<output>
After completion, create `.planning/phases/04-lancedb-vector-storage/4-04-SUMMARY.md`
</output>
