---
"thumbgate": minor
---

Fix the actual conversion leak: rewrite the `/checkout/pro` interstitial from a 7-option paradox-of-choice page ("Choose the right paid path. Book $499 diagnostic / Start $1500 sprint / Pay in Stripe / Pay $99 teardown / Pay $19 quick read / Pay $1 first rule / Send workflow first / See options") into a focused Pro confirmation page with trust signals ("Start ThumbGate Pro $19/mo" + 4 verified-customer trust bullets + a single primary "Pay $19/mo with Stripe →" button), with the other 6 paid paths collapsed into a `<details>` "Other paid paths" disclosure. Remove the `confirm=1` bypass from the landing-page Upgrade-to-Pro link so the buyer sees the trust handoff before hitting the bare Stripe form. Verified funnel: 297 checkout starts → 4 paid in 30d (1.3%, vs. 5-15% industry norm) — this addresses the actual leak the audits kept pointing at.
