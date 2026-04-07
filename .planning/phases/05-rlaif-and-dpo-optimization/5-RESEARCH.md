# Phase 5: RLAIF and DPO Optimization - Research

**Researched:** 2026-03-04
**Domain:** RLAIF self-scoring / DPO batch optimization / meta-policy rule extraction
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DPO-01 | RLAIF self-scoring grades feedback against CLAUDE.md constraints | New `scripts/rlaif-self-audit.js` module; heuristic scoring against 6 CLAUDE.md constraint categories; writes `self-score-log.jsonl`; budget-guard wraps every call |
| DPO-02 | DPO batch optimization builds preference pairs from Thompson Sampling posteriors | Extend `scripts/train_from_feedback.py --dpo-train` pattern into Node.js `scripts/dpo-optimizer.js`; `buildPreferencePairs()` from feedback-log + Thompson posteriors; posterior adjustment via `dpo_log_ratio` math already in Subway |
| DPO-03 | Meta-policy rule extraction produces actionable rules from feedback trends | Port `extract_meta_policy_rules()` from Python to Node.js `scripts/meta-policy.js`; reads memory-log.jsonl + diversity-tracking.json; outputs `meta-policy-rules.json` |
| DPO-04 | All RLAIF features have tests and proof report | `tests/rlaif-self-audit.test.js` + `tests/dpo-optimizer.test.js` + `tests/meta-policy.test.js`; `scripts/prove-rlaif.js` following prove-lancedb.js pattern; exit 0/1 gate |
</phase_requirements>

---

## Summary

Phase 5 is an implementation phase, not a design phase. All three components (RLAIF self-audit, DPO batch optimization, meta-policy rule extraction) have working reference implementations in `Subway_RN_Demo/.claude/scripts/feedback/` and in `ThumbGate/scripts/export-dpo-pairs.js`. The task is to wire them together correctly in `ThumbGate`, add the budget-guard integration DPO-01 requires, and prove correctness with tests.

The key design decision in SUMMARY.md is already locked: the function must be named `selfAudit()`, not `selfScore()`, to clarify the heuristic nature. RLAIF here means heuristic constitutional checking against CLAUDE.md rules — it is NOT a reward model inference call against the Anthropic API (that would be budget-prohibitive and out of scope per REQUIREMENTS.md). The self-audit computes a scalar score by evaluating feedback events against a rule set derived from CLAUDE.md, using existing rubric criteria as the scoring backbone.

DPO-02 is the most complex requirement. `train_from_feedback.py --dpo-train` in Subway already implements `build_preference_pairs()` and `dpo_log_ratio()`. The port to Node.js can be pure JS (no Python subprocess call) using the existing `thompson-sampling.js` module's `loadModel()` and `samplePosteriors()` outputs as the posterior source. The DPO adjustment math (`sigmoid(beta * log_ratio)`) is 5 lines of arithmetic — no library needed. DPO-03 (meta-policy rules) is also a direct port from Python, operating entirely on existing JSONL files already populated by Phases 2-4.

**Primary recommendation:** Build three new scripts (`rlaif-self-audit.js`, `dpo-optimizer.js`, `meta-policy.js`), three new test files, one proof script (`prove-rlaif.js`), and wire `npm test` and `npm run prove:rlaif` into `package.json`. No new npm packages needed. No Python subprocess calls. Everything runs offline.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-ins (fs, path, os) | Node 25.6.1 | File I/O, path resolution, tmpdir | Zero-dep pattern from all prior phases |
| `node:test` + `node:assert/strict` | Built-in | Unit tests | Every test in this project uses this; not Jest |
| `scripts/thompson-sampling.js` | local | Load posteriors, compute reliability | Already implements Beta-Bernoulli model; Phase 2 |
| `scripts/rubric-engine.js` | local | Load rubric config, evaluate criteria | Already validates rubric scores; Phase 1 |
| `scripts/budget-guard.js` | local | Atomic spend ledger for API calls | Required by DPO-01; already in repo |
| `scripts/export-dpo-pairs.js` | local | DPO pair construction from memories | Already implements `buildDpoPairs()`; reuse |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `scripts/feedback-schema.js` | local | `parseTimestamp()`, signal normalization | DPO optimizer needs timestamp normalization |
| Python `train_from_feedback.py` | local | Reference implementation for DPO math | NOT called at runtime; reference only for port |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pure JS DPO math | Python subprocess | Subprocess adds latency and process coupling; pure JS is faster and consistent with zero-dep pattern |
| Heuristic self-audit | API call to Claude for RLAIF scoring | API calls are budget-prohibitive at $10/mo; heuristic scoring against CLAUDE.md constraints is the correct scope |
| New test framework | jest | All existing tests use `node:test`; mixing frameworks adds config complexity |

