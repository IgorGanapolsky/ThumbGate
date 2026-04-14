---
phase: 05-rlaif-and-dpo-optimization
plan: "03"
type: execute
wave: 2
depends_on:
  - "05-01"
  - "05-02"
files_modified:
  - tests/rlaif-self-audit.test.js
  - tests/dpo-optimizer.test.js
  - tests/meta-policy.test.js
  - scripts/prove-rlaif.js
  - package.json
  - proof/rlaif-report.md
  - proof/rlaif-report.json
  - docs/VERIFICATION_EVIDENCE.md
autonomous: true
requirements:
  - DPO-04

must_haves:
  truths:
    - "npm test passes green with total count >= 93 + new RLAIF tests (each of 3 test files contributes >= 2 tests)"
    - "prove-rlaif.js exits 0 and produces proof/rlaif-report.md with DPO-01 through DPO-04 evidence sections"
    - "proof/rlaif-report.json contains {passed: N, failed: 0} for all 4 DPO requirements"
    - "docs/VERIFICATION_EVIDENCE.md updated to reference rlaif-report.md"
  artifacts:
    - path: "tests/rlaif-self-audit.test.js"
      provides: "node:test suite for selfAudit() — >= 3 test cases"
      min_lines: 40
    - path: "tests/dpo-optimizer.test.js"
      provides: "node:test suite for dpoLogRatio + applyDpoAdjustments — >= 3 test cases"
      min_lines: 40
    - path: "tests/meta-policy.test.js"
      provides: "node:test suite for extractMetaPolicyRules — >= 3 test cases"
      min_lines: 40
    - path: "scripts/prove-rlaif.js"
      provides: "gate proof script — exits 0/1, writes rlaif-report.md + rlaif-report.json"
      min_lines: 80
    - path: "proof/rlaif-report.md"
      provides: "DPO-04 evidence: per-requirement pass/fail, test delta from 93 baseline"
      contains: "DPO-01"
  key_links:
    - from: "tests/rlaif-self-audit.test.js"
      to: "scripts/rlaif-self-audit.js"
      via: "require + require.cache invalidation + tmpdir THUMBGATE_FEEDBACK_DIR pattern"
      pattern: "require.cache"
    - from: "scripts/prove-rlaif.js"
      to: "scripts/prove-lancedb.js"
      via: "same structure: mkdtempSync, env override, execSync node --test, write report"
      pattern: "mkdtempSync"
    - from: "package.json test:api"
      to: "tests/rlaif-self-audit.test.js tests/dpo-optimizer.test.js tests/meta-policy.test.js"
      via: "explicit file list in test:api command — MUST be added or npm test skips them"
      pattern: "rlaif-self-audit\\.test\\.js"
---

<objective>
Write test suites for all three Phase 5 modules and generate the proof report gate script. Wire new tests into package.json and update verification evidence.

Purpose: DPO-04 requires all RLAIF features to have passing tests and a proof report. This is the CI gate that marks Phase 5 complete.

Output: 3 test files (node:test), prove-rlaif.js, proof/rlaif-report.md, proof/rlaif-report.json, updated package.json test:api, updated docs/VERIFICATION_EVIDENCE.md.
</objective>

<execution_context>
@/Users/ganapolsky_i/.claude/get-shit-done/workflows/execute-plan.md
@/Users/ganapolsky_i/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@docs/planning/PROJECT.md
@docs/planning/ROADMAP.md
@docs/planning/STATE.md
@docs/planning/phases/05-rlaif-and-dpo-optimization/5-RESEARCH.md
@tests/vector-store.test.js
@scripts/prove-lancedb.js
@scripts/rlaif-self-audit.js
@scripts/dpo-optimizer.js
@scripts/meta-policy.js
@package.json
@docs/VERIFICATION_EVIDENCE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write three node:test test files for rlaif-self-audit, dpo-optimizer, and meta-policy</name>
  <files>tests/rlaif-self-audit.test.js, tests/dpo-optimizer.test.js, tests/meta-policy.test.js</files>
  <action>
Use the canonical pattern from `tests/vector-store.test.js`: `describe/it`, `require.cache` invalidation, `fs.mkdtempSync()` + `process.env.THUMBGATE_FEEDBACK_DIR = tmpDir`.

