---
phase: 01-contract-alignment
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema.js
autonomous: true
requirements:
  - CNTR-02
  - CNTR-03

must_haves:
  truths:
    - "Subway's resolveFeedbackAction destructures rubricEvaluation from params — not silently dropped"
    - "When rubricEvaluation.promotionEligible is false, Subway's resolveFeedbackAction returns { type: 'no-action', reason: 'Rubric gate prevented promotion: ...' }"
    - "When rubricEvaluation is absent, Subway's resolveFeedbackAction behavior is unchanged (backward-compatible)"
    - "parseTimestamp() exported from Subway's feedback-schema.js returns a Date for Z-suffix, no-suffix, and offset inputs"
    - "parseTimestamp(null) and parseTimestamp('garbage') return null — never NaN"
  artifacts:
    - path: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema.js"
      provides: "rubricEvaluation gate logic + parseTimestamp() helper — matching ThumbGate implementation"
      contains: "rubricEvaluation"
    - path: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema.js"
      provides: "parseTimestamp export"
      contains: "parseTimestamp"
  key_links:
    - from: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema.js"
      to: "resolveFeedbackAction rubricEvaluation gate"
      via: "destructuring + promotionEligible check"
      pattern: "rubricEvaluation"
    - from: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema.js"
      to: "parseTimestamp export"
      via: "module.exports"
      pattern: "parseTimestamp"
---

<objective>
Add rubricEvaluation gate logic and parseTimestamp() helper to Subway's feedback-schema.js, bringing it to parity with ThumbGate's implementation.

