# Harness ceiling diagnostics (arXiv:2610.11655)

> **Paper**: *Harness Evolution Hits a Ceiling: When Weight Training Should Begin*
> **Authors**: Yuan Tian, Bing Hu, Hao Wang, Binghang Lu, Fang Wu (October 2026)
> **Target**: ThumbGate PreToolUse failure composition on a supplied trace
> **CLI**: `node scripts/harness-ceiling-diagnostics.js --trace=<file> --json` or `--map-only`

`npm run harness-ceiling:diagnostics` runs the script with no arguments and exits non-zero. It does not invent a sample. This doctor does not run a training job.

## What we take from the paper

The paper's diagnose-then-intervene order is: label each trajectory by the first signal that fires, then pick one lever.

- **F1 evidence**: unbacked-citation ratio ≥ 0.50, or an exit gate passed with unresolved items.
- **F2 harness friction**: the harness blocked the agent (forced checkpoint unlock, or ≥ 10 blocked tool calls) and the score is low.
- **F3 execution**: the same tool call ≥ 3 times, ≥ 90% of the step budget, or the harness terminated the run.
- **F4 content**: none of those fired, and a delivered plan scores below 0.50.
- **Healthy**: a delivered plan scores ≥ 0.50.

Delivery is true only when `trajectory.delivered === true`. A positive score or a present `output` is not delivery.

Composite score is `S = r * q_bar`: delivery rate times mean quality among delivered plans. A score delta splits into a delivery term and a quality term. Process classes (F2, F3) are the harness lever. F4 is a content ceiling because those process signals do not separate it from a healthy run.

Edits that change what the model sees (a second context page, history, a ledger, retrieval) stay in the harness. The field `distillablePercentage` counts write-surface edits only. An unknown path, and a path that matches both a write pattern and a see pattern, stay sees.

## Their numbers stay theirs

| Figure | Where it came from | How this doctor uses it |
| :--- | :--- | :--- |
| 0.18 | Paper DeepPlanning capacity floor | Named only as `PAPER_DEEP_PLANNING.capacityFloor`. Not a ThumbGate measurement. |
| 0.023 | Paper DeepPlanning rollout sigma | Used only when the caller passes a finite sigma. |
| 0.035 | Paper DeepPlanning resolvability line | `Math.max(0.035, bound)` only when sigma was passed. |

`--map-only` labels that source as `arXiv:2610.11655 DeepPlanning, not a ThumbGate measurement`. With no measured sigma, `computeSelectionOptimismBound(10)` returns a null bound and `noiseMeasured: false`. Sigma 0 is finite and measured: the bound is 0 and the threshold stays 0.035.

## Diagnose order

First match wins.

1. Healthy share ≥ 0.75 → `MAINTAIN_STABLE`. Action: retain the harness and monitor drift.
2. Mean quality among delivered plans < 0.18 and delivery > 0.5 → `MODEL_CAPACITY_INSUFFICIENT`, lever `PAPER_CAPACITY_FLOOR`. Stop the rewrite. This doctor does not name a replacement model.
3. F2 ≥ 0.20 → `HARNESS_FRICTION_CALIBRATION`, lever `CALIBRATE_FALSE_POSITIVES`. Calibrate false-positive denies. Secrets, self-protect, and outbound email stay blocked.
4. Delivery < 0.80, or F3 ≥ 0.30, or F1 ≥ 0.25 → `HARNESS_EVOLUTION`, lever `HARNESS_RUNTIME`. State ledger, identical-call break, citation check before an exit gate.
5. Delivery ≥ 0.85 and F4 ≥ 0.40 → `CONTENT_CEILING`, lever `STOP_HARNESS_REWRITE`. Keep the harness that already delivers.
6. Otherwise → `HYBRID_TUNING`. Address residual process loops. The same hard floor stays.

An empty trajectory list is status `empty`, recommendation `NONE`, exit 1. A missing or unreadable `--trace` is `trace_unreadable`. A parse error is `trace_parse_error`. `--profile` is not a substitute for a trace.

## Commands

```bash
node scripts/harness-ceiling-diagnostics.js --json
node scripts/harness-ceiling-diagnostics.js --trace=path/to/trace.json --json
node scripts/harness-ceiling-diagnostics.js --map-only
node --test tests/harness-ceiling-diagnostics.test.js
```

The first command exits non-zero.