**tests/rlaif-self-audit.test.js** (>= 4 test cases):
- `it('returns score < 0.5 for vague negative feedback')`: event = {signal:'negative', context:'bad', tags:[], timestamp:ISO}; assert result.score < 0.5
- `it('returns score > 0.7 for well-formed positive feedback')`: event with context>=20 chars, whatWorked, tags:[...], rubric:{promotionEligible:true,failingGuardrails:[]}; assert score > 0.7
- `it('returns exactly 6 constraints')`: any event; assert result.constraints.length === 6
- `it('selfAuditAndLog writes to self-score-log.jsonl')`: use tmpdir, call selfAuditAndLog(event, {feedbackDir:tmpDir}), assert file exists and is valid JSON line

**tests/dpo-optimizer.test.js** (>= 4 test cases):
- `it('dpoLogRatio returns positive for chosen > rejected')`: dpoLogRatio(1.0, 0.5) > 0
- `it('dpoLogRatio returns negative for chosen < rejected')`: dpoLogRatio(0.5, 1.0) < 0
- `it('dpoLogRatio result is in range [-1, 1]')`: assert Math.abs(dpoLogRatio(100, 0.001)) <= 1
- `it('applyDpoAdjustments writes dpo-model.json')`: use tmpdir with seeded feedback-log.jsonl (2 positive, 2 negative entries, same category), call run({feedbackDir:tmpDir}); assert dpo-model.json exists in tmpDir

For the applyDpoAdjustments test: if export-dpo-pairs.js returns empty pairs for fixture data (no rubric delta), assert that run() does not throw and dpo-model.json is still written (even with 0 adjustments).

**tests/meta-policy.test.js** (>= 4 test cases):
- `it('returns empty array for missing memory-log.jsonl')`: fresh tmpdir; extractMetaPolicyRules({feedbackDir:tmpDir}) returns []
- `it('extracts rule for category with >= 2 negative entries')`: seed 3 same-domain negative entries; assert rules.length >= 1 and rules[0] has {category, confidence, trend, occurrence_count}
- `it('confidence is clamped to [0, 0.95]')`: assert rules[0].confidence <= 0.95
- `it('run() writes meta-policy-rules.json')`: call run({feedbackDir:tmpDir}) with seeded data; assert file exists; JSON.parse it; assert .rules is array

All files start with `'use strict';` and use `const { describe, it } = require('node:test'); const assert = require('node:assert/strict');`
  </action>
  <verify>
node --test tests/rlaif-self-audit.test.js 2>&1 | tail -5
node --test tests/dpo-optimizer.test.js 2>&1 | tail -5
node --test tests/meta-policy.test.js 2>&1 | tail -5
All three must show "pass" lines and no "fail" lines.
  </verify>
  <done>All three test files run with node --test and show >= 4 passing tests each, 0 failures; no production feedback dirs touched (all tests use tmpdir)</done>
</task>

<task type="auto">
  <name>Task 2: Create prove-rlaif.js gate script, update package.json test:api, update VERIFICATION_EVIDENCE.md</name>
  <files>scripts/prove-rlaif.js, package.json, proof/rlaif-report.md, proof/rlaif-report.json, docs/VERIFICATION_EVIDENCE.md</files>
  <action>
**A. Create `scripts/prove-rlaif.js`** (mirror `scripts/prove-lancedb.js` structure exactly):

```javascript
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

async function runProof() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-rlaif-'));
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

  const report = {
    phase: '05-rlaif-and-dpo-optimization',
    generated: new Date().toISOString(),
    requirements: {},
    summary: { passed: 0, failed: 0, warned: 0 },
  };

  // DPO-01: selfAudit() returns float score in [0,1]
  // Seed a well-formed feedback event in tmpDir, call selfAudit, verify score
  // Verify self-score-log.jsonl is written

  // DPO-02: dpoOptimizer.run() writes dpo-model.json
  // Seed fixture feedback-log.jsonl in tmpDir, call run(), verify dpo-model.json exists

  // DPO-03: extractMetaPolicyRules() produces rules when data exists
  // Seed fixture memory-log.jsonl in tmpDir with 3 negative entries, call run(), verify meta-policy-rules.json

  // DPO-04: node --test exits 0; report test count delta from 93 baseline
  // execSync('node --test tests/rlaif-self-audit.test.js tests/dpo-optimizer.test.js tests/meta-policy.test.js', { cwd: ROOT })
  // Parse stdout for "pass" count

  // Write proof/rlaif-report.json and proof/rlaif-report.md
  // Exit 0 if summary.failed === 0, else exit 1
}

runProof().catch(e => { console.error(e); process.exit(1); });
```

