---
"thumbgate": patch
---

Resolve plan amounts for funnel-derived github_marketplace paid events so `cfo --today` no longer reports `$0.00` when orders only exist in the funnel ledger. The read-time deriver now runs entries through the same plan-pricing resolver the on-disk revenue ledger already uses.
