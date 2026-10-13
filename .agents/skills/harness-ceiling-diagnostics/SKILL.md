---
name: harness-ceiling-diagnostics
description: >
  Harness Evolution Ceiling and Failure Composition diagnostics stolen from arXiv:2610.11655
  (Tian et al., October 2026). Labels failed agent trajectories (F1 evidence, F2 harness friction,
  F3 loops/process, F4 content/quality), decomposes score deltas (S = r * q_bar), bounds selection
  optimism (s * sqrt(2 * ln(K))), and triggers weight training / DPO distillation when the harness
  hits its ceiling. Slash: /harness-ceiling-diagnostics.
---

# Harness Evolution Ceiling & Weight Training Trigger (arXiv:2610.11655)

## Goal

Provide deterministic, sub-millisecond (<0.5ms) CPU-local failure composition analysis to diagnose
whether an agent needs further **harness runtime engineering** (state ledgers, loop breakers, PreToolUse relaxation)
or has ceilinged and requires **model weight training** (LoRA / DPO trajectory distillation).

## The Four-Class Failure Taxonomy

1. **F1 (Evidence)**: Unbacked claim ratio $\ge 0.50$ or exit gate passed with unresolved checklist items.
2. **F2 (Harness Friction)**: $\ge 10$ blocked tool calls or forced checkpoint unlock.
3. **F3 (Execution Control / Process)**: Tool loop ($\ge 3$ repeated calls), step budget $\ge 90\%$, or timeout.
4. **F4 (Planning / Content)**: Delivered cleanly without process exceptions, but score $< 0.50$.
5. **Healthy**: Clean delivery with score $\ge 0.50$.

## Constraints

| NEVER | ALWAYS |
| :--- | :--- |
| Train weights when delivery is low ($r < 80\%$) | Evolve harness (ledger, loop breaker) to raise delivery first |
| Waste compute evolving harness when $F_4$ dominates and $r \ge 85\%$ | Export trajectories to DPO via `npx thumbgate export-dpo` and fine-tune LoRA |
| Ignore harness friction ($F_2 \ge 20\%$) | Calibrate and prune overzealous PreToolUse deny gates |
| Distill edits that change what the model *sees* (history window, ledger) | Keep *sees* edits in harness; distill only *writes* edits (prompts, schemas, outputs) |
| Accept noisy candidates below $0.035$ | Bound selection optimism via $s \sqrt{2 \ln K}$ and re-anchor after every accept |

## Execution

```bash
# Run diagnostics on synthetic profile or default run
node scripts/harness-ceiling-diagnostics.js --json

# Run diagnostics on custom recorded agent trace
node scripts/harness-ceiling-diagnostics.js --trace=path/to/trace.json --json

# Inspect theoretical paper mapping
node scripts/harness-ceiling-diagnostics.js --map-only
```
