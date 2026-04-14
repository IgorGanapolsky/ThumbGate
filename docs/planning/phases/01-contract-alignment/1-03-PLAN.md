---
phase: 01-contract-alignment
plan: 03
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/feedback-schema.js
  - tests/feedback-schema.test.js
  - proof/baseline-test-count.md
autonomous: true
requirements:
  - CNTR-03

must_haves:
  truths:
    - "parseTimestamp() is exported from ThumbGate's scripts/feedback-schema.js"
    - "parseTimestamp('2026-03-04T12:00:00.000Z') returns a Date — not NaN, not null"
    - "parseTimestamp('2026-03-04T12:00:00') (no Z) returns a Date — handles Python's Z-stripping pattern"
    - "parseTimestamp('2026-03-04T12:00:00+05:00') (offset) returns a Date"
    - "parseTimestamp(null) returns null and parseTimestamp('garbage') returns null"
    - "proof/baseline-test-count.md records 54 node-runner tests and 23 script-runner tests passing before Phase 2"
    - "npm test exits 0 after all changes — no regressions"
  artifacts:
    - path: "scripts/feedback-schema.js"
      provides: "parseTimestamp() helper added to ThumbGate's feedback-schema.js"
      contains: "parseTimestamp"
    - path: "tests/feedback-schema.test.js"
      provides: "node --test suite covering parseTimestamp() with all 6 test cases from research"
      min_lines: 30
    - path: "proof/baseline-test-count.md"
      provides: "Authoritative baseline test count evidence for CNTR-03 and Phase 2/3 start gate"
      contains: "node-runner"
  key_links:
    - from: "tests/feedback-schema.test.js"
      to: "scripts/feedback-schema.js"
      via: "require('../scripts/feedback-schema')"
      pattern: "require.*feedback-schema"
    - from: "scripts/feedback-schema.js"
      to: "module.exports"
      via: "parseTimestamp added to exports"
      pattern: "parseTimestamp"
---

<objective>
Add parseTimestamp() to ThumbGate's feedback-schema.js, write a node --test test file covering all timestamp variants and edge cases, and record the authoritative baseline test count before Phase 2 begins.

