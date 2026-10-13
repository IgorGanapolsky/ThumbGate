---
name: harness-evolution-ceiling
description: >
  arXiv:2610.11655 diagnose-then-intervene rail: read failure composition
  (process vs content) to detect when harness evolution hits its ceiling.
  When content failures dominate, switch to weight training (LoRA/distillation)
  or model tier escalation instead of bloating prompts and AGENTS.md rules.
---

# Harness Evolution Ceiling (arXiv:2610.11655 FORMAT Steal)

## Goal

Apply the empirical law from *Harness Evolution Hits a Ceiling: When Weight Training Should Begin* (arXiv:2610.11655) to agent harnesses, task outcomes, and `omp.sh`:
1. Label failed agent trajectories by the first signal that fires into **Process Failures** vs **Content Failures**.
2. Evolve the harness (rules, gates, tool contracts) when process failures are active ($P_f \ge 20\%$).
3. When process failures drop and content failures dominate ($C_f \ge 80\%$, $P_f \le 20\%$), declare **Harness Ceiling Reached**. Freeze prompt rules and switch the lever to **Weight Training** (LoRA/distillation) or **Model Tier Escalation** (`Route: named` to frontier model).
4. Partition accepted edits so security controls remain in the runtime harness while formatting/planning templates are isolated for weight adaptation.

## Constraints

| NEVER | ALWAYS |
| :--- | :--- |
| Bloat `AGENTS.md` / prompts with negative rules when failures are content/reasoning gaps | Read failure composition first: classify into process vs content |
| Claim harness ceiling with $<3$ failures or when process failures are still high ($>20\%$) | Evolve harness (fix tool syntax, gates, loops) while process failures remain |
| Move security gates, checkout leases, or task-scope fences into model weights | Keep security controls in the runtime harness; train only templates & styles |
| Use unnamed models (Auto, Fast) when content ceiling is reached | Escalate to named frontier model (`Route: named`) or train LoRA adapter |

## Commands

```bash
# Audit harness ceiling rail status
npx thumbgate harness-ceiling --json

# Rail map
npx thumbgate harness-ceiling --map-only --json

# Dynamic failure composition evaluation
npx thumbgate harness-ceiling --evaluate --process=0 --content=8 --json

# Test suite
node --test tests/harness-ceiling.test.js
```

## Reference

- Paper: arXiv:2610.11655 (Tian et al., Oct 2026)
- Doctor: `scripts/harness-ceiling-doctor.js`
- Task outcomes: `scripts/task-outcomes.js` (`classifyFailureType`)
- RRSI regularizer: `scripts/rrsi-regularizer.js` (`evaluateHarnessCeiling`, `partitionAcceptedEdits`)
- omp coordination: `scripts/omp-coordination-honesty.js` (`diagnoseFailureIntervention`)
- Documentation: `docs/agents/harness-evolution-ceiling.md`
