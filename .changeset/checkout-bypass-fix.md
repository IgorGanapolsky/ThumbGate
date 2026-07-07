---
"thumbgate": patch
---

Fix broken checkout: 99 visitors hit /checkout/pro in 30 days, 0 converted. The interstitial form posted back to itself instead of redirecting to Stripe. Now bypasses the broken createCheckoutSession path and routes directly to the Stripe Payment Link. Bypass is enabled by default.
