---
phase: 06-feedback-attribution
plan: "01"
subsystem: attribution-engine
tags: [attribution, feedback-loop, recordAction, attributeFeedback, ATTR-01]
dependency_graph:
  requires: []
  provides: [scripts/feedback-attribution.js, attribution-side-effects-in-captureFeedback]
  affects: [scripts/feedback-loop.js, .claude/memory/feedback/action-log.jsonl, .claude/memory/feedback/feedback-attributions.jsonl, .claude/memory/feedback/attributed-feedback.jsonl]
tech_stack:
  added: []
  patterns: [CJS-module, fire-and-forget-side-effect, FNV-1a-hash, Jaccard-overlap, recency-weighted-scoring]
key_files:
  created:
    - scripts/feedback-attribution.js
  modified:
    - scripts/feedback-loop.js
decisions:
  - "ROOT = path.join(__dirname, '..') — 1 level up from scripts/ to repo root (Subway used 2 levels from .claude/scripts/feedback/)"
  - "PATHS.actionLog resolves to .claude/memory/feedback/action-log.jsonl — identical semantic path, different depth"
  - "Attribution block placed after RLAIF self-audit, before summary.accepted — mirrors upsertFeedback fire-and-forget pattern"
  - "feedbackEvent.signal is already normalized to 'positive'/'negative' by normalizeSignal() — used directly for attributeFeedback signal arg"
  - "Standard top-level require (not conditional) — feedback-attribution.js always exists alongside feedback-loop.js in production"
metrics:
  duration: "~4 minutes"
  completed: "2026-03-04"
  tasks_completed: 2
  files_changed: 2
---

# Phase 06 Plan 01: Feedback Attribution Engine — Summary

Port `feedback-attribution.js` from Subway and wire `recordAction`/`attributeFeedback` side-effects into `captureFeedback()` to enable causal grounding of every feedback signal to the agent action that caused it (ATTR-01).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Port feedback-attribution.js to scripts/ with ThumbGate path corrections | c38b463 | scripts/feedback-attribution.js (313 lines, new) |
| 2 | Wire recordAction + attributeFeedback into captureFeedback() | 30c7482 | scripts/feedback-loop.js (+15 lines) |

## What Was Built

### scripts/feedback-attribution.js (313 lines)

Complete causal attribution engine ported from Subway with one critical path correction:

```javascript
// Subway: ROOT = path.join(__dirname, '..', '..') — from .claude/scripts/feedback/ 2 levels up
// ThumbGate:   ROOT = path.join(__dirname, '..')       — from scripts/ 1 level up to repo root
const ROOT = path.join(__dirname, '..');
const PATHS = {
  actionLog:        path.join(ROOT, '.claude', 'memory', 'feedback', 'action-log.jsonl'),
  attributions:     path.join(ROOT, '.claude', 'memory', 'feedback', 'feedback-attributions.jsonl'),
  attributedFeedback: path.join(ROOT, '.claude', 'memory', 'feedback', 'attributed-feedback.jsonl'),
};
```

Exported functions: `PATHS`, `readJsonl`, `appendJsonl`, `normalize`, `stripFeedbackPrefix`, `tokenize`, `inferIntent`, `riskScore`, `summarizeToolInput`, `overlapScore`, `scoreCandidate`, `recordAction`, `attributeFeedback`

Scoring model in `scoreCandidate()`:
- 0.45 lexical overlap (Jaccard)
- 0.30 recency (exponential decay, half-life 6 min)
- 0.20 risk score (normalized 0-1)
- 0.05 containment bonus
- ±0.1 tool-match bonuses (Bash for git signals, Edit/Write for file signals)

### scripts/feedback-loop.js (attribution wiring)

```javascript
// Top-level require
const { recordAction, attributeFeedback } = require('./feedback-attribution');

// Inside captureFeedback(), after RLAIF self-audit block:
try {
  const toolName = feedbackEvent.toolName || feedbackEvent.tool_name || 'unknown';
  const toolInput = feedbackEvent.context || feedbackEvent.input || '';
  recordAction(toolName, toolInput);
  if (feedbackEvent.signal === 'negative') {
    attributeFeedback('negative', feedbackEvent.context || '');
  } else if (feedbackEvent.signal === 'positive') {
    attributeFeedback('positive', feedbackEvent.context || '');
  }
} catch (e) {
  // attribution is non-blocking
}
```

## Verification Evidence

```
# Exports verified
PATHS,readJsonl,appendJsonl,normalize,stripFeedbackPrefix,tokenize,inferIntent,riskScore,
summarizeToolInput,overlapScore,scoreCandidate,recordAction,attributeFeedback

# recordAction output
{ "ok": true, "action": { "action_id": "act_...", "tool_name": "Bash", ... } }

# attributeFeedback output
{ "ok": true, "signal": "negative", "attributedCount": 1, "topConfidence": 0.5684,
  "actionLogPath": "...thumbgate/.claude/memory/feedback/action-log.jsonl" }

# test:loop
Results: 10 passed, 0 failed
```

## Deviations from Plan

None — plan executed exactly as written. Path correction was specified in the plan; no auto-fixes required.

## Requirements Satisfied

- ATTR-01: Every feedback signal is now traceable to the specific agent action that caused it via `recordAction()` + `attributeFeedback()` side-effects in `captureFeedback()`

## Self-Check: PASSED

- scripts/feedback-attribution.js: FOUND (313 lines)
- scripts/feedback-loop.js: modified with attribution wiring
- Commit c38b463: feedback-attribution.js created
- Commit 30c7482: attribution wiring in feedback-loop.js
- test:loop: 10/10 passed
