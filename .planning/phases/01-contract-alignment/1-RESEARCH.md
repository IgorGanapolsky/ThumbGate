# Phase 1: Contract Alignment - Research

**Researched:** 2026-03-04
**Domain:** Cross-repo JavaScript module contract auditing — exports, schema parameters, timestamp normalization
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CNTR-01 | Export mapping audit confirms all shared function names are compatible between repos | Direct code inspection of both repos' `module.exports` in 5 shared scripts confirms exact divergence points |
| CNTR-02 | Schema divergence resolved — rubricEvaluation parameter handled consistently | Confirmed: ThumbGate `feedback-schema.js` accepts `rubricEvaluation` in `resolveFeedbackAction`; Subway's does not — specific line diff documented below |
| CNTR-03 | Timestamp format normalized (ISO 8601 with Z suffix) across both repos | Both repos use `new Date().toISOString()` (always produces Z-suffix). Python side strips Z with `.replace("Z", "")`. `parseTimestamp()` helper must be created — does not exist yet in either repo |
</phase_requirements>

---

## Summary

Phase 1 is a pure audit-and-normalize phase. No new features are built. The goal is to verify that both repos speak the same contract so that Phases 2 and 3 can port code without breaking caller assumptions.

Direct code inspection of both repos reveals that the shared scripts (`feedback-schema.js`, `feedback-loop.js`, `export-dpo-pairs.js`) have diverged at three specific points. The exports differ significantly between `feedback-loop.js` files (ThumbGate exports `captureFeedback` / `buildPreventionRules` / `writePreventionRules` / `readJSONL` / `getFeedbackPaths`; Subway exports `recordFeedback` / `selfScore` / constants). The `resolveFeedbackAction` function in ThumbGate's `feedback-schema.js` accepts a `rubricEvaluation` parameter and gates positive promotion through it — Subway's version does not. For timestamps, both repos already use `new Date().toISOString()` (which always produces ISO 8601 with Z suffix), but the Python `train_from_feedback.py` strips the Z with `.replace("Z", "")` before parsing. A `parseTimestamp()` helper function does not exist in either repo and must be created as part of CNTR-03.

The baseline test count for thumbgate is: 54 node-runner tests (52 from `test:api` + 2 from `test:proof`) and 23 script-runner tests (7 schema + 10 loop + 6 dpo) = 77 total assertions. The ROADMAP's "54" refers specifically to the `node --test` runner count. All 77 currently pass and CI is green.

**Primary recommendation:** Write a `scripts/contract-audit.js` script that programmatically extracts exports from both repos' shared scripts and emits a compatibility report. Then add `rubricEvaluation` support to Subway's `feedback-schema.js` to match ThumbGate. Then add a shared `parseTimestamp()` helper to `feedback-schema.js` in both repos. Write tests for all three deliverables.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in `module` | Node 18+ | `require()` / `module.exports` introspection | Already in use; no dependency needed |
| Node.js built-in `--test` runner | Node 18+ | Test runner for audit and regression tests | Already in use in `test:api` and `test:proof` suites |
| Node.js built-in `fs` | Node 18+ | File I/O for audit script | Already in use across all scripts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `path` (built-in) | Node 18+ | Resolve cross-repo file paths | For audit script requiring both repos' modules |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom audit script | `madge` or `dependency-cruiser` | Overkill for this phase; both tools analyze import graphs, not export shapes. Custom script is 50 lines. |
| `new Date().toISOString()` inline | `date-fns` / `luxon` | No external dep needed; built-in `Date.toISOString()` already produces correct ISO 8601+Z format. |

**Installation:** No new npm packages required for Phase 1. All tools are Node.js built-ins.

---

## Architecture Patterns

### Recommended Project Structure for Phase 1 Deliverables

```
scripts/
├── contract-audit.js       # NEW: export compatibility audit script
├── feedback-schema.js      # MODIFY: add rubricEvaluation + parseTimestamp()
tests/
├── contract-audit.test.js  # NEW: node --test tests for audit
├── feedback-schema.test.js # NEW: node --test tests for rubricEvaluation + parseTimestamp
proof/
└── contract-audit-report.md  # NEW: generated evidence for CNTR-01
```

### Pattern 1: Export Shape Auditing

**What:** Require both repos' modules at runtime from the audit script, compare the keys of their `module.exports` objects, and emit a diff.

**When to use:** Whenever two repos are expected to share a module interface.

