---
"thumbgate": patch
---

Add `scripts/conversion-rate-stats.js` — honest Bayesian beta-binomial conversion-rate estimation for low-N revenue data.

The audit on 2026-05-15 surfaced the right ML investment given ThumbGate's data volume: with only 3 lifetime orders and ~200 visitors per surface, frequentist conversion = charges/visitors produces dishonest rankings ("/pricing converts at 100%!" from one lucky charge on 1 visitor). The fix is a Bayesian beta-binomial model with a weakly-informative prior (Beta(1, 19), reflecting "most dev-tool surfaces convert at ~5% with broad uncertainty"). The posterior gives a credible interval that gets narrower as N grows: wide and honest at N=0, tight around the empirical rate at N=10k. Same code path, no need to switch models when data finally arrives.

The module exports:

- `posteriorParameters({successes, trials, priorAlpha, priorBeta})` — pure stats
- `estimateConversionRate(...)` — returns posterior mean, mode, 95% credible interval, and a verdict (`insufficient_data` / `wide_uncertainty` / `credible`)
- `rankSurfaces(surfaces, opts)` — ranks by lower-bound of credible interval (pessimistic ranking) by default. Prevents allocating traffic to a surface whose point estimate is high but whose lower bound is near zero.
- `renderConversionMarkdown(ranked)` — produces a markdown table ready to drop into the unified revenue rollup once #2090 lands.

Implementation includes a Lanczos approximation of log Γ, a Lentz continued-fraction evaluator for the regularized incomplete beta (CDF), and bisection on the CDF for the quantile function. No external dependencies — all pure-JS math.

20 unit tests cover: known logΓ values, CDF identity at Beta(1,1) = uniform, Beta(2,2) symmetry, quantile/CDF round-trip, prior + observation accumulation, N=0 returns the pure prior, N=10k tightens to the empirical rate, the "N=2 trap" (1 conversion of 2 visitors maps to ~9% posterior, NOT 50%), verdict cutoffs, pessimistic-ranking ordering, and markdown render.

Standalone for now; will fold into the unified revenue rollup as a follow-up after #2090 lands so we don't fight merge conflicts on the same file. Also reusable by `scripts/thompson-sampling.js` for adaptive surface allocation when transaction volume justifies it.
