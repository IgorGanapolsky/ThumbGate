# RRSI: Regularized Recursive Self-Improvement of Agent Harnesses (FORMAT Steal)

Doctor: `node scripts/rrsi-doctor.js --json`

Sources:
- Paper: *RRSI: Regularized Recursive Self-Improvement of Agent Harnesses* (arXiv:2609.24972, Google Cloud AI Research, Sep 23, 2026; Peng Xia, Rujun Han, Zifeng Wang, Tomas Pfister, Chen-Yu Lee, et al.).
- Foundation: Recursive Self-Improvement (RSI) of agent scaffolds, prompt topologies, tools, thresholds, and prevention rules.

ThumbGate does **not** vendor external Python ML training pipelines, require cloud GPUs, or call black-box eval models. This is an architectural FORMAT steal of RRSI's mathematical regularization principles into ThumbGate's deterministic Node.js evolution rails (`scripts/workspace-evolver.js`, `scripts/autoresearch-runner.js`, `scripts/experiment-tracker.js`, `scripts/feedback-loop.js`).

---

## The High-ROI Problem & Opportunity for ThumbGate

When autonomous AI coding agents optimize their own harnesses (autoresearch loops, hyperparameter tuning, prompt refinement, prevention rule generation), **naive Recursive Self-Improvement (RSI)** fails catastrophically:

1. **Evaluation Noise Exploitation:** In stochastic test environments, random test timing, LLM variance, or flake produces spurious gains. Unregularized RSI treats every positive fluctuation $\Delta S > 0$ as a genuine breakthrough, accepting mutations that fail out-of-distribution (OOD).
2. **Benchmark Leakage & Cheating:** Agents optimize prompts or rules by hardcoding benchmark fixtures, test file paths, or synthetic eval tokens (e.g. `tests/fixtures/`, `SWE-bench`, mock constants) rather than discovering generalizable capabilities.
3. **Complexity Bloat ($L_0$ and $L_1$ Explosion):** Harness prompts, retry limits, and prevention rules grow monotonically without pruning. Bloated harnesses degrade context windows, increase latency, and explode token billing.
4. **Stagnation & Late-Stage Disruption:** Uniform random mutation gets trapped in local minima; unconstrained step sizing late in evolution breaks finely tuned hyperparameters.

**RRSI provides the mathematical foundation to guarantee that ThumbGate's recursive self-improvement converges stably, generalises OOD, and resists bloat.**

---

## Mathematical Formulation & Rail Map

RRSI formalizes harness evolution as:
$$H_{t+1} = \text{Regularize}(\text{Propose}(H_t), \text{Select}(H_t))$$

| RRSI Principle | Mathematical Formulation | ThumbGate Rail | Enforcement & Impact |
|---|---|---|---|
| **Cosine-Annealed Update Sparsity ($L_0$ Cardinality Budget)** | $b_t = \lfloor b_{\min} + (b_{\max} - b_{\min}) \cdot \frac{1}{2}(1 + \cos(\pi \cdot \min(t, T) / T)) \rfloor$ | `scripts/rrsi-regularizer.js` (`calculateAnnealedBudget`) | Allows broad multi-parameter exploration early ($b=3$), strictly enforces isolated single-variable edits late ($b=1$). |
| **Annealed Step Sizing** | $\alpha_t = \alpha_{\min} + (\alpha_{\max} - \alpha_{\min}) \cdot \frac{1}{2}(1 + \cos(\pi \cdot \min(t, T) / T))$ | `scripts/rrsi-regularizer.js` (`calculateAnnealedStepMultiplier`) | Attenuates parameter step size from $1.0$ down to $0.25$, guaranteeing fine-tuning convergence. |
| **Pre-Screening Leakage Critic** | $\text{Critic}(H') \in \{\text{PASS}, \text{REJECT}\}$ before evaluation | `scripts/rrsi-regularizer.js` (`screenLeakage`) | Fails closed on benchmark datasets (`SWE-bench`, `HumanEval`), fixture hardcodes, or session tokens before running tests. |
| **Complexity-Aware Scoring ($L_1$ Penalty)** | $\Delta S_{\text{reg}} = (S_{\text{cand}} - S_{\text{base}}) - \lambda \cdot \max(0, \Delta C) > \epsilon$ | `scripts/rrsi-regularizer.js` (`evaluateComplexityRegularizedScore`) | Rejects mutations where token or parameter growth outweighs score delta. Blocks marginal bloat. |
| **Structured Exploration (Entropy Regularization)** | If $\frac{1}{w} \sum_{i=1}^w \|\Delta S_{t-i}\| \le \delta$, force $\text{entropy\_exploration}$ | `scripts/rrsi-regularizer.js` (`detectStagnation`, `selectTargetWithExploration`) | Automatically detects stalled evolution and redirects proposals to historically unexercised harness targets. |
| **Structural Pruning ($L_0$ Bloat Removal)** | Strips duplicate, subsumed, or zero-activation rules | `scripts/rrsi-regularizer.js` (`pruneStructuralRedundancy`) | Periodically prunes prevention rules and prompt guidelines to maintain tight, low-latency agent harnesses. |

---

## Fail-Closed Invariants

| Invariant | Trigger Condition | Enforcement Action |
|---|---|---|
| `rrsi_leakage_detected` | Proposed mutation or hypothesis contains benchmark names, fixture paths, or cheat tokens | REJECTED BEFORE EVALUATION (`[RRSI Leakage Critic]`) |
| `rrsi_complexity_bloat` | Candidate score gain is outweighed by complexity penalty ($\Delta S_{\text{reg}} \le \epsilon$) | DISCARDED (`penalized by complexity`) |
| `rrsi_stochastic_regression` | Candidate score degrades below baseline ($S_{\text{cand}} < S_{\text{base}}$) | DISCARDED (`Score regressed`) |
| `rrsi_stagnation_redirect` | Last $w=3$ experiments produce flat or discarded outcomes | FORCED EXPLORATION on least-exercised target |
| `rrsi_rule_redundancy` | Prevention rule is an exact duplicate or subsumed by a shorter rule | PRUNED AUTOMATICALLY during compilation |

---

## Verification & Usage

```bash
# 1. Audit RRSI regularizer health & rail mapping
node scripts/rrsi-doctor.js
node scripts/rrsi-doctor.js --json
node scripts/rrsi-doctor.js --map-only

# 2. Run RRSI unit and integration test suite
node --test tests/rrsi-regularizer.test.js

# 3. Run autoresearch loop with RRSI regularization active
node scripts/autoresearch-runner.js --run --iterations=5 --target=half_life_days
```
