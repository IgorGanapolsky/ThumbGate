---
phase: 08-loop-closure
plan: "01"
subsystem: loop-closure
tags: [feedback-to-rules, distillation, prevention-rules, rlhf]
dependency_graph:
  requires: []
  provides: [scripts/feedback-to-rules.js, parseFeedbackFile, classifySignal, analyze, toRules]
  affects: [prevention-rules.md, .claude/memory/feedback/]
tech_stack:
  added: []
  patterns: [JSONL-parsing, context-normalization, severity-tiering, CLAUDE.md-rule-format]
key_files:
  created: [scripts/feedback-to-rules.js]
  modified: []
decisions:
  - "feedback-to-rules.js uses DEFAULT_LOG = path.join(__dirname, '..', '.claude', 'memory', 'feedback', 'feedback-log.jsonl') — 1 level up from scripts/"
  - "classifySignal checks entry.signal first, then entry.feedback (backward compat with old Subway schema)"
  - "normalize() strips /Users/... paths and :port patterns then lowercases — reproducible dedup keys"
  - "severity tiers: count>=4 critical, >=3 high, else medium — CLAUDE.md-compatible [CRITICAL] bracket format"
  - "suggestedRule always prefixed with NEVER for CLAUDE.md compatibility"
metrics:
  duration: 3min
  completed: 2026-03-04
  tasks: 1
  files: 1
---

# Phase 8 Plan 01: feedback-to-rules.js Port Summary

Ported Subway's feedback-to-rules.js to rlhf/scripts/ as a CommonJS module for feedback pattern distillation into CLAUDE.md-compatible behavior rules.

## What Was Built

`scripts/feedback-to-rules.js` — Feedback pattern analysis and rule generation:

1. **`parseFeedbackFile(filePath)`** — Reads JSONL, skips malformed lines
2. **`classifySignal(entry)`** — Maps signal/feedback fields to 'positive'/'negative'/null
3. **`normalize(ctx)`** — Strips /Users/... paths and :port patterns for dedup keys
4. **`analyze(entries)`** — Counts positive/negative, groups by category, finds recurring patterns
5. **`toRules(report)`** — Generates `# Suggested Rules from Feedback Analysis` with `NEVER` bullets

## Deviations from Plan

None — executed exactly as specified.

## Self-Check: PASSED

- scripts/feedback-to-rules.js: EXISTS
- parseFeedbackFile exported: CONFIRMED
- classifySignal handles both signal and feedback fields: CONFIRMED
- toRules emits NEVER bullets: CONFIRMED
- prove-loop-closure.js LOOP-01: PASS
