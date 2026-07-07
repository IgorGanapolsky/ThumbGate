---
"thumbgate": patch
---

Fix checkout conversion bug: 99 visitors hit /checkout/pro in 30 days, 0 paid. The server-side Stripe session creation was failing silently (env var not configured on Railway), causing the form to loop back to the interstitial instead of redirecting to Stripe. Changed the form action to link directly to the Stripe Payment Link, bypassing the broken server-side flow entirely.
