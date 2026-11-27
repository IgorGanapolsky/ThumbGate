---
"thumbgate": patch
---

During the Black Friday offer, the server creates the Stripe coupon at startup (and every 10 minutes) instead of waiting for the first buyer, and /health reports the coupon plus a Stripe invoice preview of the discounted first-year Pro price.
