---
phase: 01-contract-alignment
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/contract-audit.js
  - proof/contract-audit-report.md
autonomous: true
requirements:
  - CNTR-01

must_haves:
  truths:
    - "Running node scripts/contract-audit.js produces a non-empty markdown report listing shared, rlhf-only, and subway-only exports for all 3 shared scripts"
    - "The report correctly identifies feedback-loop.js as INCOMPATIBLE (captureFeedback vs recordFeedback divergence)"
    - "The report correctly identifies feedback-schema.js as COMPATIBLE at the export level (7 shared exports)"
    - "The report correctly identifies export-dpo-pairs.js as PARTIALLY COMPATIBLE (5 shared, 3 rlhf-only, 1 subway-only)"
    - "proof/contract-audit-report.md exists and contains the alias map as evidence for CNTR-01"
  artifacts:
    - path: "scripts/contract-audit.js"
      provides: "Runtime export compatibility auditor for 3 shared scripts across both repos"
      min_lines: 60
    - path: "proof/contract-audit-report.md"
      provides: "CNTR-01 evidence: alias map with compatibility verdict per script"
      contains: "feedback-loop.js"
  key_links:
    - from: "scripts/contract-audit.js"
      to: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema.js"
      via: "require() with absolute path"
      pattern: "require.*Subway_RN_Demo.*feedback-schema"
    - from: "scripts/contract-audit.js"
      to: "proof/contract-audit-report.md"
      via: "fs.writeFileSync"
      pattern: "writeFileSync.*contract-audit-report"
---

<objective>
Create scripts/contract-audit.js that programmatically loads all 3 shared scripts from both repos at runtime, compares export shapes, and writes proof/contract-audit-report.md with a complete alias map.

Purpose: Establish machine-verifiable evidence of export compatibility (CNTR-01) before any code is moved between repos. The report becomes the authoritative alias map for Phase 2 and 3 planners.
Output: scripts/contract-audit.js (runnable), proof/contract-audit-report.md (evidence artifact)
</objective>

<execution_context>
@/Users/ganapolsky_i/.claude/get-shit-done/workflows/execute-plan.md
@/Users/ganapolsky_i/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-contract-alignment/1-RESEARCH.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write contract-audit.js — runtime export shape auditor</name>
  <files>scripts/contract-audit.js</files>
  <action>
Create scripts/contract-audit.js using ONLY Node.js built-ins (path, fs, require). No external dependencies.

The script must:
1. Define THUMBGATE_ROOT = path.join(__dirname, '..') and SUBWAY_ROOT = '/Users/ganapolsky_i/workspace/git/Subway_RN_Demo'
2. Define SHARED_SCRIPTS = ['scripts/feedback-schema.js', 'scripts/feedback-loop.js', 'scripts/export-dpo-pairs.js']
3. For each script, require() it from both repos and compute:
   - rlhfKeys: Object.keys(rlhfMod).sort()
   - subwayKeys: Object.keys(subwayMod).sort()
   - shared: keys present in both
   - rlhfOnly: keys in rlhf but not subway
   - subwayOnly: keys in subway but not rlhf
   - compatible: boolean — true only if rlhfOnly.length === 0 AND subwayOnly.length === 0
4. Build a result array from all 3 scripts
5. console.log a JSON summary
6. Write proof/contract-audit-report.md with:
   - Header: "# Contract Audit Report\n\nGenerated: {new Date().toISOString()}"
   - For each script: a section with compatibility verdict, shared exports table, rlhf-only list, subway-only list
   - Footer: "## Alias Map\n\n| Function | RLHF Export | Subway Export | Status |\n|---|---|---|---|\n" plus one row for each notable divergence (captureFeedback/recordFeedback, feedbackSummary signature difference, selfScore rlhf-absent, validateMemoryStructure subway-only)
   - Final line: "All 3 scripts audited. Baseline CI: 54 node-runner tests + 23 script-runner tests = 77 total passing."

