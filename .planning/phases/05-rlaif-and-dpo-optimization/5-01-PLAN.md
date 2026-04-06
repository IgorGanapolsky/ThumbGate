---
phase: 05-rlaif-and-dpo-optimization
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/rlaif-self-audit.js
  - scripts/dpo-optimizer.js
  - scripts/feedback-loop.js
  - package.json
autonomous: true
requirements:
  - DPO-01
  - DPO-02

must_haves:
  truths:
    - "selfAudit(feedbackEvent) returns a float score in [0,1] and a constraints array without any API call"
    - "dpoOptimizer.run() reads feedback-log.jsonl pairs, writes dpo-model.json with per-category adjustments, and calls saveModel() to persist updated Thompson posteriors"
    - "captureFeedback() fires selfAuditAndLog() as a non-blocking side-effect after vector upsert — no await, no latency impact"
    - "npm run ml:dpo executes without error and produces dpo-model.json in THUMBGATE_FEEDBACK_DIR"
  artifacts:
    - path: "scripts/rlaif-self-audit.js"
      provides: "selfAudit() and selfAuditAndLog() exports"
      exports: ["selfAudit", "selfAuditAndLog"]
    - path: "scripts/dpo-optimizer.js"
      provides: "DPO batch optimization — buildPreferencePairs, applyDpoAdjustments, run"
      exports: ["run", "buildPreferencePairs", "applyDpoAdjustments", "dpoLogRatio"]
    - path: "scripts/feedback-loop.js"
      provides: "selfAuditAndLog wired as 4th non-blocking side-effect in captureFeedback()"
      contains: "getSelfAuditModule"
  key_links:
    - from: "scripts/feedback-loop.js"
      to: "scripts/rlaif-self-audit.js"
      via: "lazy-require getSelfAuditModule() pattern (mirrors getContextFsModule)"
      pattern: "getSelfAuditModule"
    - from: "scripts/dpo-optimizer.js"
      to: "scripts/thompson-sampling.js"
      via: "loadModel() + saveModel() — MUST call saveModel() after adjustments"
      pattern: "saveModel"
    - from: "scripts/dpo-optimizer.js"
      to: "scripts/export-dpo-pairs.js"
      via: "buildDpoPairs() — do NOT reimplement"
      pattern: "buildDpoPairs"
---

<objective>
Create the RLAIF self-audit module and DPO batch optimizer, then wire the self-audit as a non-blocking side-effect in captureFeedback().

Purpose: DPO-01 requires feedback events to receive a heuristic quality score against CLAUDE.md constraints. DPO-02 requires preference pair construction and Thompson posterior adjustment via DPO math. These two modules form the core ML layer for Phase 5.

Output: scripts/rlaif-self-audit.js, scripts/dpo-optimizer.js, feedback-loop.js updated, package.json updated with ml:dpo and test:rlaif entries.
</objective>

<execution_context>
@/Users/ganapolsky_i/.claude/get-shit-done/workflows/execute-plan.md
@/Users/ganapolsky_i/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05-rlaif-and-dpo-optimization/5-RESEARCH.md
@scripts/feedback-loop.js
@scripts/thompson-sampling.js
@scripts/export-dpo-pairs.js
@scripts/budget-guard.js
@tests/vector-store.test.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create rlaif-self-audit.js — heuristic self-scoring against CLAUDE.md constraints</name>
  <files>scripts/rlaif-self-audit.js</files>
  <action>
Create `scripts/rlaif-self-audit.js` with the following exports:

**`selfAudit(feedbackEvent)`** — pure function, no I/O, no API calls:
- Evaluate feedbackEvent against 6 CONSTRAINTS (weight sum = 1.0):
  1. `has_context` (weight 0.20): `typeof e.context === 'string' && e.context.length >= 20`
  2. `has_actionable_detail` (weight 0.25): positive → Boolean(e.whatWorked); negative → Boolean(e.whatWentWrong) && Boolean(e.whatToChange)
  3. `schema_valid` (weight 0.15): `['positive','negative'].includes(e.signal) && Array.isArray(e.tags) && e.tags.length > 0`
  4. `rubric_evaluated` (weight 0.20): `e.rubric != null && e.rubric.promotionEligible != null`
  5. `budget_compliant` (weight 0.10): `!e.rubric || !e.rubric.failingGuardrails || !e.rubric.failingGuardrails.includes('budgetCompliant')`
  6. `no_vague_signal` (weight 0.10): `typeof e.context === 'string' && e.context.length > 10`