Purpose: CNTR-02 requires rubricEvaluation to be handled identically in both repos. CNTR-03 requires parseTimestamp() in both repos. Both changes target the same file (Subway's feedback-schema.js) so they are batched into one plan to avoid a file conflict with Plan 03.
Output: Modified /Subway_RN_Demo/scripts/feedback-schema.js with rubricEvaluation support and parseTimestamp() export.
</objective>

<execution_context>
@/Users/ganapolsky_i/.claude/get-shit-done/workflows/execute-plan.md
@/Users/ganapolsky_i/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@docs/planning/PROJECT.md
@docs/planning/ROADMAP.md
@docs/planning/STATE.md
@docs/planning/phases/01-contract-alignment/1-RESEARCH.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add rubricEvaluation gate to Subway's resolveFeedbackAction</name>
  <files>/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema.js</files>
  <action>
Read /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema.js in full before editing.

Find resolveFeedbackAction. It currently destructures:
  const { signal, context, whatWentWrong, whatToChange, whatWorked, tags } = params;

Make these SURGICAL changes only — do not touch anything else in the file:

1. Extend the destructure to add rubricEvaluation:
   const { signal, context, whatWentWrong, whatToChange, whatWorked, tags, rubricEvaluation } = params;

2. After the destructure, build rubricSummary (matches ThumbGate lines 100-109 exactly):
   const rubricSummary = rubricEvaluation ? {
     rubricId: rubricEvaluation.rubricId,
     weightedScore: rubricEvaluation.weightedScore,
     failingCriteria: rubricEvaluation.failingCriteria || [],
     failingGuardrails: rubricEvaluation.failingGuardrails || [],
     judgeDisagreements: rubricEvaluation.judgeDisagreements || [],
     blockReasons: rubricEvaluation.blockReasons || [],
   } : null;

3. Inside the signal === 'positive' branch, at the TOP of that block (before existing positive logic), add the gate:
   if (rubricEvaluation && !rubricEvaluation.promotionEligible) {
     const reasons = rubricEvaluation.blockReasons?.join('; ') || 'rubric gate did not pass';
     return { type: 'no-action', reason: `Rubric gate prevented promotion: ${reasons}` };
   }

4. If the positive branch already builds a result object, add rubricSummary to it:
   { ..., rubricSummary: rubricSummary || undefined }
   Only include rubricSummary in the result if it is non-null (matches ThumbGate behavior).

CRITICAL: Do NOT rename any existing exports. Do NOT modify validateFeedbackMemory, prepareForStorage, or any other function. Subway has 32 inline tests in this file — do not break them. The existing test harness runs with node scripts/feedback-schema.js and must still exit 0.

After editing, verify by running: node /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema.js
If Subway has a Jest test suite, also run: cd /Users/ganapolsky_i/workspace/git/Subway_RN_Demo && npx jest scripts/__tests__ --passWithNoTests 2>/dev/null || true
  </action>
  <verify>
cd /Users/ganapolsky_i/workspace/git/Subway_RN_Demo && node scripts/feedback-schema.js
Expected: exits 0 (all 32 inline tests pass — count may differ, but no failures printed).
grep -c "rubricEvaluation" /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema.js
Expected: >= 3 (destructure line, rubricSummary build, gate check).
  </verify>
  <done>
Subway's resolveFeedbackAction destructures rubricEvaluation, builds rubricSummary, and enforces the promotionEligible gate — matching ThumbGate behavior. Existing Subway inline tests still pass.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add parseTimestamp() to Subway's feedback-schema.js and export it</name>
  <files>/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema.js</files>
  <action>
Continuing in the same Subway feedback-schema.js (already modified in Task 1).

Add parseTimestamp() function immediately before the module.exports block:

```javascript
/**
 * Parse any ISO 8601 timestamp string into a Date object.
 * Handles: Z-suffix ("2026-03-04T12:00:00.000Z"), no-suffix ("2026-03-04T12:00:00"),
 * and UTC offset ("2026-03-04T12:00:00+05:00").
 * Returns null (not NaN) for null, undefined, or unparseable input.
 * NOTE: Do NOT change how timestamps are WRITTEN — only use this for reading.
 * Node's new Date().toISOString() already produces correct ISO 8601+Z format.
 * @param {string|null|undefined} ts - Timestamp string to parse
 * @returns {Date|null}
 */
function parseTimestamp(ts) {
  if (ts == null) return null;
  const d = new Date(String(ts).trim());
  return isNaN(d.getTime()) ? null : d;
}
```

Add parseTimestamp to module.exports:
Find the module.exports = { ... } block. Add parseTimestamp to the exports list.

Verify the existing exports are NOT removed. The export list in Subway's feedback-schema.js must contain:
  validateFeedbackMemory, resolveFeedbackAction, prepareForStorage, GENERIC_TAGS,
  MIN_CONTENT_LENGTH, VALID_TITLE_PREFIXES, VALID_CATEGORIES, parseTimestamp  (new)

Run the inline test suite again to confirm nothing broke:
  node /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema.js
  </action>
  <verify>
node -e "const s = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema'); console.log(typeof s.parseTimestamp, s.parseTimestamp('2026-03-04T12:00:00.000Z') instanceof Date, s.parseTimestamp(null) === null, s.parseTimestamp('garbage') === null);"
Expected output: function true true true

node /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema.js
Expected: exits 0 (inline tests pass).
  </verify>
  <done>
parseTimestamp is exported from Subway's feedback-schema.js. It returns Date for valid ISO 8601 inputs (Z-suffix, no-suffix, offset), null for null/undefined/invalid. All existing Subway inline tests still pass.
  </done>
</task>

</tasks>

<verification>
1. node /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema.js exits 0
2. grep -c "rubricEvaluation" /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema.js >= 3
3. node -e "const s = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema'); const r = s.resolveFeedbackAction({ signal: 'positive', rubricEvaluation: { promotionEligible: false, blockReasons: ['score too low'] } }); console.assert(r.type === 'no-action', 'gate failed'); console.log('gate ok');"
4. node -e "const s = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema'); console.assert(s.parseTimestamp === undefined ? false : true, 'not exported'); console.assert(s.parseTimestamp(null) === null, 'null check'); console.log('parseTimestamp ok');"
</verification>

<success_criteria>
- Subway's resolveFeedbackAction handles rubricEvaluation identically to ThumbGate's implementation (CNTR-02)
- parseTimestamp() is exported from Subway's feedback-schema.js and handles all ISO 8601 variants returning Date or null (CNTR-03 Subway half)
- All existing Subway feedback-schema.js inline tests continue to pass
- No new npm dependencies introduced
</success_criteria>

<output>
After completion, create docs/planning/phases/01-contract-alignment/1-02-SUMMARY.md with:
- Confirmation that rubricEvaluation gate added to Subway (CNTR-02 complete)
- Confirmation that parseTimestamp() added to Subway (CNTR-03 Subway half complete)
- Actual inline test count from Subway's feedback-schema.js
- Any unexpected divergences from research notes
</output>
