---
"thumbgate": patch
---

Checkout now verifies the Stripe price ids it is configured with. `/health` lists each id with its amount, interval and whether it is active (`checks.checkoutPrices`), and an archived or missing id is reported as degraded and kept out of the session metadata. Subscription sessions keep sending inline `price_data`, so Stripe lists a fresh inactive one-off price on each session by design.
