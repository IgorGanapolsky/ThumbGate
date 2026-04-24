---
"thumbgate": patch
---

fix(operational-summary): throw on 401/403 instead of silently falling back to empty local ledger

The hosted billing summary client used a `try { hosted } catch { local }` pattern that swallowed auth failures. When the operator key expired, the CLI reported $0.00 revenue even though Stripe had real charges — because the local ledger was empty and the 401 was caught silently.

Now 401/403 throw `hosted_summary_unauthorized` with an actionable message (re-auth the operator key). Non-auth failures (503, network) still fall back to local, but the result is tagged `source: 'local-unverified'` with `hostedStatus` so downstream consumers can distinguish verified from unverified revenue.
