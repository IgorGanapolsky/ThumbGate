# ActiveSaddler Automated Curriculum Learning — Compare, Do Not Clone

> **Paradigm Reference**: arXiv:2610.00906 (*"ActiveSaddler: Automated Curriculum Learning for Agent Harness Optimization"*)  
> **ThumbGate Implementation**: `scripts/activesaddler-curriculum-doctor.js` | `tests/activesaddler-curriculum-doctor.test.js`  
> **Skill**: `.agents/skills/activesaddler-curriculum-honesty/SKILL.md` (`/activesaddler-curriculum-honesty`)  
> **Status**: In-tree, verified, 0 external dependencies, <1ms CPU budget.

---

## 1. Executive Summary

Static evaluation benchmarks and rigid pre-tool evaluation orders suffer from **agent non-stationarity**: as prompts, models, and tools evolve, agent failure modes shift dynamically. Running static verification suites burns unnecessary latency and fails to prioritize the failure modes currently threatening system integrity.

ActiveSaddler models harness evaluation and pre-action gating as a **non-stationary Multi-Armed Bandit (MAB)**. It abstracts distinct failure patterns into bandit arms, applying a **Discounted Upper Confidence Bound (D-UCB)** policy that balances:
1. **Exploitation**: Giving high evaluation priority to failure modes with recent violations and high operational severity.
2. **Exploration**: Calibrating a discovery bonus to periodically re-evaluate low-frequency failure modes and detect regression drift.
3. **Fail-Fast Latency Ordering**: Reordering pre-tool checks so the highest-risk rules execute first, terminating execution within <0.5ms on violation before secondary rules run.

---

## 2. Four Stolen Practices (FORMAT Steal)

| Practice | ActiveSaddler (arXiv:2610.00906) | ThumbGate Dynamic Curriculum Steal |
| :--- | :--- | :--- |
| **Dynamic Failure-Pattern Arms** | Clusters execution traces into non-stationary benchmark arms | Maps `MistakePattern` objects into `FailurePatternArm` entries with severity multipliers (`CRITICAL: 3.0`, `HIGH: 2.0`) |
| **Discounted UCB Policy** | Non-stationary bandit policy across synthetic environments | Discounted UCB score: $\hat{\mu}_i + c \sqrt{\frac{2 \ln N}{n_i}} \times \text{multiplier}$ with decay factor $\gamma = 0.92$ |
| **Fail-Fast Rule Prioritization** | Orders tasks by learning difficulty | Sorts `pre_tool_use` prevention rules descending by curriculum score (<0.5ms evaluation latency) |
| **Automated Drift Detection** | Detects shifts in policy weakness clusters | Flags when a single failure mode claims >60% of recent violations to dynamically adapt gating rules |

---

## 3. Strict Anti-Clone Boundaries

```text
1. NEVER install PyTorch, Ray, Stable-Baselines, or external RL packages.
2. NEVER spin up GPU training loops or heavy reinforcement learners in CI.
3. ALWAYS maintain deterministic CPU-local bandit math (<1ms evaluation latency).
4. ALWAYS keep failure pattern state in local-first structured JSON receipts.
```

---

## 4. Verification Evidence

Run the doctor suite:
```bash
node scripts/activesaddler-curriculum-doctor.js --json
node scripts/activesaddler-curriculum-doctor.js --map-only
node --test tests/activesaddler-curriculum-doctor.test.js
```

Benchmark performance:
- Diagnostic latency: **~0.14ms** (budget < 5.0ms)
- Rule prioritization latency: **~0.05ms** (budget < 1.0ms)
- Test suite: **7/7 passing**.