Purpose: CNTR-03 requires parseTimestamp() in both repos (Subway's half is done in Plan 02). This plan completes the ThumbGate side and produces proof/baseline-test-count.md as the official pre-Phase-2 CI gate evidence. The test file also increases the node-runner count from 54, proving the test infrastructure accepts new tests.
Output: Modified scripts/feedback-schema.js, new tests/feedback-schema.test.js, new proof/baseline-test-count.md.
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
  <name>Task 1: Add parseTimestamp() to ThumbGate's feedback-schema.js</name>
  <files>scripts/feedback-schema.js</files>
  <action>
Read scripts/feedback-schema.js in full before editing.

Add parseTimestamp() immediately before the module.exports block:

```javascript
/**
 * Parse any ISO 8601 timestamp string into a Date object.
 * Handles: Z-suffix ("2026-03-04T12:00:00.000Z"), no-suffix ("2026-03-04T12:00:00"),
 * and UTC offset ("2026-03-04T12:00:00+05:00").
 * Returns null (not NaN) for null, undefined, or unparseable input.
 * NOTE: Do NOT change how timestamps are WRITTEN — new Date().toISOString() already
 * produces correct ISO 8601+Z format. This helper is for READING only.
 * Python's train_from_feedback.py strips Z with .replace("Z","") before fromisoformat().
 * That pattern is safe because Node always writes Z-suffix. Do not alter write behavior.
 * @param {string|null|undefined} ts - Timestamp string to parse
 * @returns {Date|null}
 */
function parseTimestamp(ts) {
  if (ts == null) return null;
  const d = new Date(String(ts).trim());
  return isNaN(d.getTime()) ? null : d;
}
```

Add parseTimestamp to the module.exports object. The existing ThumbGate exports are:
  validateFeedbackMemory, resolveFeedbackAction, prepareForStorage, GENERIC_TAGS,
  MIN_CONTENT_LENGTH, VALID_TITLE_PREFIXES, VALID_CATEGORIES

After edit, exports must include parseTimestamp as well. Do NOT remove any existing export.

Run the ThumbGate inline tests to confirm nothing broke:
  node scripts/feedback-schema.js
Expected: exits 0 (7 inline schema tests pass).
  </action>
  <verify>
node -e "const s = require('./scripts/feedback-schema'); console.log(typeof s.parseTimestamp);"
Expected: function

node scripts/feedback-schema.js
Expected: exits 0.

grep "parseTimestamp" scripts/feedback-schema.js | wc -l
Expected: >= 3 (definition, JSDoc, export).
  </verify>
  <done>
parseTimestamp() is defined and exported from ThumbGate's scripts/feedback-schema.js. Existing 7 inline schema tests still pass.
  </done>
</task>

<task type="auto">
  <name>Task 2: Write tests/feedback-schema.test.js and capture baseline count</name>
  <files>tests/feedback-schema.test.js, proof/baseline-test-count.md</files>
  <action>
PART A — Write tests/feedback-schema.test.js using node:test (node --test runner, same as the existing test suite).

```javascript
// tests/feedback-schema.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseTimestamp } = require('../scripts/feedback-schema');

test('parseTimestamp: Z-suffix returns valid Date', () => {
  const d = parseTimestamp('2026-03-04T12:00:00.000Z');
  assert.ok(d instanceof Date, 'should be a Date');
  assert.ok(!isNaN(d.getTime()), 'should not be NaN');
});

test('parseTimestamp: no-suffix (Python-stripped) returns valid Date', () => {
  const d = parseTimestamp('2026-03-04T12:00:00');
  assert.ok(d instanceof Date, 'should be a Date');
  assert.ok(!isNaN(d.getTime()), 'no-suffix should not be NaN');
});

test('parseTimestamp: UTC offset returns valid Date', () => {
  const d = parseTimestamp('2026-03-04T12:00:00+05:00');
  assert.ok(d instanceof Date, 'should be a Date');
  assert.ok(!isNaN(d.getTime()), 'offset should not be NaN');
});

test('parseTimestamp: null returns null', () => {
  assert.strictEqual(parseTimestamp(null), null);
});

test('parseTimestamp: undefined returns null', () => {
  assert.strictEqual(parseTimestamp(undefined), null);
});

test('parseTimestamp: garbage string returns null', () => {
  assert.strictEqual(parseTimestamp('garbage'), null);
  assert.strictEqual(parseTimestamp('not-a-date'), null);
});
```

Run: node --test tests/feedback-schema.test.js
Expected: 6 tests pass, 0 failures.

PART B — Run npm test to confirm all tests pass including the new test file:
  npm test

Note the total node-runner count from stdout (look for "pass N" or the test runner summary line).

PART C — Write proof/baseline-test-count.md:

```markdown
# Baseline Test Count — Phase 1 Completion

**Recorded:** {new Date().toISOString()}
**Purpose:** Authoritative pre-Phase-2 CI gate. Phase 2 and 3 may not begin until this baseline is confirmed green.

## thumbgate (Node.js repo)

| Runner | Count | Command |
|--------|-------|---------|
| node --test (node-runner) | {actual count from npm test output} | npm test |
| Script inline tests | 23 | node scripts/feedback-{schema,loop}.js + export-dpo-pairs.js |
| **Total** | **{node-runner + 23}** | |

## CI Status

- All tests: GREEN
- Regressions from Phase 1 changes: 0
- New tests added this phase: 6 (parseTimestamp suite in tests/feedback-schema.test.js)

## Notes

- "54 node-runner tests" in ROADMAP refers to pre-Phase-1 baseline
- After Phase 1: node-runner count is {actual} (54 original + 6 new parseTimestamp tests = 60 expected, verify actual matches)
- Script-runner count (23) is unchanged — these use process.exit() and bypass node --test counter
- Subway test baseline: run `cd /Users/ganapolsky_i/workspace/git/Subway_RN_Demo && npx jest scripts/__tests__ --passWithNoTests` to capture (not required for CNTR-03 but documented here for Phase 3 planner)
```

Fill in {actual count} with the real number from npm test output. Do NOT use placeholder values.
  </action>
  <verify>
node --test tests/feedback-schema.test.js
Expected: 6 tests pass, exits 0.

npm test
Expected: exits 0, test count >= 60 (54 original + 6 new).

cat proof/baseline-test-count.md | grep "node-runner"
Expected: contains actual numeric count, not a placeholder.
  </verify>
  <done>
tests/feedback-schema.test.js has 6 passing tests for parseTimestamp(). npm test exits 0 with >= 60 node-runner tests. proof/baseline-test-count.md records the actual count with no placeholders. CNTR-03 complete for ThumbGate side.
  </done>
</task>

</tasks>

<verification>
1. node -e "const s = require('./scripts/feedback-schema'); const r = [s.parseTimestamp('2026-03-04T12:00:00.000Z') instanceof Date, s.parseTimestamp('2026-03-04T12:00:00') instanceof Date, s.parseTimestamp(null) === null, s.parseTimestamp('bad') === null]; console.assert(r.every(Boolean), JSON.stringify(r)); console.log('all pass');"
2. node --test tests/feedback-schema.test.js — exits 0, 6 tests pass
3. npm test — exits 0, no regressions
4. cat proof/baseline-test-count.md | grep -E "[0-9]+" — contains real numbers
5. grep "parseTimestamp" scripts/feedback-schema.js — at least 3 matches
</verification>

<success_criteria>
- parseTimestamp() in ThumbGate's feedback-schema.js handles Z-suffix, no-suffix, offset, null, and garbage inputs correctly (CNTR-03 ThumbGate side)
- 6-test node --test suite validates all parseTimestamp behavior
- npm test exits 0 with no regressions from Phase 1 changes
- proof/baseline-test-count.md records actual test count as the official pre-Phase-2 gate
</success_criteria>

<output>
After completion, create docs/planning/phases/01-contract-alignment/1-03-SUMMARY.md with:
- Confirmation parseTimestamp() added to ThumbGate's feedback-schema.js
- Actual npm test node-runner count (number from test output)
- CNTR-03 complete: parseTimestamp in both repos (ThumbGate + Subway via Plan 02)
- Baseline record location: proof/baseline-test-count.md
</output>