Each requirement section in the report object: `{ status: 'pass'|'fail', evidence: string }`.

The markdown report (`proof/rlaif-report.md`) must include:
- Header: `# RLAIF and DPO Optimization — Proof Report`
- Date and phase
- Per-requirement pass/fail table: DPO-01, DPO-02, DPO-03, DPO-04
- Test delta section: "Phase 4 baseline: 93 tests. Phase 5 adds N new tests. Total: M tests."
- Summary: X/4 requirements passed

**B. Update `package.json` `test:api`:**

Append the 3 new test files to the existing `test:api` command (MUST be explicit paths, not glob):
- Add `tests/rlaif-self-audit.test.js tests/dpo-optimizer.test.js tests/meta-policy.test.js` to the end of the `test:api` value string

This is CRITICAL: without this, `npm test` never runs the RLAIF tests (see RESEARCH.md Pitfall 5).

**C. Update `docs/VERIFICATION_EVIDENCE.md`:**

Add a Phase 5 section referencing `proof/rlaif-report.md` and `proof/rlaif-report.json`. Follow the format of existing Phase 4 LanceDB entry.

**D. Run the full proof:**
Execute `node scripts/prove-rlaif.js` to generate the actual `proof/rlaif-report.md` and `proof/rlaif-report.json` files. These must be committed as evidence.

**E. Run npm test to confirm total count:**
`npm test` must pass with all prior 93 tests still green plus new RLAIF tests.
  </action>
  <verify>
node scripts/prove-rlaif.js && echo "EXIT 0 OK"
cat proof/rlaif-report.md | grep -E "DPO-0[1-4]"
cat proof/rlaif-report.json | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('passed:',d.summary.passed,'failed:',d.summary.failed); process.exit(d.summary.failed>0?1:0);"
npm test 2>&1 | tail -10
grep "rlaif-self-audit" package.json
  </verify>
  <done>prove-rlaif.js exits 0; proof/rlaif-report.md lists all 4 DPO requirements as pass; proof/rlaif-report.json has {summary:{failed:0}}; npm test passes with count > 93; package.json test:api includes all 3 new test files; docs/VERIFICATION_EVIDENCE.md references rlaif-report.md</done>
</task>

</tasks>

<verification>
1. node scripts/prove-rlaif.js — must exit 0
2. cat proof/rlaif-report.json | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); if(d.summary.failed>0) throw new Error('failures: '+d.summary.failed)"
3. npm test — must pass; output line count must exceed 93
4. grep "rlaif-self-audit.test.js" package.json — confirms test:api updated
5. ls proof/rlaif-report.md proof/rlaif-report.json — both files exist
</verification>

<success_criteria>
- All 3 test files created using node:test + describe/it + tmpdir pattern; 0 tests use production feedback dirs
- prove-rlaif.js exits 0 and produces proof/rlaif-report.md with DPO-01..DPO-04 evidence
- proof/rlaif-report.json summary.failed === 0
- npm test passes with total test count > 93 (Phase 4 baseline)
- package.json test:api explicitly includes rlaif-self-audit.test.js, dpo-optimizer.test.js, meta-policy.test.js
- docs/VERIFICATION_EVIDENCE.md updated with Phase 5 proof reference
- REQUIREMENTS.md DPO-01..DPO-04 can be marked complete after this plan
</success_criteria>

<output>
After completion, create `docs/planning/phases/05-rlaif-and-dpo-optimization/5-03-SUMMARY.md`

Also update:
- docs/planning/REQUIREMENTS.md: mark DPO-01, DPO-02, DPO-03, DPO-04 as [x] complete
- docs/planning/ROADMAP.md: mark Phase 5 complete with date
- docs/planning/STATE.md: update current position to Phase 5 complete
</output>