- Returns: `{ score: float [0,1] rounded to 3 decimals, constraints: [{constraint, passed, weight}], timestamp: ISO string }`

**`selfAuditAndLog(feedbackEvent, mlPaths)`** — writes to self-score-log.jsonl:
- Calls selfAudit(feedbackEvent)
- Appends result as JSONL line to `path.join(mlPaths.feedbackDir, 'self-score-log.jsonl')`
- Returns the audit result synchronously (no async/await — pure sync file append with fs.appendFileSync)
- On any fs error: swallows and returns result anyway (non-critical side-effect pattern)

**`module.exports = { selfAudit, selfAuditAndLog, CONSTRAINTS }`**

CRITICAL: No API calls whatsoever. No require('budget-guard'). This is heuristic scoring only.
Use `'use strict';` at top. Use only `fs`, `path` from Node built-ins.
Export name MUST be `selfAudit` (NOT `selfScore` — see RESEARCH.md Pitfall 1).
  </action>
  <verify>
node -e "const { selfAudit } = require('./scripts/rlaif-self-audit'); const r = selfAudit({signal:'positive',context:'short'}); console.log(r.score, r.constraints.length)"
Expected: score < 0.5, constraints.length === 6
  </verify>
  <done>selfAudit() returns {score, constraints, timestamp} for any input; score is 0 for empty/vague feedback and > 0.7 for well-formed feedback; selfAuditAndLog() appends to self-score-log.jsonl without throwing</done>
</task>

<task type="auto">
  <name>Task 2: Create dpo-optimizer.js + wire selfAudit into feedback-loop.js + update package.json</name>
  <files>scripts/dpo-optimizer.js, scripts/feedback-loop.js, package.json</files>
  <action>
**A. Create `scripts/dpo-optimizer.js`:**

Exports: `{ run, buildPreferencePairs, applyDpoAdjustments, dpoLogRatio }`

`dpoLogRatio(chosenWeight, rejectedWeight, beta=0.1)`:
- `cw = Math.max(chosenWeight, 0.01)`, `rw = Math.max(rejectedWeight, 0.01)`
- `logRatio = Math.log(cw) - Math.log(rw)`
- `sigmoid = 1.0 / (1.0 + Math.exp(-beta * logRatio))`
- Returns `(sigmoid - 0.5) * 2` (range -1 to +1)

`buildPreferencePairs(feedbackDir)`:
- Import `buildDpoPairs` from `./export-dpo-pairs` (do NOT reimplement)
- Call `buildDpoPairs({ feedbackDir })` and return the result grouped by category

`applyDpoAdjustments(modelPath, pairs)`:
- Load model: `const ts = require('./thompson-sampling'); const model = ts.loadModel(modelPath);`
- For each category in pairs:
  - Compute `avg = mean of dpoLogRatio(timeDecayWeight(chosen.timestamp), timeDecayWeight(rejected.timestamp))` over all pairs
  - `if avg > 0`: `model.categories[cat].alpha += avg * pairs.length * 0.5`
  - `else`: `model.categories[cat].beta += Math.abs(avg) * pairs.length * 0.5`
  - Record adjustment in `adjustments[cat] = { pairs: n, avg_adjustment: rounded }`
- CRITICAL: call `ts.saveModel(model, modelPath)` after all mutations (see RESEARCH.md Pitfall 2)
- Return adjustments object

`run(opts = {})`:
- `feedbackDir = opts.feedbackDir || process.env.THUMBGATE_FEEDBACK_DIR || path.join(os.homedir(), '.claude/memory/feedback')`
- `modelPath = opts.modelPath || path.join(process.cwd(), '.claude/memory/feedback/feedback_model.json')`
- Build pairs via `buildPreferencePairs(feedbackDir)`
- Apply adjustments via `applyDpoAdjustments(modelPath, pairs)`
- Write `dpo-model.json` to feedbackDir: `{ generated, pairs_processed, adjustments }`
- Log summary to stdout
- Return `{ adjustments, pairs_processed }`

