# DeepInfer: Confidence-Scheduled Verification

## Steal Source
NVIDIA DeepInfer (GitHub: deepseek-ai/DeepInfer)

## Problem
Running full verification on every change wastes compute. Most changes are low-risk and don't need deep analysis.

## Pattern Stolen
**"Accelerate decoding with draft tokens and use confidence estimates to schedule verification."**

DeepInfer uses confidence estimates to skip verification steps when the draft is likely correct. When confidence is high, it short-circuits the full verification pipeline.

## How ThumbGate Applies It
When mechanical checks pass with quality ≥ `confidenceThreshold` (0.9), the verifier fast-tracks to PASS:

1. Only `goal_alignment` semantic check runs (cheapest)
2. `edge_case_coverage`, `regression_check`, `design_compliance` are **skipped** with `score: 1.0, passed: true`
3. On low confidence: all 4 semantic checks run normally

```
// High confidence (mechanical quality = 1.0 ≥ 0.9):
//   1 semantic check runs → 0.4s

// Low confidence:
//   4 semantic checks run → 1.2s
```

## Implementation
- `config/verifier-criteria.json` — `asyncExecution.confidenceThreshold: 0.9`
- `scripts/isolated-verifier.js` — `mechanicalQuality` computed from check pass ratio; fast-track path in `runVerification()`

## Pro Value
Pro adds:
- Adaptive confidence thresholds (learns your repo's false-positive rate)
- Multi-stage confidence scheduling (low/medium/high effort tiers)
- Confidence-based model routing (low effort → local model, high effort → cloud)

**Steal command**: `npx thumbgate init` → select "confidence-scheduling-pack"
