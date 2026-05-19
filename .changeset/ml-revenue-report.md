---
"thumbgate": minor
---

Adds `scripts/ml-revenue-report.js` — the first script that points our existing Bayesian conversion-rate stats at the revenue question.

Background: ThumbGate ships ~3,000 lines of ML/stats code (Thompson Sampling, Beta-binomial conversion estimation in `conversion-rate-stats.js`, RLAIF reward, judge-reward-function, semantic dedup). ~90% pointed at the agent-product internals; ~10% at revenue — and that 10% was data-starved because Plausible was paywalled.

This script wires:
- Telemetry source: our own `/v1/telemetry/export` via `THUMBGATE_API_KEY` (in GH secrets)
- Conversion source: Stripe API via `STRIPE_SECRET_KEY` (in GH secrets, owner-filtered to exclude founder self-purchases)
- Stats: `conversion-rate-stats.js` Beta-binomial posteriors → credible intervals → ranked output

Output: per-UTM-source and per-CTA-placement Bayesian conversion rate with credible intervals. Verdicts honest about low-N regimes ("uninformative" when we genuinely don't know yet, not "the rate is zero").

`.github/workflows/ml-revenue-report.yml` runs daily at 14:00 UTC (after Daily Revenue Loop) plus `workflow_dispatch` with custom window.

10 unit tests cover: arg parsing, relative-window math, UTM/CTA surface grouping, owner-email filtering, end-to-end with mocked fetch + Stripe, missing-key error paths, markdown rendering with Bayesian framing.
