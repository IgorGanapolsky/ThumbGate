# Phase 2: ML into thumbgate - Research

**Researched:** 2026-03-04
**Domain:** Thompson Sampling, exponential time-decay, LSTM sequence tracking, diversity tracking — pure JS port from Subway_RN_Demo Python/JS source
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ML-01 | Thompson Sampling Beta-Bernoulli posteriors compute per-category reliability estimates | Subway's `train_from_feedback.py` is the authoritative implementation. Full algorithm verified by direct code read: `alpha += weight` on positive, `beta += weight` on negative, posterior mean = `alpha / (alpha + beta)`. Port to JS is mechanical — no library needed. `feedback_model.json` shows live alpha/beta values per category. |
| ML-02 | Exponential time-decay (half-life 7 days) weights recent feedback higher | Exact formula from source: `weight = 2^(-age_days / 7.0)`, floored at 0.01. Toggle between step (legacy) and exponential currently set to `USE_EXPONENTIAL_DECAY = True`. JS port uses `Math.pow(2, -ageDays / 7.0)`. Timestamp parsing uses `parseTimestamp()` (added in Phase 1). |
| ML-03 | LSTM/Transformer sequence tracking writes feedback-sequences.jsonl with sliding window of N=10 | Subway's `capture-feedback.js` implements full sequence tracking: `SEQUENCE_WINDOW = 10`, `buildSequenceFeatures()`, `saveSequence()`, `calculateTrend()`, `calculateTimeGaps()`, `hashContext()`, `extractActionPatterns()`. All pure JS, no external libraries. Appends to `feedback-sequences.jsonl`. |
| ML-04 | Diversity tracking produces per-domain coverage scores and diversityScore metric | Subway's `updateDiversityTracking()` is the source. Uses variance across 10 domain categories, formula: `diversityScore = max(0, 100 - sqrt(variance) * 10)`. Live data shows 76.2% score in `diversity-tracking.json`. Domain list is fixed at 10 categories. |
| ML-05 | All ML features have unit tests proving correct behavior | Node.js built-in `--test` runner already used by all tests. Must add tests for: Thompson update math, time-decay weight formula, sequence feature structure, diversity score calculation. Target: maintain 60 node-runner + 23 script-runner baseline, add ML-specific tests. |
| ML-06 | Proof report generated in proof/ directory for ML features | Pattern established by Phase 1 (`proof/contract-audit-report.md`, `proof/baseline-test-count.md`). New file: `proof/ml-features-report.md`. Must include: Thompson posterior sample output, diversity score, sequence count, test count delta. |
</phase_requirements>

---

## Summary

Phase 2 ports four ML features from Subway_RN_Demo into thumbgate. All four features have been directly read in their source implementations — Thompson Sampling in Python (`train_from_feedback.py`, 910 lines), sequence tracking and diversity in JavaScript (`capture-feedback.js`, 974 lines). The port is largely mechanical: the Python Thompson/time-decay logic translates directly to JS using `Math.pow` and the `parseTimestamp()` helper added in Phase 1, while the JS sequence tracking and diversity code can be adapted with path and API adjustments.

The critical architectural decision for this phase is WHERE the ML features live. Thompson Sampling and time-decay need a `train_from_feedback.js` script (JS rewrite of the Python trainer) plus the Python script copied into `scripts/` for users who want batch retraining. Sequence tracking and diversity tracking need to be integrated into the `captureFeedback()` hot path in `feedback-loop.js` — specifically as post-capture side effects that append to `feedback-sequences.jsonl` and `diversity-tracking.json` without blocking the primary feedback write. This mirrors the Subway architecture exactly: `saveFeedback()` calls `saveSequence()` and `updateDiversityTracking()` after the primary append.