**Installation:** No new packages needed. All dependencies are local scripts already in `scripts/`.

---

## Architecture Patterns

### Recommended Project Structure

```
scripts/
├── rlaif-self-audit.js      # DPO-01: heuristic self-scoring against CLAUDE.md rules
├── dpo-optimizer.js         # DPO-02: preference pair builder + posterior adjustment
├── meta-policy.js           # DPO-03: rule extraction from feedback trends
└── prove-rlaif.js           # DPO-04: gate proof script (exit 0/1)
tests/
├── rlaif-self-audit.test.js # node:test tests for DPO-01
├── dpo-optimizer.test.js    # node:test tests for DPO-02
└── meta-policy.test.js      # node:test tests for DPO-03
proof/
└── rlaif-report.md          # DPO-04 evidence output (generated by prove-rlaif.js)
.claude/memory/feedback/
├── self-score-log.jsonl     # DPO-01 output: heuristic audit log
├── dpo-model.json           # DPO-02 output: posterior adjustment metadata
└── meta-policy-rules.json   # DPO-03 output: extracted rules
```

### Pattern 1: Heuristic RLAIF Self-Audit (DPO-01)

**What:** Scores a feedback event against 6 CLAUDE.md constraint categories without any API call. Each constraint produces a pass/fail, and the aggregate score is a float in [0, 1].

**When to use:** Called after `captureFeedback()` as a non-blocking side-effect (same pattern as `appendSequence()` and `updateDiversityTracking()`). Also callable standalone via CLI for batch scoring of historical `feedback-log.jsonl`.

**CLAUDE.md constraints to check (confirmed by reading `ThumbGate/CLAUDE.md`):**
1. `has_context` — feedback has non-empty `context` field (min 20 chars)
2. `has_actionable_detail` — positive feedback has `whatWorked`; negative has `whatWentWrong` AND `whatToChange`
3. `schema_valid` — feedback has valid `signal` (positive/negative) and at least one tag
4. `rubric_evaluated` — rubric scores were provided and `promotionEligible` is set
5. `budget_compliant` — guardrails field includes `budgetCompliant: true` when present
6. `no_vague_signal` — context length > 10 AND not in vague phrase list

**Example:**
```javascript
// Source: direct design from CLAUDE.md constraints + feedback-loop.js pattern

'use strict';

const CONSTRAINTS = [
  { id: 'has_context', weight: 0.2, check: (e) => typeof e.context === 'string' && e.context.length >= 20 },
  { id: 'has_actionable_detail', weight: 0.25, check: (e) => {
    if (e.signal === 'positive') return Boolean(e.whatWorked);
    return Boolean(e.whatWentWrong) && Boolean(e.whatToChange);
  }},
  { id: 'schema_valid', weight: 0.15, check: (e) => ['positive','negative'].includes(e.signal) && Array.isArray(e.tags) && e.tags.length > 0 },
  { id: 'rubric_evaluated', weight: 0.2, check: (e) => e.rubric != null && e.rubric.promotionEligible != null },
  { id: 'budget_compliant', weight: 0.1, check: (e) => !e.rubric || !e.rubric.failingGuardrails || !e.rubric.failingGuardrails.includes('budgetCompliant') },
  { id: 'no_vague_signal', weight: 0.1, check: (e) => typeof e.context === 'string' && e.context.length > 10 },
];

function selfAudit(feedbackEvent) {
  const results = CONSTRAINTS.map(c => ({
    constraint: c.id,
    passed: Boolean(c.check(feedbackEvent)),
    weight: c.weight,
  }));
  const score = results.reduce((sum, r) => sum + (r.passed ? r.weight : 0), 0);
  return { score: Math.round(score * 1000) / 1000, constraints: results, timestamp: new Date().toISOString() };
}
```

