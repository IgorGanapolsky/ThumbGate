---
phase: 07-data-quality
plan: "01"
subsystem: data-quality
tags: [validation, schema, anomaly, self-correction, rlhf]
dependency_graph:
  requires: []
  provides: [scripts/validate-feedback.js, validateEntry, validateSchema, validateSemantics, detectAnomalies]
  affects: [scripts/feedback-loop.js, tests/validate-feedback.test.js]
tech_stack:
  added: []
  patterns: [4-level-validation-pipeline, env-var-path-resolution, CommonJS-module-with-cli-guard]
key_files:
  created: [scripts/validate-feedback.js]
  modified: []
decisions:
  - "REQUIRED_FIELDS uses ['timestamp','signal','id'] not Subway's ['timestamp','feedback','source'] — rlhf uses normalized signal"
  - "RLHF_FEEDBACK_DIR env var for path resolution, resolved at call time not module init"
  - "require.main === module guard ensures library and CLI modes coexist"
metrics:
  duration: 4min
  completed: 2026-03-04
  tasks: 1
  files: 1
---

# Phase 7 Plan 01: validate-feedback.js Port Summary

Ported Subway's validate-feedback.js to rlhf/scripts/ as a CommonJS module implementing a 4-level feedback data quality pipeline.

## What Was Built

`scripts/validate-feedback.js` — 4-level validation pipeline for rlhf feedback entries:

1. **Schema validation** — checks required fields (timestamp, signal, id), reward range [-1, 1], ISO 8601 timestamp
2. **Semantic validation** — catches positive-signal/negative-reward inconsistency, short context, placeholder text
3. **Anomaly detection** — burst detection (>5 in 1 min), duplicate detection, skew detection (>95%/<5% positive), sensitive data patterns (api_key, password, token, etc.)
4. **Self-correction** — auto-corrects reward to match signal type; adds missing timestamp

## Key Exports

```js
const { validateEntry, validateSchema, validateSemantics, detectAnomalies, generateCorrections, applyCorrections, loadFeedbackLog } = require('./scripts/validate-feedback');
```

## Deviations from Plan

None — executed exactly as specified.

## Self-Check: PASSED

- scripts/validate-feedback.js: EXISTS
- validateEntry exported: CONFIRMED
- semantic error detection working: CONFIRMED (positive+negative-reward → error with correction)
- sensitive data detection working: CONFIRMED (api_key pattern → security error)
- commit 5b3e4b7: CONFIRMED