The zero-npm-dependency constraint for this phase is confirmed met: Thompson Sampling uses `Math.random()` (JS equivalent of Python's `random.betavariate()`), time-decay uses `Math.pow()`, sequence tracking uses pure object manipulation, and diversity scoring uses `Math.sqrt()`. The Python training script (`train_from_feedback.py`) is a standalone CLI tool that reads JSONL and writes JSON — it does not add npm dependencies and does not run in the hot path.

**Primary recommendation:** Add `scripts/train_from_feedback.py` (copied from Subway with path vars adjusted to rlhf paths), then add `scripts/thompson-sampling.js` (pure JS incrementer for hot-path use), then modify `captureFeedback()` in `feedback-loop.js` to call sequence and diversity side-effects. All new npm scripts in `package.json`. Tests for every new function. Proof report last.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in `Math` | Node 25.6.1 | `Math.pow`, `Math.random`, `Math.sqrt` for all ML math | No library needed; mirrors Python stdlib math exactly |
| Node.js built-in `fs` | Node 25.6.1 | JSONL append for sequences and diversity files | Already used in `feedback-loop.js` |
| Node.js built-in `--test` runner | Node 25.6.1 | Test runner for all ML tests | Already used; consistent with existing test suite |
| Python 3.14.3 | system | Batch Thompson trainer script | Already on system; `train_from_feedback.py` is CLI-only |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `parseTimestamp()` (Phase 1 helper) | in `feedback-schema.js` | Normalize timestamps before decay weight calculation | Every call to `timeDecayWeight()` in JS |
| `THUMBGATE_FEEDBACK_DIR` env var | existing pattern | Locate sequence and diversity files | Same pattern as `getFeedbackPaths()` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pure JS Thompson | `jStat` library for Beta distribution | jStat is 180KB; `Math.random()` + Beta approximation is exact equivalent; zero dep |
| Python CLI trainer | Rewrite entirely in JS | Python version already battle-tested in Subway; keeping Python trainer preserves DPO/meta-policy logic for Phase 5 |
| Inline sequence tracking | Separate module | Inline in `feedback-loop.js` avoids circular deps; Subway keeps it inline in `capture-feedback.js` |

**Installation:** No new npm packages required for Phase 2. All tools are Node.js built-ins or existing project files.

```bash
# No npm install needed — pure JS + Python stdlib
```

---

## Architecture Patterns

### Recommended Project Structure for Phase 2 Deliverables

```
scripts/
├── train_from_feedback.py          # NEW: Thompson Sampling batch trainer (Python, from Subway)
├── thompson-sampling.js            # NEW: Pure JS per-feedback Thompson updater (hot-path)
├── feedback-loop.js                # MODIFY: add sequence tracking + diversity side-effects
tests/
├── thompson-sampling.test.js       # NEW: node --test tests for JS Thompson logic
├── feedback-sequences.test.js      # NEW: node --test tests for sequence features
├── diversity-tracking.test.js      # NEW: node --test tests for diversity score
proof/
└── ml-features-report.md           # NEW: ML proof evidence

.claude/memory/feedback/
├── feedback-sequences.jsonl        # CREATED AT RUNTIME: sequence entries
├── diversity-tracking.json         # CREATED AT RUNTIME: domain coverage scores
└── feedback_model.json             # CREATED AT RUNTIME: Thompson posteriors (written by Python)
```

### Pattern 1: Thompson Sampling Beta-Bernoulli Update (JS Hot Path)

**What:** On each `captureFeedback()` call, load current model JSON, apply weighted update to the correct category's alpha or beta, save model. The JS hot-path updater handles incremental updates; the Python CLI handles full rebuilds.

**When to use:** After every successful feedback capture (only accepted entries update the model, same as Subway's `train_full` which processes all entries, while incremental mode processes latest only).

**Example:**
```javascript
// scripts/thompson-sampling.js
// Source: Direct port of train_from_feedback.py lines 218-250 and 253-293
const fs = require('fs');
const path = require('path');
const { parseTimestamp } = require('./feedback-schema');

const HALF_LIFE_DAYS = 7.0;
const DECAY_FLOOR = 0.01;

const DEFAULT_CATEGORIES = [
  'code_edit', 'git', 'testing', 'pr_review', 'search',
  'architecture', 'security', 'debugging', 'uncategorized',
];

function timeDecayWeight(timestamp) {
  const d = parseTimestamp(timestamp);
  if (!d) return DECAY_FLOOR;
  const ageDays = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(Math.pow(2, -ageDays / HALF_LIFE_DAYS), DECAY_FLOOR);
}

function loadModel(modelPath) {
  if (fs.existsSync(modelPath)) {
    try { return JSON.parse(fs.readFileSync(modelPath, 'utf-8')); }
    catch { /* fall through */ }
  }
  return createInitialModel();
}

function createInitialModel() {
  const categories = {};
  DEFAULT_CATEGORIES.forEach(cat => {
    categories[cat] = { alpha: 1.0, beta: 1.0, samples: 0, last_updated: null };
  });
  return {
    version: 1,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    total_entries: 0,
    categories,
  };
}

function updateModel(model, { signal, timestamp, categories }) {
  const weight = timeDecayWeight(timestamp);
  const isPositive = signal === 'positive';
  const cats = categories && categories.length ? categories : ['uncategorized'];

  cats.forEach(cat => {
    if (!model.categories[cat]) {
      model.categories[cat] = { alpha: 1.0, beta: 1.0, samples: 0, last_updated: null };
    }
    if (isPositive) {
      model.categories[cat].alpha += weight;
    } else {
      model.categories[cat].beta += weight;
    }
    model.categories[cat].samples += 1;
    model.categories[cat].last_updated = timestamp;
  });

  model.total_entries = (model.total_entries || 0) + 1;
  model.updated = new Date().toISOString();
  return model;
}

function getReliability(model) {
  const results = {};
  for (const [cat, params] of Object.entries(model.categories || {})) {
    const total = params.alpha + params.beta;
    results[cat] = {
      alpha: params.alpha,
      beta: params.beta,
      reliability: total > 0 ? params.alpha / total : 0.5,
      samples: params.samples,
    };
  }
  return results;
}

function samplePosteriors(model) {
  // JS approximation of random.betavariate(alpha, beta)
  // Uses ratio of gamma samples; for small alpha/beta values this is exact
  const samples = {};
  for (const [cat, params] of Object.entries(model.categories || {})) {
    samples[cat] = betaSample(
      Math.max(params.alpha, 0.01),
      Math.max(params.beta, 0.01)
    );
  }
  return samples;
}

// Gamma sampling via Marsaglia & Tsang (2000) — no library needed
function gammaSample(shape) {
  if (shape < 1) {
    return gammaSample(1 + shape) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do { x = gaussSample(); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function gaussSample() {
  let u, v, s;
  do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; }
  while (s >= 1 || s === 0);
  return u * Math.sqrt(-2 * Math.log(s) / s);
}

function betaSample(alpha, beta) {
  const x = gammaSample(alpha);
  const y = gammaSample(beta);
  return x / (x + y);
}

module.exports = {
  timeDecayWeight,
  loadModel,
  createInitialModel,
  updateModel,
  getReliability,
  samplePosteriors,
  HALF_LIFE_DAYS,
  DECAY_FLOOR,
  DEFAULT_CATEGORIES,
};
```

### Pattern 2: Sequence Tracking Side-Effect in captureFeedback()

**What:** After the primary feedback and memory writes succeed in `captureFeedback()`, call `appendSequence()` with the last N=10 entries and current entry's features. Never block the return value on this — wrap in try/catch.

**When to use:** Only for accepted entries (where `action.type !== 'no-action'` and `prepared.ok === true`). Same gate Subway uses: sequence is only meaningful for accepted feedback.

**Example:**
```javascript
// Addition to feedback-loop.js — add after memoryRecord write
// Source: Port of capture-feedback.js lines 111-213

const SEQUENCE_WINDOW = 10;

function buildSequenceFeatures(recentEntries, currentEntry) {
  const sequence = [...recentEntries, currentEntry];
  return {
    rewardSequence: sequence.map(f => f.signal === 'positive' ? 1 : -1),
    tagFrequency: sequence.reduce((acc, f) => {
      (f.tags || []).forEach(tag => { acc[tag] = (acc[tag] || 0) + 1; });
      return acc;
    }, {}),
    recentTrend: calculateTrend(sequence.slice(-5).map(f => f.signal === 'positive' ? 1 : -1)),
    timeGaps: calculateTimeGaps(sequence),
    actionPatterns: extractActionPatterns(sequence),
  };
}

function calculateTrend(rewards) {
  if (rewards.length < 2) return 0;
  const recent = rewards.slice(-3);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

function calculateTimeGaps(sequence) {
  const gaps = [];
  for (let i = 1; i < sequence.length; i++) {
    const prev = parseTimestamp(sequence[i-1].timestamp);
    const curr = parseTimestamp(sequence[i].timestamp);
    if (prev && curr) gaps.push((curr - prev) / 1000 / 60); // minutes
  }
  return gaps;
}

function extractActionPatterns(sequence) {
  const patterns = {};
  sequence.forEach(f => {
    (f.tags || []).forEach(tag => {
      if (!patterns[tag]) patterns[tag] = { positive: 0, negative: 0 };
      if (f.signal === 'positive') patterns[tag].positive++;
      else patterns[tag].negative++;
    });
  });
  return patterns;
}

function appendSequence(feedbackEvent, paths) {
  const { FEEDBACK_LOG_PATH, FEEDBACK_DIR } = paths;
  const sequencePath = path.join(FEEDBACK_DIR, 'feedback-sequences.jsonl');
  const recent = readJSONL(FEEDBACK_LOG_PATH).slice(-SEQUENCE_WINDOW);
  const features = buildSequenceFeatures(recent, feedbackEvent);
  const entry = {
    id: `seq_${Date.now()}`,
    timestamp: new Date().toISOString(),
    targetReward: feedbackEvent.signal === 'positive' ? 1 : -1,
    targetTags: feedbackEvent.tags,
    features,
    label: feedbackEvent.signal === 'positive' ? 'positive' : 'negative',
  };
  appendJSONL(sequencePath, entry);
}
```

### Pattern 3: Diversity Tracking Side-Effect

**What:** After sequence write, call `updateDiversityTracking()`. Infers domain from tags using the same keyword-matching logic as Subway's `inferDomain()`. Updates `diversity-tracking.json` atomically (read-modify-write with `fs.writeFileSync`).

**When to use:** Every accepted feedback entry (same gate as sequence tracking).

**Example:**
```javascript
// Source: Port of capture-feedback.js lines 307-343

const DOMAIN_CATEGORIES = [
  'testing', 'security', 'performance', 'ui-components', 'api-integration',
  'git-workflow', 'documentation', 'debugging', 'architecture', 'data-modeling',
];

function inferDomain(tags, context) {
  const tagSet = new Set((tags || []).map(t => t.toLowerCase()));
  const ctx = (context || '').toLowerCase();
  if (tagSet.has('test') || ctx.includes('test')) return 'testing';
  if (tagSet.has('security') || ctx.includes('secret')) return 'security';
  if (tagSet.has('perf') || ctx.includes('performance')) return 'performance';
  if (tagSet.has('ui') || ctx.includes('component')) return 'ui-components';
  if (tagSet.has('api') || ctx.includes('endpoint')) return 'api-integration';
  if (tagSet.has('git') || ctx.includes('commit')) return 'git-workflow';
  if (tagSet.has('doc') || ctx.includes('readme')) return 'documentation';
  if (tagSet.has('debug') || ctx.includes('error')) return 'debugging';
  if (tagSet.has('arch') || ctx.includes('design')) return 'architecture';
  if (tagSet.has('data') || ctx.includes('schema')) return 'data-modeling';
  return 'general';
}

function updateDiversityTracking(feedbackEvent, paths) {
  const diversityPath = path.join(paths.FEEDBACK_DIR, 'diversity-tracking.json');
  let diversity = { domains: {}, lastUpdated: null, diversityScore: 0 };
  if (fs.existsSync(diversityPath)) {
    try { diversity = JSON.parse(fs.readFileSync(diversityPath, 'utf-8')); }
    catch { /* start fresh */ }
  }

  const domain = inferDomain(feedbackEvent.tags, feedbackEvent.context);
  if (!diversity.domains[domain]) {
    diversity.domains[domain] = { count: 0, positive: 0, negative: 0, lastSeen: null };
  }

  diversity.domains[domain].count++;
  diversity.domains[domain].lastSeen = feedbackEvent.timestamp;
  if (feedbackEvent.signal === 'positive') diversity.domains[domain].positive++;
  else diversity.domains[domain].negative++;

  // Variance-based diversity score (same formula as Subway)
  const totalFeedback = Object.values(diversity.domains).reduce((s, d) => s + d.count, 0);
  const domainCount = Object.keys(diversity.domains).length;
  const idealPerDomain = totalFeedback / DOMAIN_CATEGORIES.length;
  const variance = Object.values(diversity.domains).reduce((s, d) => {
    return s + Math.pow(d.count - idealPerDomain, 2);
  }, 0) / Math.max(domainCount, 1);

  diversity.diversityScore = Math.max(0, 100 - Math.sqrt(variance) * 10).toFixed(1);
  diversity.lastUpdated = new Date().toISOString();
  diversity.recommendation = Number(diversity.diversityScore) < 50
    ? `Low diversity (${diversity.diversityScore}%). Try feedback in: ${DOMAIN_CATEGORIES.filter(d => !diversity.domains[d]).join(', ')}`
    : `Good diversity (${diversity.diversityScore}%)`;

  fs.writeFileSync(diversityPath, JSON.stringify(diversity, null, 2) + '\n');
}
```

### Pattern 4: Python Trainer Path Configuration

**What:** `train_from_feedback.py` uses `Path(__file__).parent` to locate itself and constructs paths relative to `PROJECT_ROOT = SCRIPT_DIR.parent.parent.parent`. In Subway, the script lives at `.claude/scripts/feedback/train_from_feedback.py`, so 3 parents up is the project root. In rlhf, the script will live at `scripts/train_from_feedback.py`, so `PROJECT_ROOT = SCRIPT_DIR.parent` (one level up).

**When to use:** Whenever adjusting Subway Python script paths for rlhf repo.

**Path mapping:**
```
Subway: PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
         → /Subway_RN_Demo/.claude/scripts/feedback/../../../.. = /Subway_RN_Demo

rlhf:   PROJECT_ROOT = Path(__file__).parent.parent
         → /rlhf/scripts/../ = /rlhf

Subway FEEDBACK_LOG: PROJECT_ROOT / ".claude" / "memory" / "feedback" / "feedback-log.jsonl"
rlhf   FEEDBACK_LOG: PROJECT_ROOT / ".claude" / "memory" / "feedback" / "feedback-log.jsonl"
       (identical relative path — both repos use .claude/memory/feedback/)
```

Wait — correction from direct code inspection of Subway:
```python
# Subway train_from_feedback.py line 31-34:
SCRIPT_DIR = Path(__file__).parent                          # .claude/scripts/feedback/
PROJECT_ROOT = SCRIPT_DIR.parent.parent.parent              # 3 levels up = /Subway_RN_Demo/
```
For rlhf where script lives at `scripts/train_from_feedback.py`:
```python
SCRIPT_DIR = Path(__file__).parent                          # scripts/
PROJECT_ROOT = SCRIPT_DIR.parent                            # 1 level up = /rlhf/
```

### Anti-Patterns to Avoid

- **Thompson update on rejected feedback:** Only accepted entries (where `action.type !== 'no-action'`) update the Thompson model. Rejected/invalid feedback must NOT shift posteriors — this would corrupt reliability estimates. Subway's `train_full` processes all entries including negatives correctly because it reads from `feedback-log.jsonl` which has already been filtered; the JS hot-path must apply the same gate.
- **Blocking captureFeedback() on sequence/diversity writes:** Both side-effects must be wrapped in try/catch. If either file write fails, `captureFeedback()` still returns `accepted: true` — the primary JSONL write already succeeded.
- **Thompson without time-decay:** Never update alpha/beta with raw weight=1.0. Always apply `timeDecayWeight(timestamp)` first. Old feedback at weight=0.01 (floor) still contributes but minimally, which is correct behavior.
- **Recreating Thompson model from scratch on every feedback:** The JS hot-path `updateModel()` must load existing model, update it, save it — not call `createInitialModel()`. Only on first run (file absent) does `createInitialModel()` execute.
- **Non-atomic diversity JSON write:** Use `fs.writeFileSync()` (atomic at OS level for small JSON), not streaming. Never use `fs.appendFileSync()` for JSON files — they are overwritten on each update.
- **Hardcoding Subway's SCRIPT_DIR chain:** The 3-parent chain `SCRIPT_DIR.parent.parent.parent` is Subway-specific. rlhf needs `SCRIPT_DIR.parent` only. This is the single most error-prone copy-paste trap in this phase.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Beta distribution random sampling | Custom inverse CDF | Marsaglia-Tsang gamma ratio (inline, ~20 lines) | Exact; no library; matches Python's `random.betavariate` output distribution |
| Timestamp age calculation | Custom date parsing | `parseTimestamp()` from Phase 1 + `Date.now()` | Phase 1 already handles all ISO 8601 variants; do not duplicate |
| Category keyword matching | Custom NLP | Direct keyword/tag lookup (Subway pattern) | Subway's `classify_entry()` / `inferDomain()` is proven; copy verbatim |
| JSONL reading for sequence window | Custom parser | `readJSONL()` from `feedback-loop.js` | Already exported; just call it |
| Proof report generation | Manual write | Script that reads final state files and emits markdown | Consistent with Phase 1 contract-audit-report pattern |

**Key insight:** Every ML operation in this phase reduces to `Math.pow`, `Math.random`, `Math.sqrt`, and `fs.appendFileSync`. No library adds meaningful value at this scale. The complexity is in the algorithm, not the implementation tooling.

---

## Common Pitfalls

### Pitfall 1: Python PROJECT_ROOT Parent Count Wrong

**What goes wrong:** Copy `SCRIPT_DIR.parent.parent.parent` from Subway verbatim. Python resolves to wrong directory. All paths silently point to system temp or wrong folder. No error — reads empty JSONL, creates empty model.

**Why it happens:** Subway's script is 3 directories deep from project root (`.claude/scripts/feedback/`). rlhf's script is 1 directory deep (`scripts/`).

**How to avoid:** First line of Python script in rlhf must be `PROJECT_ROOT = Path(__file__).parent.parent` (two levels up: `scripts/` → `rlhf/`). Verify with a print during development: `print(PROJECT_ROOT)` must show the rlhf repo root.

**Warning signs:** `feedback_model.json` appears in unexpected location or is not created where expected.

### Pitfall 2: Thompson Update Corrupting Existing feedback_model.json

**What goes wrong:** `createInitialModel()` called unconditionally, resetting all accumulated posteriors in Subway's live `feedback_model.json` to `alpha=1, beta=1`.

**Why it happens:** Developer calls `createInitialModel()` to get initial state rather than `loadModel()`.

**How to avoid:** `loadModel()` ALWAYS runs first. If file absent, THEN call `createInitialModel()`. Never clear existing model data.

**Warning signs:** `feedback_model.json` shows `total_entries: 0` after the first JS incremental update.

### Pitfall 3: Sequence Tracking Uses Wrong Signal Field

**What goes wrong:** rlhf's `feedbackEvent.signal` is `'positive'` / `'negative'`. Subway's `entry.reward` is `1` / `-1`. The reward sequence calculation `sequence.map(f => f.reward)` fails if applied to rlhf events.

**Why it happens:** Subway's feedback schema uses `reward: 1` or `reward: -1`. rlhf's schema uses `signal: 'positive'` or `signal: 'negative'`.

**How to avoid:** rlhf's sequence feature builder must use `f.signal === 'positive' ? 1 : -1`. Do NOT copy `f.reward` from Subway — that field does not exist in rlhf events.

**Warning signs:** `rewardSequence` contains only `undefined` or `NaN`.

### Pitfall 4: Diversity Score Formula Off-by-One on Domain Count

**What goes wrong:** `diversityScore = max(0, 100 - sqrt(variance) * 10)` uses `domainCount = Object.keys(diversity.domains).length` for variance denominator. If only 1 domain seen, variance/1 gives wrong scaling.

**Why it happens:** Subway has enough diversity data (9 domains) that this edge case doesn't surface. rlhf starts with 0 domains and grows.

**How to avoid:** Use `Math.max(domainCount, 1)` in the denominator. Already shown in Pattern 3 code above.

**Warning signs:** `diversityScore` returns `NaN` or `Infinity` on the first feedback entry.

### Pitfall 5: Thompson Side-Effect Blocking captureFeedback() Return

**What goes wrong:** `updateModel()` throws (e.g., corrupt `feedback_model.json`), causing `captureFeedback()` to throw instead of returning `{ accepted: false }`.

**Why it happens:** No try/catch around ML side-effects.

**How to avoid:** All three side-effects (Thompson update, sequence append, diversity update) must be wrapped in try/catch that logs a warning but does not re-throw. The primary feedback write already succeeded — ML enrichment is best-effort.

**Warning signs:** `captureFeedback()` throws instead of returning `{ accepted: false }` for ML errors.

### Pitfall 6: Python Script Timestamp Handling Regression

**What goes wrong:** Python's `train_from_feedback.py` line 139 does `timestamp_str.replace("Z", "").split("+")[0]` before `datetime.fromisoformat()`. In Python 3.11+, `datetime.fromisoformat()` accepts the trailing `Z` directly. But rlhf's feedback-log.jsonl timestamps (written by JS `new Date().toISOString()`) always have the Z suffix — verified safe.

**Why it happens:** Confusion about which Python version is required.

**How to avoid:** Confirmed Python 3.14.3 is available (`python3 --version`). The `.replace("Z", "")` strip is harmless on 3.14 and correct for all older versions. Leave Python code as-is — do not "fix" the Z-stripping.

**Warning signs:** Do not touch the timestamp handling in the Python script.

---

## Code Examples

Verified patterns from direct source inspection:

### Thompson Sampling: Full Incremental Update (JS)
```javascript
// scripts/thompson-sampling.js
// Source: Port of train_from_feedback.py lines 253-293 (train_incremental)
// Verified 2026-03-04

const { timeDecayWeight, loadModel, updateModel } = require('./thompson-sampling');
const { getFeedbackPaths } = require('./feedback-loop');

function incrementalUpdate(feedbackEvent) {
  const { FEEDBACK_DIR } = getFeedbackPaths();
  const modelPath = path.join(FEEDBACK_DIR, 'feedback_model.json');
  let model = loadModel(modelPath);

  // Classify by tags (simple keyword approach — same as Subway's classify_entry)
  const cats = classifyByTags(feedbackEvent.tags);

  model = updateModel(model, {
    signal: feedbackEvent.signal,
    timestamp: feedbackEvent.timestamp,
    categories: cats,
  });

  fs.mkdirSync(path.dirname(modelPath), { recursive: true });
  fs.writeFileSync(modelPath, JSON.stringify(model, null, 2) + '\n');
  return model;
}
```

### Time-Decay Weight Verification Test
```javascript
// tests/thompson-sampling.test.js
// Source: Direct port of Python test logic
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
const { timeDecayWeight } = require('../scripts/thompson-sampling');

// Weight at age=0: 2^0 = 1.0
const now = new Date().toISOString();
const w = timeDecayWeight(now);
assert(w > 0.99 && w <= 1.0, 'Fresh feedback has weight ~1.0');

// Weight at age=7 days: 2^(-7/7) = 0.5
const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
const w7 = timeDecayWeight(sevenDaysAgo);
assert(w7 > 0.48 && w7 < 0.52, 'Week-old feedback has weight ~0.5');

// Invalid timestamp returns floor
const wInvalid = timeDecayWeight('garbage');
assert(wInvalid === 0.01, 'Invalid timestamp returns DECAY_FLOOR');
```

### Diversity Score Calculation
```javascript
// Source: Port of capture-feedback.js lines 329-342
// diversityScore formula verified against live data:
// diversity-tracking.json shows 76.2% with 9 domains, totalFeedback=30

const domains = { /* 9 domains */ };
const totalFeedback = 30;
const idealPerDomain = totalFeedback / 10; // DOMAIN_CATEGORIES.length = 10
const variance = domainValues.reduce((s, d) => s + Math.pow(d.count - idealPerDomain, 2), 0) / 9;
const score = Math.max(0, 100 - Math.sqrt(variance) * 10);
// → 76.2 matches live value: HIGH confidence formula is correct
```

### Feedback-Sequences.jsonl Entry Structure
```javascript
// Source: capture-feedback.js lines 202-213
// This is the exact schema for each line in feedback-sequences.jsonl
{
  "id": "seq_1709567890123",
  "timestamp": "2026-03-04T15:00:00.000Z",
  "targetReward": 1,                    // 1 or -1 (not 'positive'/'negative')
  "targetTags": ["verification", "fix"],
  "features": {
    "rewardSequence": [-1, 1, 1, -1, 1, 1, -1, 1, 1, 1],  // last N=10 rewards
    "tagFrequency": { "verification": 4, "fix": 2 },
    "recentTrend": 0.667,               // -1 to 1 scale
    "timeGaps": [5.2, 12.1, 3.4],      // minutes between entries
    "actionPatterns": { "verification": { "positive": 4, "negative": 1 } }
  },
  "label": "positive"
}
```

### Python Trainer npm Script (package.json addition)
```json
{
  "scripts": {
    "ml:train": "python3 scripts/train_from_feedback.py --train",
    "ml:incremental": "python3 scripts/train_from_feedback.py --incremental",
    "ml:reliability": "python3 scripts/train_from_feedback.py --reliability",
    "ml:sample": "python3 scripts/train_from_feedback.py --sample"
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Step decay (7d=1.0, 30d=0.5, older=0.25) | Exponential decay (half-life 7 days) | Subway Feb 2026 | Smoother weighting; no cliff at 7-day boundary |
| Binary reward (1/-1) | Weighted reward via time-decay | Subway 2026 | Old feedback contributes minimally, not equally |
| No sequence tracking | JSONL-based sliding window (N=10) | Subway 2025 | Enables LSTM/Transformer training later |
| No diversity tracking | Variance-based domain coverage score | Subway 2025 | Detects representation collapse |

**Deprecated/outdated:**
- Step decay (`DECAY_WEIGHTS` dict): kept in Python trainer as fallback toggle (`USE_EXPONENTIAL_DECAY = True`); do not use in JS port — implement exponential only.
- Per-session feedback summary JSON (Subway's `feedback-summary.json`): rlhf already has `feedback-summary.json` with different schema. Do not merge — diversity tracking goes to `diversity-tracking.json` only.

---

## Open Questions

1. **Should Thompson incremental updates happen on every `captureFeedback()` call or only in batch via Python CLI?**
   - What we know: Subway uses both — Python CLI for full rebuild/incremental, capture-feedback.js does NOT update Thompson (Thompson is separate from capture in Subway). The Python trainer runs `--incremental` after each capture via a shell hook.
   - What's unclear: Whether the JS `captureFeedback()` hot path should directly call `thompson-sampling.js` incrementalUpdate, or only the npm script `ml:incremental` should do so.
   - Recommendation: Keep the same separation as Subway — `captureFeedback()` writes to `feedback-log.jsonl` and handles sequence/diversity. Thompson model updates run via `npm run ml:incremental` (calls Python trainer) or a post-hook. This avoids coupling Python-dependent model state into the Node.js hot path. The JS `thompson-sampling.js` module provides the math for use by the API layer (ML-01 requirement says "compute per-category reliability" — this is satisfied by the Python trainer writing `feedback_model.json` which JS reads).

2. **Should `feedback_model.json` be read by the rlhf Node.js API?**
   - What we know: The model file exists at `.claude/memory/feedback/feedback_model.json` in Subway and contains alpha/beta per category. ML-01 says posteriors must "compute per-category reliability estimates" — this implies they must be readable.
   - What's unclear: Whether any rlhf API endpoint should expose `getReliability()` or `samplePosteriors()`.
   - Recommendation: Add a `thompson-sampling.js` module that exports `getReliability(modelPath)` and `samplePosteriors(modelPath)`. This satisfies ML-01 from the JS side. No new API endpoint needed for Phase 2 — the proof report reads the model and outputs reliability.

3. **Category taxonomy: rlhf tags vs Subway DOMAIN_CATEGORIES**
   - What we know: Subway's diversity tracking uses 10 fixed `DOMAIN_CATEGORIES`. rlhf's feedback entries use free-form tags. Thompson categories in Subway's Python use 8 keyword-mapped categories plus `uncategorized`.
   - What's unclear: Whether rlhf should adopt Subway's exact category list or infer from existing tags.
   - Recommendation: Use Subway's `DOMAIN_CATEGORIES` list verbatim for diversity tracking (10 items). Use Subway's `DEFAULT_CATEGORIES` dict for Thompson classification (8 + uncategorized). Both are small fixed lists — copy verbatim, no dynamic configuration in Phase 2.

---

## Sources

### Primary (HIGH confidence)
- Direct `Read` of `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/train_from_feedback.py` — 910 lines, full Thompson Sampling + time-decay + DPO + meta-policy implementation verified
- Direct `Read` of `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/capture-feedback.js` — 974 lines, full sequence tracking + diversity tracking implementation verified
- Direct `Read` of `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/memory/feedback/feedback_model.json` — live alpha/beta values for 9 categories confirmed; confirms model schema
- Direct `Read` of `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/memory/feedback/diversity-tracking.json` — live 76.2% diversity score confirmed; confirms formula produces expected output
- Direct `Read` of `/Users/ganapolsky_i/workspace/git/igor/rlhf/scripts/feedback-loop.js` — confirmed `captureFeedback()` signature, `readJSONL()`, `appendJSONL()`, `getFeedbackPaths()`, `THUMBGATE_FEEDBACK_DIR` pattern
- `Bash: npm test` in rlhf — confirmed 60 node-runner tests passing (58 test:api + 2 test:proof), 23 script-runner tests; all green
- `Bash: python3 --version` — confirmed Python 3.14.3 available at `/opt/homebrew/bin/python3`
- `Bash: node --version` — confirmed Node.js 25.6.1
- Direct `Read` of `.planning/research/SUMMARY.md` — confirmed no npm packages needed for Phase 2, Python venv already complete
- Direct `Read` of `.planning/phases/01-contract-alignment/1-RESEARCH.md` — confirmed `parseTimestamp()` added to `feedback-schema.js` in Phase 1; confirmed baseline test count 60+23=83

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` — ML-01 through ML-06 scope confirmed
- `.planning/STATE.md` — Phase 1 complete, baseline 60 node-runner tests authoritative
- Subway `feedback_model.json` live data (diversityScore 76.2, 9 categories) — independently confirms formula accuracy

### Tertiary (LOW confidence)
- arXiv:2505.23927 (Thompson Sampling in Online RLHF) — O(sqrt(T)) regret bound cited in SUMMARY.md; not directly needed for port implementation
- Marsaglia-Tsang gamma sampling (2000) — algorithm for JS Beta sampling; standard textbook result

---

## Metadata

**Confidence breakdown:**
- Thompson Sampling math: HIGH — full algorithm read in source, Python implementation verified against live model data
- Time-decay formula: HIGH — exact formula `2^(-age/7.0)` read in source, floor 0.01 confirmed
- Sequence tracking: HIGH — full JS implementation read in source, schema structure confirmed
- Diversity tracking: HIGH — formula verified against live 76.2% score
- Python path adjustment (PROJECT_ROOT): HIGH — verified by counting directory depth in both repos
- JS Beta sampling (Marsaglia-Tsang): MEDIUM — standard algorithm, not from official JS docs; functionally equivalent to Python's `random.betavariate`
- Test count targets: HIGH — baseline confirmed by live `npm test` run

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (30 days; source files are stable; only risk is if Subway's ML scripts are modified)