**Example:**
```javascript
// scripts/contract-audit.js
const THUMBGATE_ROOT = path.join(__dirname, '..');
const SUBWAY_ROOT = '/path/to/Subway_RN_Demo';

const thumbgateSchema = require(path.join(THUMBGATE_ROOT, 'scripts/feedback-schema'));
const subwaySchema = require(path.join(SUBWAY_ROOT, 'scripts/feedback-schema'));

const thumbgateKeys = Object.keys(thumbgateSchema);
const subwayKeys = Object.keys(subwaySchema);

// Shared: keys in both
// Only-in-ThumbGate: keys missing from Subway
// Only-in-subway: keys missing from ThumbGate
```

The audit must cover all 3 shared scripts: `feedback-schema.js`, `feedback-loop.js`, `export-dpo-pairs.js`.

### Pattern 2: Additive Schema Extension (rubricEvaluation)

**What:** Add `rubricEvaluation` as an optional parameter to Subway's `resolveFeedbackAction`. If absent, behavior is unchanged (backward-compatible). If present, enforce the same gate logic as ThumbGate.

**When to use:** Whenever ThumbGate has a parameter Subway lacks. Always extend additively — never break existing callers.

**Example (what ThumbGate has, Subway needs):**
```javascript
// ThumbGate/scripts/feedback-schema.js lines 84-109 (verified by direct read)
function resolveFeedbackAction(params) {
  const {
    signal, context, whatWentWrong, whatToChange, whatWorked, tags,
    rubricEvaluation,   // <-- Subway is missing this
  } = params;

  // rubricEvaluation present → build rubricSummary, check promotionEligible gate
  const rubricSummary = rubricEvaluation ? {
    rubricId: rubricEvaluation.rubricId,
    weightedScore: rubricEvaluation.weightedScore,
    failingCriteria: rubricEvaluation.failingCriteria || [],
    failingGuardrails: rubricEvaluation.failingGuardrails || [],
    judgeDisagreements: rubricEvaluation.judgeDisagreements || [],
    blockReasons: rubricEvaluation.blockReasons || [],
  } : null;

  // positive signal gate:
  if (signal === 'positive') {
    if (rubricEvaluation && !rubricEvaluation.promotionEligible) {
      const reasons = rubricEvaluation.blockReasons?.join('; ') || 'rubric gate did not pass';
      return { type: 'no-action', reason: `Rubric gate prevented promotion: ${reasons}` };
    }
    // ... rest of positive logic
  }
}
```

### Pattern 3: Shared parseTimestamp() Helper

**What:** A single function that accepts any timestamp string from either repo and returns a valid `Date` object. Handles: ISO 8601 with Z (`"2026-03-04T12:00:00.000Z"`), ISO 8601 without Z (`"2026-03-04T12:00:00"`), ISO 8601 with offset (`"2026-03-04T12:00:00+05:00"`). Returns `null` (not `NaN`) for unparseable input.

**When to use:** Phase 2's time-decay functions in Python already strip Z with `.replace("Z", "")`. The JS side should normalize first so the Python side doesn't need hacks.

**Example:**
```javascript
// Add to BOTH repos' feedback-schema.js
function parseTimestamp(ts) {
  if (!ts) return null;
  // Normalize: strip offset or ensure Z suffix
  const normalized = String(ts).trim();
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return null;
  return d;
}

module.exports = {
  // ... existing exports
  parseTimestamp,
};
```

**Verification test:**
```javascript
const { parseTimestamp } = require('./feedback-schema');
assert(parseTimestamp('2026-03-04T12:00:00.000Z') instanceof Date, 'Z suffix');
assert(parseTimestamp('2026-03-04T12:00:00') instanceof Date, 'no suffix');
assert(parseTimestamp('2026-03-04T12:00:00+05:00') instanceof Date, 'offset');
assert(parseTimestamp(null) === null, 'null input');
assert(parseTimestamp('garbage') === null, 'invalid returns null');
assert(!isNaN(parseTimestamp('2026-03-04T12:00:00.000Z').getTime()), 'no NaN');
```

### Anti-Patterns to Avoid

- **Re-merging entire files:** Do not copy the entire ThumbGate `feedback-schema.js` into Subway. Apply only the missing `rubricEvaluation` logic surgically. The two files have different test harnesses (ThumbGate has 7 inline tests, Subway has 32 inline tests).
- **Assuming `toISOString()` variance:** Both repos already call `new Date().toISOString()`. Do not change timestamp production — only add the `parseTimestamp()` consumer helper.
- **Function rename over alias:** The `feedback-loop.js` exports differ fundamentally (`captureFeedback` vs `recordFeedback`). Do NOT rename — document the alias map. Phase 1 maps names, does not unify the implementations.
- **Running Subway's Jest tests as part of ThumbGate CI:** These are separate repos. Baseline for Phase 1 is ThumbGate's own test suite.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Export shape diffing | Custom AST parser | `Object.keys(require(path))` at runtime | Module evaluation is authoritative; AST misses computed exports |
| Timestamp validation | Custom regex | `new Date(str)` + `isNaN(d.getTime())` check | Handles all ISO 8601 variants; V8 Date parser is spec-compliant |
| Cross-repo require | Symlinks or monorepo setup | Absolute `require()` paths in audit script | Phase 1 is read-only audit; no repo restructuring |