CLI entrypoint: `if (require.main === module && process.argv.includes('--run')) { run().catch(e => { console.error(e); process.exit(1); }); }`

**B. Wire selfAudit into `scripts/feedback-loop.js`:**

Locate the existing non-blocking side-effect block (after `upsertFeedback` fire-and-forget, around lines 381-387). Add a 4th block AFTER the vector upsert block:

```javascript
// Lazy-require pattern (mirrors getContextFsModule)
function getSelfAuditModule() {
  try { return require('./rlaif-self-audit'); } catch (_) { return null; }
}

// In captureFeedback(), after vector upsert:
try {
  const sam = getSelfAuditModule();
  if (sam) sam.selfAuditAndLog(feedbackEvent, mlPaths);
} catch (err) { /* non-critical */ }
```

Place `getSelfAuditModule()` function definition alongside other lazy-require helpers.
Do NOT await. Do NOT add selfAudit to return value of captureFeedback() — it is side-effect only.

**C. Update `package.json` scripts:**

Add these entries to the `"scripts"` block:
- `"ml:dpo": "node scripts/dpo-optimizer.js --run"`
- `"ml:meta-policy": "node scripts/meta-policy.js --extract"`
- `"prove:rlaif": "node scripts/prove-rlaif.js"`
- `"test:rlaif": "node --test tests/rlaif-self-audit.test.js tests/dpo-optimizer.test.js tests/meta-policy.test.js"`

Update the `"test"` aggregate to append `&& npm run test:rlaif` at the end (after `test:proof`).
  </action>
  <verify>
node -e "const d = require('./scripts/dpo-optimizer'); console.log(typeof d.dpoLogRatio, typeof d.run)"
node -e "const r = require('./scripts/dpo-optimizer').dpoLogRatio(1.0, 0.5); console.assert(r > 0 && r <= 1, 'expected positive adjustment for chosen > rejected')"
grep -n "getSelfAuditModule" scripts/feedback-loop.js
grep '"ml:dpo"' package.json
  </verify>
  <done>dpo-optimizer.js exports {run, buildPreferencePairs, applyDpoAdjustments, dpoLogRatio}; dpoLogRatio(1.0, 0.5) returns positive value; feedback-loop.js contains getSelfAuditModule lazy-require; package.json contains ml:dpo, prove:rlaif, test:rlaif scripts</done>
</task>

</tasks>

<verification>
Run: node -e "const { selfAudit } = require('./scripts/rlaif-self-audit'); const good = selfAudit({ signal:'positive', context:'Ran all tests with output, verified before claiming done', whatWorked:'Evidence-first flow', tags:['verification'], rubric:{promotionEligible:true,failingGuardrails:[]} }); console.log('good score:', good.score); const bad = selfAudit({ signal:'negative', context:'bad', tags:[], timestamp:new Date().toISOString() }); console.log('bad score:', bad.score);"
Expected: good score > 0.7, bad score < 0.5

Run: node -e "const { dpoLogRatio } = require('./scripts/dpo-optimizer'); console.log(dpoLogRatio(1.0, 0.5).toFixed(4), dpoLogRatio(0.5, 1.0).toFixed(4));"
Expected: first value positive, second value negative (symmetric)

Run: grep -c "getSelfAuditModule" scripts/feedback-loop.js
Expected: >= 2 (definition + usage)
</verification>

<success_criteria>
- scripts/rlaif-self-audit.js exists and exports selfAudit, selfAuditAndLog, CONSTRAINTS
- selfAudit() returns {score, constraints[6], timestamp} with no API calls
- scripts/dpo-optimizer.js exists and exports run, buildPreferencePairs, applyDpoAdjustments, dpoLogRatio
- dpo-optimizer.js calls saveModel() after Thompson posterior adjustments
- feedback-loop.js wires selfAuditAndLog as 4th non-blocking side-effect via getSelfAuditModule lazy-require
- package.json contains ml:dpo, ml:meta-policy, prove:rlaif, test:rlaif scripts
- npm test aggregate includes test:rlaif
</success_criteria>

<output>
After completion, create `.planning/phases/05-rlaif-and-dpo-optimization/5-01-SUMMARY.md`
</output>
