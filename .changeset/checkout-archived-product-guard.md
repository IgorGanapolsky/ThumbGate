---
"thumbgate": patch
---

Add a defensive guard in `createCheckoutSession` that refuses to create a Stripe checkout session when the only Stripe product matching the plan's product name (e.g. "ThumbGate Pro") is archived. Without this guard, `buildSubscriptionPriceData` passes inline `product_data` to Stripe, Stripe name-matches an archived product, creates a new price under it that inherits `active=false`, and every buyer sees "Something went wrong / The page you were looking for could not be found." on the Stripe checkout page.

This is the May 2026 incident documented in ThumbGate#2188: 20 abandoned sessions in 7 days, 0 paid, 0 emails captured. The pattern looks like buyer abandonment in Stripe Dashboard but is actually a misconfiguration where every buyer was served a broken page from the moment they arrived.

The new `verifyActiveProductForPlan(stripe, planId)` helper runs before `sessions.create` and throws with a clear remediation message if the matching product is only present in archived state. Best-effort on Stripe API transient failures (does not block checkout on infra hiccups). Tests pin the four behaviors: active product present (pass), no product (pass — Stripe will create one), only archived product (throw with diagnostic), Stripe API timeout (graceful pass).