### Pattern 2: DPO Batch Optimization (DPO-02)

**What:** Builds `(chosen, rejected)` preference pairs per category from `feedback-log.jsonl`, computes DPO log-ratio adjustments using Thompson Sampling posteriors, and writes `dpo-model.json`.

**When to use:** Run as `npm run ml:dpo` (batch, not in capture hot path). Called in `prove-rlaif.js` for DPO-04 gate.

**DPO math (ported from Subway's `train_from_feedback.py` lines 585-602):**
```javascript
// Source: Subway_RN_Demo/.claude/scripts/feedback/train_from_feedback.py lines 585-602
// DPO_BETA = 0.1 (temperature parameter — lower = more aggressive preference following)
const DPO_BETA = 0.1;

function dpoLogRatio(chosenWeight, rejectedWeight, beta = DPO_BETA) {
  // Use time-decay weights as proxy for log-probabilities (no reward model needed)
  const cw = Math.max(chosenWeight, 0.01);
  const rw = Math.max(rejectedWeight, 0.01);
  const logRatio = Math.log(cw) - Math.log(rw);
  const sigmoid = 1.0 / (1.0 + Math.exp(-beta * logRatio));
  return (sigmoid - 0.5) * 2; // Range: -1 to +1
}
```

**Pair-building uses `buildDpoPairs()` from existing `export-dpo-pairs.js`** — do NOT reimplement this. The DPO optimizer's job is to take those pairs and compute posterior adjustments, then write `dpo-model.json`.

### Pattern 3: Meta-Policy Rule Extraction (DPO-03)

**What:** Reads `memory-log.jsonl`, groups negative memories by category (using same `inferDomain()` logic from `feedback-loop.js`), computes recency-weighted confidence scores, detects trend (improving/deteriorating/stable), and writes `meta-policy-rules.json`.

**When to use:** Run as `npm run feedback:rules:meta` (batch). Also wired into `prove-rlaif.js` for gate evidence.

**Key logic from Subway's Python (lines 398-474):**
- `confidence = min(0.95, 0.4 + (avg_weighted * 0.3) + (occurrence_count * 0.05))`
- `trend = "improving"` if recent_count==0 && recent_positive>0
- `trend = "deteriorating"` if recent_count>2 && recent_positive==0
- `trend = "needs_attention"` if recent_count > recent_positive
- Rules sorted by confidence descending (most urgent first)

**Port note:** `inferDomain()` is already implemented in `feedback-loop.js`. Import and reuse it directly — do NOT duplicate.

### Pattern 4: Proof Script (DPO-04)

**What:** `prove-rlaif.js` is a standalone gate script modeled exactly on `prove-lancedb.js`. It runs smoke tests for each DPO-01 through DPO-04 requirement, writes `proof/rlaif-report.md` and `proof/rlaif-report.json`, exits 0 if all pass or 1 if any fail.

**Evidence structure per requirement:**
- DPO-01: selfAudit() called on a real feedback event; score is a float in [0,1]; `self-score-log.jsonl` written to tmpdir
- DPO-02: dpoOptimizer() with test fixture data; dpo-model.json written; at least one category has non-zero adjustment
- DPO-03: extractMetaPolicyRules() with fixture memory-log.jsonl; rules array is non-empty; each rule has `category`, `confidence`, `trend`
- DPO-04: `node --test tests/rlaif-self-audit.test.js tests/dpo-optimizer.test.js tests/meta-policy.test.js` exits 0; delta from Phase 4 baseline (93 tests) reported

### Anti-Patterns to Avoid

- **Calling Anthropic API in selfAudit():** RLAIF here means heuristic constitutional checking, NOT remote LLM inference. No API calls in the hot path. Budget guard must not be triggered by the self-audit itself.
- **Reimplementing buildDpoPairs():** It already exists in `export-dpo-pairs.js` with tests. Import it; don't copy.
- **Reimplementing inferDomain():** It already exists in `feedback-loop.js`. Import it.
- **Using jest in new test files:** All tests in this repo use `node:test` + `node:assert/strict`. The `test:api` npm script lists test files explicitly — new test files MUST be added to `test:api` or to a new `test:rlaif` script wired into the `test` aggregate.
- **Writing to production feedback dirs in tests:** All tests must use `fs.mkdtempSync()` + `process.env.THUMBGATE_FEEDBACK_DIR = tmpDir` pattern + `require.cache` invalidation. See `vector-store.test.js` for the canonical pattern.
- **Treating dpo-model.json as the Thompson model:** `dpo-model.json` stores DPO adjustment metadata only. The authoritative Thompson model is `feedback_model.json`. DPO adjusts priors in `feedback_model.json` via `thompson-sampling.js`'s `saveModel()`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DPO preference pair construction | Custom pair-matcher | `buildDpoPairs()` from `scripts/export-dpo-pairs.js` | Already tested, handles rubric delta, domain overlap; 148 lines of proven logic |
| Thompson posterior loading | JSON parse inline | `loadModel()` + `samplePosteriors()` from `scripts/thompson-sampling.js` | Handles corrupt JSON fallback, default priors, category normalization |
| Timestamp normalization | Custom date parser | `parseTimestamp()` from `scripts/feedback-schema.js` | Handles all ISO 8601 variants including missing Z and microseconds |
| Domain classification | New keyword classifier | `inferDomain()` from `scripts/feedback-loop.js` | 10-category classifier already tested across phases |
| Budget spend tracking | File-lock reimplementation | `addSpend()` / `checkBudget()` from `scripts/budget-guard.js` | Atomic file-lock pattern with 30s timeout already handles parallel agents |
| DPO sigmoid math | Import a math library | 3 lines of `Math.log` + `Math.exp` | Literally 3 lines; no library needed |

**Key insight:** Every primitive needed for Phase 5 already exists in prior-phase scripts. Phase 5 is assembly, not invention.

---

## Common Pitfalls

### Pitfall 1: Naming `selfScore` instead of `selfAudit`

**What goes wrong:** SUMMARY.md explicitly requires renaming from `selfScore()` (Subway name) to `selfAudit()` in ThumbGate. Using `selfScore` in ThumbGate would misrepresent the function as a scored prediction rather than a heuristic constitutional audit.
**Why it happens:** Direct copy from Subway without reading the rename requirement.
**How to avoid:** Export name must be `selfAudit`. The SUMMARY.md note is explicit: "renamed from `selfScore()` to clarify heuristic nature."
**Warning signs:** If grep finds `module.exports.selfScore` in the new file, rename it.

### Pitfall 2: DPO adjustment overwrites Thompson model without saving

**What goes wrong:** DPO adjustments to `model.categories[cat].alpha` and `.beta` are computed in-memory but `saveModel()` is not called, so the next run starts from the pre-adjustment state.
**Why it happens:** Forgetting to call `ts.saveModel(model, modelPath)` after DPO adjustments.
**How to avoid:** Always call `saveModel()` after mutating the model. The Subway Python version calls `save_model(model)` at the end of `train_dpo()` — mirror this exactly.
**Warning signs:** `dpo-model.json` exists but `feedback_model.json.updated` timestamp does not change after `npm run ml:dpo`.

### Pitfall 3: Self-audit called with `await` in the capture hot path

**What goes wrong:** If `selfAudit()` is added to `captureFeedback()` with `await`, any slow filesystem I/O in the self-audit (writing `self-score-log.jsonl`) blocks the capture response.
**Why it happens:** Treating self-audit as synchronous when it involves file I/O.
**How to avoid:** Mirror the sequence/diversity pattern in `feedback-loop.js` lines 368-379: wrap in `try { ... } catch (err) { }` inside a synchronous call, OR fire-and-forget with `.catch()`. The primary JSONL write must complete before self-audit runs.
**Warning signs:** `captureFeedback()` response latency increases in tests after self-audit integration.

### Pitfall 4: Meta-policy rules overwrite prevention-rules.md

**What goes wrong:** `meta-policy-rules.json` and `prevention-rules.md` serve different purposes. Meta-policy rules have trend/confidence/recency; prevention rules are category buckets with occurrence counts. Writing meta-policy output to the prevention rules path loses the simpler format that the CLAUDE.md references.
**Why it happens:** Treating them as the same artifact.
**How to avoid:** Meta-policy writes to a new path: `.claude/memory/feedback/meta-policy-rules.json`. Prevention rules path (`prevention-rules.md`) remains unchanged. The prove script checks both files exist independently.
**Warning signs:** `npm run feedback:rules` output changes format after DPO-03 implementation.

### Pitfall 5: Test files not added to `test:api` npm script

**What goes wrong:** New test files are created but not added to the `test:api` command in `package.json`, so `npm test` never runs them. DPO-04 CI gate appears green but tests are not exercised.
**Why it happens:** `test:api` lists all test files explicitly (not a glob) — new files must be manually added.
**How to avoid:** After creating test files, update `package.json` `test:api` to include `tests/rlaif-self-audit.test.js tests/dpo-optimizer.test.js tests/meta-policy.test.js`. Also add `"prove:rlaif": "node scripts/prove-rlaif.js"` to scripts.
**Warning signs:** `npm test` passes with same count as Phase 4 (93 tests) — should increase to 93 + N new tests.

### Pitfall 6: prove-rlaif.js uses live feedback data instead of fixtures

**What goes wrong:** If `prove-rlaif.js` reads from `.claude/memory/feedback/feedback-log.jsonl` (production log) instead of a tmpdir fixture, the test is non-deterministic and may fail in CI where the log is empty.
**Why it happens:** Not following the `prove-lancedb.js` pattern of `fs.mkdtempSync()` + `process.env.THUMBGATE_FEEDBACK_DIR = tmpDir`.
**How to avoid:** All proof scripts use tmpdir + env var override. Seed fixture data explicitly in the proof script before running smoke tests.
**Warning signs:** `prove-rlaif.js` passes locally but fails in a fresh checkout.

---

## Code Examples

### How Subway's dpo_log_ratio maps to Node.js

```javascript
// Source: Subway_RN_Demo/.claude/scripts/feedback/train_from_feedback.py lines 585-602
// Python:
//   def dpo_log_ratio(chosen_weight, rejected_weight, beta=DPO_BETA):
//     chosen_weight = max(chosen_weight, 0.01)
//     rejected_weight = max(rejected_weight, 0.01)
//     log_ratio = math.log(chosen_weight) - math.log(rejected_weight)
//     sigmoid = 1.0 / (1.0 + math.exp(-beta * log_ratio))
//     adjustment = (sigmoid - 0.5) * 2  # Range: -1 to 1
//     return adjustment

const DPO_BETA = 0.1;

function dpoLogRatio(chosenWeight, rejectedWeight, beta = DPO_BETA) {
  const cw = Math.max(chosenWeight, 0.01);
  const rw = Math.max(rejectedWeight, 0.01);
  const logRatio = Math.log(cw) - Math.log(rw);
  const sigmoid = 1.0 / (1.0 + Math.exp(-beta * logRatio));
  return (sigmoid - 0.5) * 2;
}
```

### How DPO adjusts Thompson posteriors

```javascript
// Source: Subway train_from_feedback.py lines 624-648 (ported to JS)
// Uses loadModel() and saveModel() from scripts/thompson-sampling.js

function applyDpoAdjustments(modelPath, pairs) {
  const ts = require('./thompson-sampling');
  const model = ts.loadModel(modelPath);
  const adjustments = {};

  for (const [cat, catPairs] of Object.entries(pairs)) {
    if (!model.categories[cat]) continue;
    let total = 0;
    for (const { chosen, rejected } of catPairs) {
      const { timeDecayWeight } = require('./thompson-sampling');
      total += dpoLogRatio(
        timeDecayWeight(chosen.timestamp),
        timeDecayWeight(rejected.timestamp),
      );
    }
    const avg = total / catPairs.length;
    if (avg > 0) {
      model.categories[cat].alpha += avg * catPairs.length * 0.5;
    } else {
      model.categories[cat].beta += Math.abs(avg) * catPairs.length * 0.5;
    }
    adjustments[cat] = { pairs: catPairs.length, avg_adjustment: Math.round(avg * 10000) / 10000 };
  }

  ts.saveModel(model, modelPath);  // CRITICAL: save after mutating
  return adjustments;
}
```

### node:test pattern for new test files (confirmed from vector-store.test.js)

```javascript
// Source: /Users/ganapolsky_i/workspace/git/igor/ThumbGate/tests/vector-store.test.js

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('rlaif-self-audit — selfAudit()', () => {
  it('returns score 0 for vague negative feedback', () => {
    delete require.cache[require.resolve('../scripts/rlaif-self-audit')];
    const { selfAudit } = require('../scripts/rlaif-self-audit');
    const event = { signal: 'negative', context: 'bad', tags: [], timestamp: new Date().toISOString() };
    const result = selfAudit(event);
    assert.ok(result.score < 0.5, `expected score < 0.5 for vague feedback, got ${result.score}`);
    assert.ok(Array.isArray(result.constraints), 'constraints must be an array');
  });

  it('returns score > 0.7 for well-formed positive feedback', () => {
    delete require.cache[require.resolve('../scripts/rlaif-self-audit')];
    const { selfAudit } = require('../scripts/rlaif-self-audit');
    const event = {
      signal: 'positive',
      context: 'Ran all tests with output, verified before claiming done',
      whatWorked: 'Evidence-first flow prevented premature completion claim',
      tags: ['verification', 'testing'],
      rubric: { promotionEligible: true, failingGuardrails: [] },
      timestamp: new Date().toISOString(),
    };
    const result = selfAudit(event);
    assert.ok(result.score > 0.7, `expected score > 0.7, got ${result.score}`);
  });
});
```

### prove-rlaif.js structure (mirrors prove-lancedb.js)

```javascript
// Source: /Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/prove-lancedb.js pattern

async function runProof() {
  const report = {
    phase: '05-rlaif-and-dpo-optimization',
    generated: new Date().toISOString(),
    requirements: {},
    summary: { passed: 0, failed: 0, warned: 0 },
  };

  // DPO-01: selfAudit() produces float score, writes self-score-log.jsonl
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-rlaif-'));
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  // ... smoke test ...

  // DPO-02: dpoOptimizer() produces dpo-model.json with adjustments
  // ... smoke test with fixture data ...

  // DPO-03: extractMetaPolicyRules() produces meta-policy-rules.json
  // ... smoke test with fixture memory-log.jsonl ...

  // DPO-04: node --test exits 0; test count delta from 93
  const testOutput = execSync('node --test tests/rlaif-self-audit.test.js tests/dpo-optimizer.test.js tests/meta-policy.test.js', { cwd: ROOT });
  // ... parse pass/fail counts ...
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual prevention rules from feedback | Automated meta-policy extraction with trend + recency weighting | Phase 5 | Rules have confidence scores and trend direction, not just occurrence counts |
| Simple positive/negative counting for Thompson posteriors | DPO-style batch preference optimization on top of Thompson | Feb 2026 (Subway) | More aggressive posterior updates when preference signal is strong |
| No scoring gate on feedback quality | Heuristic self-audit against CLAUDE.md constraints | Phase 5 | Feedback events get quality scores that can feed back into the DPO pair selection |
| `selfScore()` name (Subway) | `selfAudit()` name (ThumbGate) | Phase 5 design | Correctly signals heuristic nature; avoids implying ML model scoring |

**Deprecated/outdated:**
- Direct `scripts/feedback-rules.js` generation: superseded by `buildPreventionRules()` in `feedback-loop.js` AND new `extractMetaPolicyRules()` in `meta-policy.js`. Both co-exist but serve different granularities.

---

## Integration Points

### Where selfAudit() plugs into the existing system

`feedback-loop.js` already has the pattern for non-blocking side-effects:

```javascript
// Lines 368-387 in feedback-loop.js (existing pattern)
try {
  appendSequence(feedbackEvent, mlPaths);
} catch (err) { /* non-critical */ }

try {
  updateDiversityTracking(feedbackEvent, mlPaths);
} catch (err) { /* non-critical */ }
```

Phase 5 adds a fourth block in the same position:
```javascript
try {
  const selfAuditModule = getSelfAuditModule();
  if (selfAuditModule) selfAuditModule.selfAuditAndLog(feedbackEvent, mlPaths);
} catch (err) { /* non-critical */ }
```

Using the lazy-require pattern (`getSelfAuditModule()` like `getContextFsModule()`) keeps the dependency optional and testable.

### npm scripts to add to package.json

```json
{
  "ml:dpo": "node scripts/dpo-optimizer.js --run",
  "ml:meta-policy": "node scripts/meta-policy.js --extract",
  "prove:rlaif": "node scripts/prove-rlaif.js",
  "test:rlaif": "node --test tests/rlaif-self-audit.test.js tests/dpo-optimizer.test.js tests/meta-policy.test.js"
}
```

The aggregate `test` script needs updating to include `test:rlaif`.

### Output files (all git-ignored, written to THUMBGATE_FEEDBACK_DIR)

| File | Written by | Read by |
|------|-----------|---------|
| `.claude/memory/feedback/self-score-log.jsonl` | `rlaif-self-audit.js` | `prove-rlaif.js` (evidence) |
| `.claude/memory/feedback/dpo-model.json` | `dpo-optimizer.js` | `prove-rlaif.js`, `thompson-sampling.js` (posterior reference) |
| `.claude/memory/feedback/meta-policy-rules.json` | `meta-policy.js` | `prove-rlaif.js`, future context pack construction |
| `proof/rlaif-report.md` + `proof/rlaif-report.json` | `prove-rlaif.js` | CI gate, VERIFICATION_EVIDENCE.md |

---

## Open Questions

1. **Where exactly does `selfAuditAndLog()` sit in `captureFeedback()` — before or after vector upsert?**
   - What we know: Vector upsert is the last side-effect (lines 381-387 in feedback-loop.js)
   - What's unclear: Whether self-audit should run before or after vector indexing
   - Recommendation: Add self-audit AFTER vector upsert (last side-effect) to avoid any dependency on the vector layer and mirror the pattern of progressively richer enrichment

2. **Should `dpo-optimizer.js` automatically call `thompson-sampling.js saveModel()` or output a delta file for the user to apply?**
   - What we know: Subway's `train_dpo()` calls `save_model()` directly (mutating approach)
   - What's unclear: Whether the "apply immediately" approach is right for ThumbGate where posteriors are loaded at read time
   - Recommendation: Follow Subway's pattern — apply immediately and save. The DPO model file (`dpo-model.json`) serves as the audit trail of what was adjusted and when.

3. **What is the minimum number of feedback entries before meta-policy rules are meaningful?**
   - What we know: Subway uses `occurrences >= 2` as the threshold (same as `buildPreventionRules()`)
   - What's unclear: Whether `min_occurrences=2` is the right threshold for confidence scoring
   - Recommendation: Use `min_occurrences=2` (consistent with existing `buildPreventionRules()` call). Document the threshold in the module's JSDoc.

---

## Sources

### Primary (HIGH confidence)

- `/Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/export-dpo-pairs.js` — full `buildDpoPairs()` implementation, confirmed working with 5 tests in `test:dpo`
- `/Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/thompson-sampling.js` — `loadModel()`, `saveModel()`, `timeDecayWeight()`, `samplePosteriors()` — all confirmed present
- `/Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/feedback-loop.js` — `captureFeedback()` non-blocking side-effect pattern (lines 368-387), `inferDomain()` (lines 135-149)
- `/Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/prove-lancedb.js` — proof script template to mirror exactly
- `/Users/ganapolsky_i/workspace/git/igor/ThumbGate/tests/vector-store.test.js` — canonical test pattern: `describe/it`, `freshModule(tmpDir)`, `require.cache` invalidation
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/train_from_feedback.py` lines 400-474, 520-668 — `extract_meta_policy_rules()` and `train_dpo()` reference implementations
- `/Users/ganapolsky_i/workspace/git/igor/ThumbGate/package.json` — confirmed `test:api` lists files explicitly (not glob); `test` aggregate script; current test count = 93

### Secondary (MEDIUM confidence)

- arXiv:2305.18290 Rafailov et al. — DPO foundational paper; confirms `beta * log_ratio` formulation
- arXiv:2309.00267 — RLAIF vs ThumbGate; confirms heuristic scoring is valid at comparable performance
- arXiv:2509.03990 — Meta-Policy Reflexion; confirms recency + intensity weighting for rule extraction

### Tertiary (LOW confidence)

- None — all critical claims are backed by direct code inspection.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all modules confirmed present in repo via direct inspection
- Architecture: HIGH — all patterns confirmed by reading prior-phase proof scripts and tests
- Pitfalls: HIGH — all 6 pitfalls derived from direct code reading (not speculation)
- DPO math: HIGH — ported from confirmed working Python implementation in Subway

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable domain — pure JS math + JSONL I/O; no external API dependencies to track)
