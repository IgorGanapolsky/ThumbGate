---
name: harness-ceiling-diagnostics
description: >
  Harness ceiling diagnostics stolen from arXiv:2610.11655 (Tian et al., October 2026).
  Labels a supplied trace (F1 evidence, F2 harness friction, F3 loops, F4 content).
  An undelivered row is not a content failure. Decomposes S = r * q_bar and stops
  a harness rewrite when delivery is saturated and content failures dominate.
  Does not train weights. A bare run without --trace or --map-only exits non-zero.
  Slash: /harness-ceiling-diagnostics.
---

# Harness ceiling diagnostics (arXiv:2610.11655)

Paper: *Harness Evolution Hits a Ceiling: When Weight Training Should Begin*. Their DeepPlanning numbers stay theirs. This doctor does not run a training job.

## Goal

Classify one supplied agent trace on the local CPU. Process failures (friction, loops, missing evidence) stay a harness change. A trace that already delivers, and whose remaining failures are content, stops the rewrite.

## Taxonomy

The first signal that fires wins.

1. **F1 (Evidence)**: Unbacked-citation ratio ≥ 0.50, or an exit gate passed with unresolved items.
2. **F2 (Harness friction)**: The harness blocked the agent (forced checkpoint unlock, or ≥ 10 blocked tool calls), including when the score is high. Calibrate false positives. Secrets, self-protect, and outbound email stay blocked.
3. **F3 (Execution)**: The same tool call ≥ 3 times, ≥ 90% of the step budget, or the harness terminated the run.
4. **Healthy**: A delivered plan scores ≥ 0.50 and no earlier signal fired.
5. **F4 (Content)**: None of those fired, and a delivered plan scores below 0.50.
6. **Undelivered**: The row is not delivered and no evidence, friction, or execution signal fired. This is not F4.

Delivery is true only when `trajectory.delivered === true`. A score or an `output` field is not delivery.

## Rule

First match wins:

- No measured trajectories → `NONE`.
- Mean quality among delivered plans < 0.18 and delivery > 0.5 → `MODEL_CAPACITY_INSUFFICIENT`. 0.18 is the paper's DeepPlanning floor, not a ThumbGate measurement. The doctor does not name a replacement model.
- F2 ≥ 0.20, including when the score is high → `CALIBRATE_FALSE_POSITIVES`. The hard floor stays.
- Delivery < 0.80, or F3 ≥ 0.30, or F1 ≥ 0.25 → `HARNESS_EVOLUTION` (state ledger, loop break).
- Delivery ≥ 0.85 and F4 ≥ 0.40 → `CONTENT_CEILING` / `STOP_HARNESS_REWRITE`. An undelivered row does not count as F4.
- Healthy share ≥ 0.75, after the branches above → `MAINTAIN_STABLE`.
- Otherwise → `HYBRID_TUNING`. Residual process loops stay in the harness. The hard floor stays.

Edits that change what the model sees (a second context page, history, a ledger, retrieval) stay in the harness. Without a caller-supplied finite sigma, selection noise is unmeasured and a score delta is not called resolvable. 0.023 and 0.035 are the paper's DeepPlanning noise figures.

## Commands

```bash
# Bare run. Exits non-zero. Does not invent a sample.
node scripts/harness-ceiling-diagnostics.js --json

# Classify a recorded trace.
node scripts/harness-ceiling-diagnostics.js --trace=path/to/trace.json --json

# Rail map. Exit 0. Labels the paper's DeepPlanning constants.
node scripts/harness-ceiling-diagnostics.js --map-only
```

`npm run harness-ceiling:diagnostics` is that bare script. Pass `--trace` or `--map-only`.
