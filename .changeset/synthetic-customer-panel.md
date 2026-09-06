---
"thumbgate": patch
---

Add a narrow synthetic customer panel that ranks three existing public landing-page angles for qualified install intent.

The runner stores 10 structured personas with public evidence, simulates ad/compare/pricing contexts, and prints a hypothesized ranking plus a 10–20% traffic-split recommendation. Simulated ranks stay modeled-not-measured until observed holdout rankings pass; this is not a conversion-lift claim and not a digital twin of every visitor.

Successor of #3649: rebased onto current `main` without taking the stale `package.json` test-chain rewrite. `test:synthetic-customer-panel` is appended to `npm test`. The new script is not packed (same as the original PR), so the public bundle ceiling is unchanged.
