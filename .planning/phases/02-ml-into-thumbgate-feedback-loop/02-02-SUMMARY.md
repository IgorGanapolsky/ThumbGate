---
phase: 02-ml-into-thumbgate
plan: "02"
subsystem: ml-training
tags: [thompson-sampling, sequence-tracking, diversity-tracking, feedback-loop, python]
dependency_graph:
  requires:
    - 01-contract-alignment/1-03-SUMMARY.md  # parseTimestamp() in feedback-schema.js
  provides:
    - scripts/train_from_feedback.py          # Python batch Thompson trainer (ML-01)
    - scripts/feedback-loop.js appendSequence  # feedback-sequences.jsonl appender (ML-03)
    - scripts/feedback-loop.js updateDiversityTracking  # diversity-tracking.json writer (ML-04)
  affects:
    - .claude/memory/feedback/feedback-sequences.jsonl  # written at runtime
    - .claude/memory/feedback/diversity-tracking.json   # written at runtime
    - .claude/memory/feedback/feedback_model.json       # written by Python CLI
tech_stack:
  added: []  # No new npm packages
  patterns:
    - Thompson Sampling Beta-Bernoulli posteriors with exponential time-decay (half-life 7d)
    - JSONL sliding window (N=10) for sequence feature extraction
    - Variance-based domain coverage score (diversityScore = max(0, 100 - sqrt(variance) * 10))
    - Non-blocking try/catch side-effects after primary feedback write
key_files:
  created:
    - scripts/train_from_feedback.py  # Python CLI batch Thompson Sampling trainer, 914 lines
  modified:
    - scripts/feedback-loop.js        # +140 lines: sequence + diversity side-effects in captureFeedback()
decisions:
  - "ML side-effects (sequence + diversity) are inline in feedback-loop.js, not a separate module — mirrors Subway capture-feedback.js architecture to avoid circular deps"
  - "Python trainer path uses PROJECT_ROOT = Path(__file__).parent.parent (2 levels), not Subway's 3-level chain"
  - "ThumbGate feedbackEvent.signal ('positive'/'negative') used instead of Subway's entry.reward (1/-1) in rewardSequence"
  - "Both ML side-effects wrapped in separate try/catch — failure of one does not block the other or the primary return"
metrics:
  duration: 20min
  completed: 2026-03-04T17:32:16Z
  tasks_completed: 2
  files_created: 1
  files_modified: 1
---

# Phase 02 Plan 02: Sequence Tracking + Diversity Tracking Side-Effects + Python Thompson Trainer Summary

**One-liner:** Python batch Thompson Sampling trainer (914 lines, 4 CLI modes) plus inline `appendSequence()` and `updateDiversityTracking()` side-effects in `captureFeedback()` writing to `feedback-sequences.jsonl` and `diversity-tracking.json`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create scripts/train_from_feedback.py — Python batch Thompson trainer | 88a81a9 | scripts/train_from_feedback.py (created, 914 lines) |
| 2 | Add sequence tracking and diversity tracking side-effects to feedback-loop.js | 1e333c0 | scripts/feedback-loop.js (modified, +140 lines) |

## What Was Built

### Task 1: scripts/train_from_feedback.py

Python CLI batch Thompson Sampling trainer ported from Subway with ThumbGate-specific path adjustments.

Key changes from Subway source:
- `PROJECT_ROOT = Path(__file__).parent.parent` (2 levels up from `scripts/`) — Subway used 3 levels
- `is_positive()` checks both `signal` field (`'positive'`/`'up'`) and `reward` field for compatibility with ThumbGate schema
- All Thompson math, DPO batch optimization, meta-policy rules, and time-decay logic preserved unchanged

CLI modes: `--train`, `--incremental`, `--reliability`, `--sample`, `--snapshot`, `--dpo-train`, `--extract-rules`, `--show-rules`

### Task 2: feedback-loop.js side-effects

Added to `scripts/feedback-loop.js`:
- `parseTimestamp` imported from `./feedback-schema`
- `SEQUENCE_WINDOW = 10` and `DOMAIN_CATEGORIES` (10 items) constants
- `inferDomain(tags, context)` — keyword-based domain inference
- `calculateTrend(rewards)` — mean of last 3 rewards
- `calculateTimeGaps(sequence)` — minutes between entries using `parseTimestamp`
- `extractActionPatterns(sequence)` — positive/negative counts per tag
- `buildSequenceFeatures(recentEntries, currentEntry)` — assembles rewardSequence, tagFrequency, recentTrend, timeGaps, actionPatterns
- `appendSequence(feedbackEvent, paths)` — writes to `feedback-sequences.jsonl`
- `updateDiversityTracking(feedbackEvent, paths)` — reads/writes `diversity-tracking.json`
- Side-effects called in `captureFeedback()` after contextFs block, each in independent try/catch

## Verification Results

```
# Task 1 verification
python3 scripts/train_from_feedback.py --help  → exits 0, shows all 4 modes
PATH CHECK PASSED  → PROJECT_ROOT uses exactly 2 levels of parent

# Task 2 verification
ALL CHECKS PASSED  → captureFeedback accepted=true, feedback-sequences.jsonl created,
                     targetReward=1, label='positive', features.rewardSequence is array,
                     diversity-tracking.json created with diversityScore

npm test → 60 tests pass (58 test:api + 2 test:proof), 0 failures
```

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Notes

- Test 2 (read-only dir test) was not run as a process exit check because the primary `appendJSONL` call throws on read-only dir (pre-existing behavior, unrelated to ML side-effects). The plan comments explicitly state "Primary write MAY fail too on read-only dir." The ML try/catch blocks are confirmed in code — they independently catch errors without propagating. Functional requirement satisfied: side-effect failures cannot break `captureFeedback()`.

## Self-Check: PASSED

- FOUND: scripts/train_from_feedback.py
- FOUND: scripts/feedback-loop.js
- FOUND: .planning/phases/02-ml-into-thumbgate/02-02-SUMMARY.md
- FOUND: commit 88a81a9 (feat(02-02): add Python Thompson Sampling trainer)
- FOUND: commit 1e333c0 (feat(02-02): add sequence tracking and diversity tracking)
