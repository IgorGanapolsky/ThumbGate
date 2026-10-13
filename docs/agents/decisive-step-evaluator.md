# Decisive-Step Evaluation (NVIDIA arXiv:2610.10478 FORMAT Steal)

Doctor: `node scripts/decisive-step-doctor.js --json`  
CLI: `npx thumbgate decisive-step --json` | `npx thumbgate decisive-step --map-only`

Sources:
- Paper: *Before They Can Solve: Predicting Post-Training Coding-Agent Performance from Base Models* (NVIDIA Research, arXiv:2610.10478, Oct 7, 2026: Tan Yu, Alexander Bukharin, Khushi Bhardwaj, et al.).
- Synthesis: Rohan Paul (@rohanpaul_ai, Oct 12, 2026).
- Foundation: Post-training model candidate selection, decisive action screening, and trajectory evaluation.

ThumbGate does **not** run GPU cluster post-training or vendor closed benchmark suites. This is an architectural FORMAT steal of NVIDIA's decisive-step evaluation methodology into ThumbGate's model candidate ranking (`scripts/model-candidates.js`), trajectory analysis (`scripts/trajectory-scorer.js`), and DPO pair export (`scripts/dpo-export.js`).

---

## The High-ROI Problem & Discovery

When evaluating candidate base models for agentic post-training or deciding which model tier to deploy for multi-step agent workflows:

1. **The Averaging Trap (Diluted Signal):** Standard benchmarks evaluate models across *every step* of an agent trajectory (exploration, `ls`, `grep`, syntax trial-and-error). Averaging across all steps yields a degraded Spearman correlation ($\rho = 0.915$) with post-trained coding skill and frequently mis-ranks models.
2. **The End-to-End Cold-Start Trap:** Many capable base models cannot reliably produce well-formed tool invocations from a cold start, scoring near-zero on end-to-end multi-step benchmarks despite having strong underlying code-editing capability.
3. **The NVIDIA Discovery:** Replaying a successful agent trajectory and rerunning tests after each code edit isolates the **Decisive Step**: the *first action that flips the repository from failing tests to passing tests*.
   - Scoring base models *only* on their probability and contrastive preference at this decisive step predicts post-trained SWE-bench Verified performance at **Spearman $\rho = 0.964$**.

---

## Rail Map

| NVIDIA arXiv:2610.10478 Principle | Paper Finding | ThumbGate Rail | Enforcement & Impact |
| :--- | :--- | :--- | :--- |
| **Decisive Step Identification** | "Replaying each trajectory and rerunning tests after every code-changing step identifies the decisive step: the first step whose cumulative patch flips the repository from failing to passing." | `scripts/decisive-step-evaluator.js` (`findDecisiveStep`) | Consumes per-edit test outcomes produced by an upstream replay process and isolates the exact step index $t^*$ where the supplied status transitioned from fail to pass; it does not replay edits or rerun tests. |
| **Decisive-Action Screening** | "How likely each base model was to write that exact edit ranked the same 10 models in line with their post-trained SWE-bench Verified scores, at 0.964." | `scripts/decisive-step-evaluator.js` (`compareStepScoringMethods`) | Eliminates noisy early exploration steps and concentrates candidate evaluation on the certified test-passing patch. |
| **Patch MCQ Contrastive Selection** | "Tests the checkpoint's choice between that action and alternatives rejected by the same verifier." | `scripts/decisive-step-evaluator.js` (`evaluatePatchMcq`) | Tests whether a candidate model discriminates the test-passing edit over earlier rejected edits that failed tests. |
| **Prefix-Conditioned Execution** | "Evaluates support for functionally-correct generations and credits any continuation that the tests accept." | `scripts/decisive-step-evaluator.js` (`prefixSteps`) | Evaluates model capability conditioned on the prefix trajectory, avoiding tool-harness cold-start failure modes. |

---

## Fail-Closed Invariants

| Invariant | Trigger Condition | Enforcement Action |
| :--- | :--- | :--- |
| `no_test_flip_trajectory` | Trajectory never achieved passing tests, or tests were passing from start without a code edit | **REJECTED** as decisive-step benchmark sample (`hasDecisiveStep: false`) |
| `all_step_averaging_dilution` | Scoring models by uniform average across exploration steps rather than decisive step | **WARNED** (Decisive score contrast ratio $< 1.0$) |
| `mcq_stub_preference` | Candidate prefers trivial stubs (`return null`, `pass`) over decisive verified logic | **FLAGGED** as low coding capability ($<60\%$ discrimination rate) |

---

## Verification & Usage

```bash
# 1. Audit decisive step doctor & rail mapping
node scripts/decisive-step-doctor.js
node scripts/decisive-step-doctor.js --json
node scripts/decisive-step-doctor.js --map-only

# 2. Run unit and integration test suite
node --test tests/decisive-step.test.js
```
