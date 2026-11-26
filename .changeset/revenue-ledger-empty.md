---
"thumbgate": patch
---

Billing source diagnostics no longer call a missing revenue ledger a broken source when nothing has been sold yet. With no Stripe or marketplace key in the key store, the warning is now `revenue_ledger_empty` ("No revenue events recorded yet; the revenue ledger is created by the first paid checkout."). `revenue_ledger_missing` still fires when paid keys exist but the ledger does not.
