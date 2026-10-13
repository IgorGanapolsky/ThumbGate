---
name: decisive-step-evaluator
description: >
  NVIDIA arXiv:2610.10478 decisive-step evaluation: isolate the 1st code edit
  that flips a repository's tests from failing to passing. Score models only on
  this decisive action (Spearman rho = 0.964 vs SWE-bench Verified) rather than
  diluting scores across all exploration steps (rho = 0.915).
---

# Decisive-Step Evaluation (NVIDIA arXiv:2610.10478 FORMAT Steal)

## Goal

Apply the empirical finding from *Before They Can Solve: Predicting Post-Training Coding-Agent Performance from Base Models* (NVIDIA Research, arXiv:2610.10478):
1. Isolate the **Decisive Step** in multi-turn trajectories: the first code edit that flips tests from fail to pass.
2. Score candidate models only on the decisive action (via Decisive BPB and Patch MCQ contrastive discrimination) rather than averaging across every noisy exploration step.
3. Select models for agent workflows and post-training based on decisive-step signal ($\rho = 0.964$).

## Constraints

| NEVER | ALWAYS |
| :--- | :--- |
| Score models by averaging across all turns (exploration, `ls`, `grep`) | Isolate the decisive step where test status flipped from fail to pass |
| Evaluate base models from cold-start multi-step runs (mis-ranks on tool syntax) | Evaluate prefix-conditioned at the decisive step |
| Accept trajectories without a verified test flip | Reject trajectories that never failed or never passed (`hasDecisiveStep: false`) |
| Select candidate models based on parameter count alone | Select based on decisive-action discrimination rate ($\ge 60\%$) |

## Commands

```bash
# Doctor status
npx thumbgate decisive-step --json

# Rail map
npx thumbgate decisive-step --map-only --json

# Test suite
node --test tests/decisive-step.test.js
```

## Reference

- Paper: arXiv:2610.10478 (NVIDIA Research, Oct 2026)
- Synthesizer: Rohan Paul (@rohanpaul_ai, Oct 12, 2026)
- Evaluator: `scripts/decisive-step-evaluator.js`
- Doctor: `scripts/decisive-step-doctor.js`
- Documentation: `docs/agents/decisive-step-evaluator.md`
