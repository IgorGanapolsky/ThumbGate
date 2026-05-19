---
"thumbgate": minor
---

Add Bayesian A/B testing harness (`scripts/ab-experiment-framework.js`) on top of the existing Beta-binomial conversion-rate stats. Provides deterministic SHA-256 variant assignment, MC-sampled posterior decision rule with practical-significance threshold, and loss-bound stopping criterion. Verdicts: `ship_a` | `ship_b` | `inconclusive_stop` | `continue`. 11 unit tests cover assignment determinism, weight calibration, decision correctness under clear-winner / tied / low-sample regimes.
