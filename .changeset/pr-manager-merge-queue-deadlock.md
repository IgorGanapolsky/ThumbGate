---
"thumbgate": patch
---

Fix a deadlock that prevented `npm run pr:manage` from ever queuing a PR whose only outstanding check was the merge queue's own. `Trunk Merge Queue (main)` stays `pending` until a PR enters the queue, and `summarizeChecks()` bucketed every check — including that one — so pr-manager refused to submit while "1 quality check is still pending." The guard waited on its own output. Twelve Dependabot PRs sat stuck this way for up to 25 days with all seven required checks green. `config/merge-quality-checks.json` now carries a `selfReferentialChecks` list, and `summarizeChecks()` skips those names. Genuine pending or failing quality checks still block, verified by test.
