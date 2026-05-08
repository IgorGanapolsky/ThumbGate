---
"thumbgate": patch
---

`repairGithubMarketplaceRevenueLedger` now also walks the funnel ledger and persists resolved amounts for `paid` `github_marketplace` orders that never landed in `revenue-events.jsonl`. PR #1810 fixed read-time resolution; this fix completes the loop by writing recovered rows to disk so audits and downstream exports see them too. Idempotent — only persists when plan pricing produces a known amount, and skips rows already in the ledger.