**Key insight:** The contract audit requires zero external tooling. Node's own `require()` + `Object.keys()` is the most reliable way to extract the exact runtime export shape.

---

## Common Pitfalls

### Pitfall 1: Assuming feedback-schema.js Files Are Identical

**What goes wrong:** The two `feedback-schema.js` files look nearly identical at first glance. They share the same exports list, same constants, same `validateFeedbackMemory`. The only divergence is `resolveFeedbackAction`'s handling of `rubricEvaluation` (lines 84-186 in ThumbGate vs lines 127-189 in Subway).

**Why it happens:** Both files share common ancestry but ThumbGate's was extended with rubric evaluation after Subway's copy was made.

**How to avoid:** Do a line-by-line diff of `resolveFeedbackAction` specifically, not just the exports list. The export keys match — the behavior differs.

**Warning signs:** Subway's `resolveFeedbackAction` destructures only `{ signal, context, whatWentWrong, whatToChange, whatWorked, tags }`. ThumbGate's destructures `rubricEvaluation` additionally. If you call Subway's with `rubricEvaluation` set, it silently ignores it.

### Pitfall 2: feedback-loop.js Has Fundamentally Different Interfaces

**What goes wrong:** ThumbGate's `feedback-loop.js` exports `captureFeedback`, `analyzeFeedback`, `buildPreventionRules`, `writePreventionRules`, `feedbackSummary`, `readJSONL`, `getFeedbackPaths`. Subway's exports `recordFeedback`, `analyzeFeedback`, `selfScore`, `feedbackSummary`, `FEEDBACK_LOG_PATH`, `SELF_SCORE_LOG_PATH`.

**Why it happens:** These were developed independently with different caller interfaces. The shared names are `analyzeFeedback` and `feedbackSummary`, but they have different signatures (`feedbackSummary(recentN)` in ThumbGate vs `feedbackSummary(recentN, logPath)` in Subway).

**How to avoid:** The Phase 1 contract audit must document this as an ALIAS MAP, not a collision. The planner must NOT attempt to unify these in Phase 1.

**Warning signs:** If you see a task that says "rename `recordFeedback` to `captureFeedback`" in Phase 1 — that is scope creep. Phase 1 maps, Phase 2/3 ports.

### Pitfall 3: Baseline Test Count Confusion

**What goes wrong:** The ROADMAP says "54 for thumbgate" but `npm test` currently runs 77 total assertions (52 from `node --test` in `test:api`, 2 from `test:proof`, 7+10+6=23 from inline script runners).

**Why it happens:** "54" = the `node --test` runner count only (52 + 2 = 54). The 23 inline script tests use `process.exit()` which bypasses the `node --test` counter.

**How to avoid:** Record the baseline as two numbers: 54 node-runner tests and 23 script-runner tests. Success criterion is CI green with all 77 passing before Phase 2 begins.

### Pitfall 4: Python timestamp.replace("Z", "") Mismatch

**What goes wrong:** Python's `train_from_feedback.py` line 139 does `ts_clean = timestamp_str.replace("Z", "").split("+")[0]` before calling `datetime.fromisoformat(ts_clean)`. If Node.js ever writes a timestamp without a Z suffix (e.g., from a local timezone), Python silently gets a wrong time.

**Why it happens:** Python's `datetime.fromisoformat()` before Python 3.11 does not accept the trailing `Z`. The `.replace("Z", "")` is a workaround.

**How to avoid:** The `parseTimestamp()` JS helper must never alter how timestamps are WRITTEN — only how they are READ. Node's `new Date().toISOString()` always produces Z-suffix format, which is correct. Document this explicitly in the helper's JSDoc.

**Warning signs:** Any code that writes timestamps using `new Date().toLocaleString()` or without `.toISOString()` must be caught in the audit.

---

## Code Examples

Verified patterns from direct code inspection:

