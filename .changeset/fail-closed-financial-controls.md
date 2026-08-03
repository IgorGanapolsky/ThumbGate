---
"thumbgate": minor
---

Add an append-only purchase-control ledger and fail closed on economic actions
without an independently approved, single-use budget reservation. Explicit zero
budgets now block instead of being treated as unset. MCP, hook, and workflow
entry points support an operator-owned HTTPS compare-and-set anchor so valid
ledger history cannot be rolled back through local filesystem restoration.
