---
"thumbgate": patch
---

Close checkout funnel attribution by emitting the canonical Plausible purchase event from Stripe webhook completion, aligning the Plausible poller to canonical checkout event names, and separating raw telemetry from qualified external visitor paths in analytics reports.