### Contract Audit Script Structure
```javascript
// scripts/contract-audit.js
// Source: derived from actual module.exports of both repos (verified 2026-03-04)
const path = require('path');
const fs = require('fs');

const THUMBGATE_ROOT = path.join(__dirname, '..');
const SUBWAY_ROOT = '/Users/ganapolsky_i/workspace/git/Subway_RN_Demo';

const SHARED_SCRIPTS = [
  'scripts/feedback-schema.js',
  'scripts/feedback-loop.js',
  'scripts/export-dpo-pairs.js',
];

function auditScript(relPath) {
  const thumbgateMod = require(path.join(THUMBGATE_ROOT, relPath));
  const subwayMod = require(path.join(SUBWAY_ROOT, relPath));
  const thumbgateKeys = Object.keys(thumbgateMod).sort();
  const subwayKeys = Object.keys(subwayMod).sort();
  return {
    script: relPath,
    thumbgateOnly: thumbgateKeys.filter(k => !subwayKeys.includes(k)),
    subwayOnly: subwayKeys.filter(k => !thumbgateKeys.includes(k)),
    shared: thumbgateKeys.filter(k => subwayKeys.includes(k)),
    compatible: thumbgateKeys.filter(k => !subwayKeys.includes(k)).length === 0
                && subwayKeys.filter(k => !thumbgateKeys.includes(k)).length === 0,
  };
}

const report = SHARED_SCRIPTS.map(auditScript);
// emit JSON + markdown report
```

### Known Export Divergence (verified by direct read, 2026-03-04)

**feedback-schema.js** — exports IDENTICAL in both repos:
```
ThumbGate:   validateFeedbackMemory, resolveFeedbackAction, prepareForStorage, GENERIC_TAGS, MIN_CONTENT_LENGTH, VALID_TITLE_PREFIXES, VALID_CATEGORIES
Subway: validateFeedbackMemory, resolveFeedbackAction, prepareForStorage, GENERIC_TAGS, MIN_CONTENT_LENGTH, VALID_TITLE_PREFIXES, VALID_CATEGORIES
STATUS: COMPATIBLE (exports match; behavior diverges inside resolveFeedbackAction)
```

**feedback-loop.js** — exports DIVERGE:
```
ThumbGate:   captureFeedback, analyzeFeedback, buildPreventionRules, writePreventionRules, feedbackSummary, readJSONL, getFeedbackPaths, FEEDBACK_LOG_PATH (getter), MEMORY_LOG_PATH (getter), SUMMARY_PATH (getter), PREVENTION_RULES_PATH (getter)
Subway: recordFeedback, analyzeFeedback, selfScore, feedbackSummary, FEEDBACK_LOG_PATH (string), SELF_SCORE_LOG_PATH (string)
SHARED: analyzeFeedback, feedbackSummary
ThumbGate-only: captureFeedback, buildPreventionRules, writePreventionRules, readJSONL, getFeedbackPaths, MEMORY_LOG_PATH, SUMMARY_PATH, PREVENTION_RULES_PATH
Subway-only: recordFeedback, selfScore, SELF_SCORE_LOG_PATH
STATUS: INCOMPATIBLE — alias map required, no rename in Phase 1
```

**export-dpo-pairs.js** — exports DIVERGE:
```
ThumbGate:   readJSONL, extractDomainKeys, domainOverlap, inferPrompt, buildDpoPairs, toJSONL, exportDpoFromMemories, DEFAULT_LOCAL_MEMORY_LOG
Subway: extractDomainKeys, domainOverlap, buildDpoPairs, validateMemoryStructure, inferPrompt, toJSONL
SHARED: extractDomainKeys, domainOverlap, inferPrompt, buildDpoPairs, toJSONL
ThumbGate-only: readJSONL, exportDpoFromMemories, DEFAULT_LOCAL_MEMORY_LOG
Subway-only: validateMemoryStructure
STATUS: PARTIALLY COMPATIBLE — shared core is compatible; extras are additive
```

### rubricEvaluation Divergence (CNTR-02)
```javascript
// ThumbGate/scripts/feedback-schema.js line 84-109 (verified)
// ThumbGate resolveFeedbackAction destructures rubricEvaluation:
const {
  signal, context, whatWentWrong, whatToChange, whatWorked, tags,
  rubricEvaluation,  // <-- PRESENT IN ThumbGate, ABSENT IN SUBWAY
} = params;

// ThumbGate builds rubricSummary from it (lines 100-109)
// ThumbGate gates positive promotion through rubricEvaluation.promotionEligible (lines 153-157)

// Subway/scripts/feedback-schema.js line 127-128 (verified)
// Subway resolveFeedbackAction destructures WITHOUT rubricEvaluation:
const { signal, context, whatWentWrong, whatToChange, whatWorked, tags } = params;
// rubricEvaluation is silently ignored if passed
```

