---
"thumbgate": patch
---

Harden revenue observability by preferring hosted billing-summary truth over local fallback when `THUMBGATE_API_KEY` is available, adding machine-readable Stripe live status diagnostics, and wiring the daily revenue loop to audit hosted revenue, Stripe, and Plausible checkout attribution with artifacts.
