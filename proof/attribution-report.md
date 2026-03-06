# Feedback Attribution — Proof Report

Generated: 2026-03-06T23:02:45.865Z
Phase: 06-feedback-attribution

**Passed: 2 | Failed: 1**

## Requirements

| Requirement | Status | Evidence |
|-------------|--------|----------|
| ATTR-01 | PASS | recordAction('Bash', git push --force) returned ok=true, intent=git-risk. action-log.jsonl written to /var/folders/yw/2qhx3yzj0psf87rdxh8lqlmm0000gp/T/prove-attr01-PzZRrK. action_id=act_1772838165866_72a355e8, risk_score=8. attributeFeedback('negative', ...) returned ok=true, attributedCount=1. feedback-attributions.jsonl written. attribution_id=att_1772838165867_8f90bc9a, signal=negative. Module: scripts/feedback-attribution.js. Pure offline JSONL-based attribution. |
| ATTR-02 | PASS | buildHybridState() detected 1 recurring pattern(s). Top pattern count=3 (>= 3 → critical). evaluatePretoolFromState('Bash', 'git push force main') → mode=block. evaluatePretoolFromState('Read', 'some-unrelated-file.md') → mode=allow. block + allow paths verified. No false positive for unrelated Read tool. Module: scripts/hybrid-feedback-context.js. hasTwoKeywordHits enforces no-false-positive invariant. |
| ATTR-03 | FAIL | node --test attribution files: pass=0, fail=0. Expected >= 1 passing and 0 failures. Only 0 tests passing (need >= 1). |

## Requirement Details

### ATTR-01 — PASS

recordAction('Bash', git push --force) returned ok=true, intent=git-risk. action-log.jsonl written to /var/folders/yw/2qhx3yzj0psf87rdxh8lqlmm0000gp/T/prove-attr01-PzZRrK. action_id=act_1772838165866_72a355e8, risk_score=8. attributeFeedback('negative', ...) returned ok=true, attributedCount=1. feedback-attributions.jsonl written. attribution_id=att_1772838165867_8f90bc9a, signal=negative. Module: scripts/feedback-attribution.js. Pure offline JSONL-based attribution.

### ATTR-02 — PASS

buildHybridState() detected 1 recurring pattern(s). Top pattern count=3 (>= 3 → critical). evaluatePretoolFromState('Bash', 'git push force main') → mode=block. evaluatePretoolFromState('Read', 'some-unrelated-file.md') → mode=allow. block + allow paths verified. No false positive for unrelated Read tool. Module: scripts/hybrid-feedback-context.js. hasTwoKeywordHits enforces no-false-positive invariant.

### ATTR-03 — FAIL

node --test attribution files: pass=0, fail=0. Expected >= 1 passing and 0 failures. Only 0 tests passing (need >= 1).

## Test Count Delta

| Baseline (Phase 5 final) | Phase 6 Attribution Addition | Total (node-runner) |
|--------------------------|------------------------------|---------------------|
| 142 tests | +0 attribution tests (2 test files) | 142 |

Phase 6 (plan-03) added attribution test coverage:
- `tests/feedback-attribution.test.js` — recordAction(), attributeFeedback() (5 tests)
- `tests/hybrid-feedback-context.test.js` — evaluatePretool, buildHybridState, compileGuardArtifact (16 tests)

All tests use `fs.mkdtempSync()` tmpdir isolation. Zero production feedback dirs touched.

## Summary

2/3 requirements passed.