**Resolution for CNTR-02:** Add `rubricEvaluation` destructuring and gate logic to Subway's `resolveFeedbackAction`, matching ThumbGate exactly. Add test cases for rubric gate in Subway's inline test suite.

### Timestamp Audit (CNTR-03)
```javascript
// Both repos write: new Date().toISOString()
// Output example: "2026-03-04T15:30:00.000Z"  ← always has Z suffix

// Python reads (train_from_feedback.py line 139):
// ts_clean = timestamp_str.replace("Z", "").split("+")[0]
// → "2026-03-04T15:30:00.000"
// datetime.fromisoformat(ts_clean)  → valid in Python 3.7+

// parseTimestamp() to create (add to BOTH repos' feedback-schema.js):
function parseTimestamp(ts) {
  if (ts == null) return null;
  const d = new Date(String(ts).trim());
  return isNaN(d.getTime()) ? null : d;
}
// new Date("2026-03-04T15:30:00.000Z").getTime() → valid (not NaN)
// new Date("2026-03-04T15:30:00").getTime()      → valid (not NaN)
// new Date("garbage").getTime()                   → NaN → returns null
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual file diffing | Runtime `require()` + `Object.keys()` audit | This phase | Catches behavioral divergence, not just text differences |
| Inline timestamp parsing scattered across files | Shared `parseTimestamp()` helper in `feedback-schema.js` | This phase | Single source of truth, tested, no NaN |

**Deprecated/outdated:**
- Python's `.replace("Z", "")` hack: safe to keep as-is after Phase 1 since JS always writes Z-suffix. Do not change Python side in Phase 1.

---

## Open Questions

1. **Should `validateMemoryStructure` (Subway's `export-dpo-pairs.js`) be backported to ThumbGate?**
   - What we know: Subway has it, ThumbGate does not. It validates memory objects before DPO pair building.
   - What's unclear: Whether Phase 2 (ML into ThumbGate) will need it or bring its own validation.
   - Recommendation: Document as "Subway-only" in the alias map. Do not port in Phase 1. Flag for Phase 2 planner.

2. **Should `selfScore` (Subway's `feedback-loop.js`) be in scope for Phase 1?**
   - What we know: It's a Subway-only export, not in ThumbGate. Phase 1 is audit-only.
   - What's unclear: Phase 2 vs Phase 5 will use it (RLAIF self-scoring is DPO-01).
   - Recommendation: Alias-map it as "Subway-only, no action in Phase 1." Phase 5 planner handles it.

3. **Exact Subway test count for baseline?**
   - What we know: Subway uses Jest (`jest.config.js`). The ROADMAP only specifies ThumbGate's count (54 node tests).
   - What's unclear: Whether Subway's Jest tests cover `feedback-schema.js` and `feedback-loop.js` at all — there is a `scripts/__tests__/feedback-loop.test.js` present.
   - Recommendation: Run `npx jest scripts/__tests__/feedback-loop.test.js` in Subway as part of the audit to capture a baseline. Not required for CNTR-01/02/03 success criteria but good hygiene before Phase 3 ports to Subway.

---

## Sources

### Primary (HIGH confidence)
- Direct `Read` of `/Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/feedback-schema.js` — full file, verified exports and `rubricEvaluation` handling
- Direct `Read` of `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-schema.js` — full file, confirmed `rubricEvaluation` absent
- Direct `Read` of `/Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/feedback-loop.js` — full file, confirmed exports
- Direct `Read` of `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/feedback-loop.js` — full file, confirmed `recordFeedback` vs `captureFeedback`
- `Bash: npm test` in ThumbGate repo — confirmed 54 node-runner + 23 script-runner = 77 total, all passing
- `Bash: grep "module.exports"` across both repos — confirmed export divergence in `export-dpo-pairs.js`
- Direct `Read` of `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/train_from_feedback.py` — lines 132-144 confirm Python Z-stripping pattern

### Secondary (MEDIUM confidence)
- `.planning/ROADMAP.md` — confirmed "54 for thumbgate" refers to node --test count (52 test:api + 2 test:proof)
- `.planning/REQUIREMENTS.md` — confirmed CNTR-01, CNTR-02, CNTR-03 scope

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Export divergence map: HIGH — verified by direct `Object.keys()` inspection of actual module.exports in both repos
- rubricEvaluation gap: HIGH — verified by reading both `resolveFeedbackAction` implementations line by line
- Timestamp handling: HIGH — verified by reading all timestamp writes (`new Date().toISOString()`) and Python reads (`.replace("Z", "")`)
- Baseline test count: HIGH — verified by running `npm test` live in ThumbGate repo

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (30 days; scripts change slowly, but any merge to either repo could shift counts)