Known expected results (from research — do NOT change these):
- feedback-schema.js: compatible=true (7 shared exports: validateFeedbackMemory, resolveFeedbackAction, prepareForStorage, GENERIC_TAGS, MIN_CONTENT_LENGTH, VALID_TITLE_PREFIXES, VALID_CATEGORIES)
- feedback-loop.js: compatible=false (shared: analyzeFeedback, feedbackSummary; rlhf-only: captureFeedback, buildPreventionRules, writePreventionRules, readJSONL, getFeedbackPaths, MEMORY_LOG_PATH, SUMMARY_PATH, PREVENTION_RULES_PATH; subway-only: recordFeedback, selfScore, SELF_SCORE_LOG_PATH)
- export-dpo-pairs.js: compatible=false (shared: extractDomainKeys, domainOverlap, inferPrompt, buildDpoPairs, toJSONL; rlhf-only: readJSONL, exportDpoFromMemories, DEFAULT_LOCAL_MEMORY_LOG; subway-only: validateMemoryStructure)

If require() fails for Subway (path not found), emit an error to stderr and exit 1. Do NOT silently skip.

Add CLI: when run as main (require.main === module), execute the audit and write the report. Export { auditScript } for testability.
  </action>
  <verify>
Run: node scripts/contract-audit.js
Expected: JSON output printed to stdout, proof/contract-audit-report.md created.
Check: cat proof/contract-audit-report.md | grep -c "INCOMPATIBLE\|COMPATIBLE" should return >= 3 (one verdict per script).
Check: grep "captureFeedback" proof/contract-audit-report.md should return a match.
  </verify>
  <done>
node scripts/contract-audit.js exits 0, prints JSON with 3 script results, proof/contract-audit-report.md exists and contains compatibility verdicts and alias map for all 3 scripts.
  </done>
</task>

<task type="auto">
  <name>Task 2: Verify audit output matches known divergence map from research</name>
  <files>proof/contract-audit-report.md</files>
  <action>
After Task 1 completes, validate the generated proof/contract-audit-report.md against the known divergence map from research (1-RESEARCH.md).

Run node scripts/contract-audit.js and capture stdout as JSON. Assert:
1. feedback-schema.js result: compatible === true, shared.length === 7, rlhfOnly.length === 0, subwayOnly.length === 0
2. feedback-loop.js result: compatible === false, shared includes 'analyzeFeedback' and 'feedbackSummary', rlhfOnly includes 'captureFeedback', subwayOnly includes 'recordFeedback' and 'selfScore'
3. export-dpo-pairs.js result: compatible === false, shared includes 'buildDpoPairs' and 'toJSONL', rlhfOnly includes 'exportDpoFromMemories', subwayOnly includes 'validateMemoryStructure'

If any assertion fails: update proof/contract-audit-report.md with the ACTUAL output (do not fabricate — real runtime values are authoritative). Then re-check the research notes and note any discrepancy in the report's "Discrepancies" section.

Also run: npm test
Expected: All existing tests pass (54 node-runner + 23 script-runner). The audit script must NOT break any existing test. If npm test fails after adding contract-audit.js, diagnose the failure — contract-audit.js must not execute side effects on require().
  </action>
  <verify>
node scripts/contract-audit.js exits 0 with valid JSON output.
npm test exits 0 (all 77 tests pass — audit script added no regressions).
proof/contract-audit-report.md contains lines matching: "feedback-loop.js" AND "INCOMPATIBLE" AND "captureFeedback" AND "recordFeedback".
  </verify>
  <done>
Audit JSON output matches known divergence map OR discrepancies are documented in proof/contract-audit-report.md. npm test green. CNTR-01 evidence artifact complete.
  </done>
</task>

</tasks>

<verification>
1. node scripts/contract-audit.js exits 0 and emits 3-script JSON
2. proof/contract-audit-report.md exists with alias map and compatibility verdicts
3. npm test exits 0 — no regressions
4. grep "captureFeedback" proof/contract-audit-report.md returns a match
5. grep "INCOMPATIBLE" proof/contract-audit-report.md returns >= 1 match
</verification>

<success_criteria>
- scripts/contract-audit.js loads both repos via require() and produces a runtime export diff
- proof/contract-audit-report.md contains the alias map with verdicts for all 3 shared scripts
- All 77 existing rlhf tests continue to pass
- CNTR-01 is satisfied: the report is the machine-generated evidence of export compatibility state
</success_criteria>

<output>
After completion, create .planning/phases/01-contract-alignment/1-01-SUMMARY.md with:
- What was built (contract-audit.js, proof report)
- Actual compatibility verdicts for all 3 scripts
- Any discrepancies vs research
- Baseline test count confirmed (node-runner: 54, script-runner: 23)
</output>
