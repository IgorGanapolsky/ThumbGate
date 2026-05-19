---
"thumbgate": patch
---

**Stops the source of the 2,251 zombie Stripe checkout sessions** surfaced by the 2026-05-19 diagnostic (98.2% expired, 0 email captured, $147 amounts).

Root cause was two independent leaks creating sessions on every visit:

1. **`public/index.html:1299`** — the "Start 3-seat Team — $147/mo" landing-page link hardcoded `&confirm=1` in the URL. Every crawler that hit the landing page followed this link → `/checkout/pro?confirm=1` → live Stripe `cs_live_*` session creation. Matches the `$147` amount on most expired sessions in the diagnostic. Fix: drop `confirm=1` from the link. Crawlers + humans now land on the interstitial (same flow as the $19 Pro path).

2. **`scripts/revenue-observability-doctor.js:84`** — the prod healthcheck GETs `/checkout/pro?confirm=1` to verify the redirect contract. Daily-revenue-loop cron runs this script. Each tick = one zombie session. Fix: drop the confirm-path probe; the interstitial-body check on `/checkout/pro` already proves the deflection is live, and the post-deflection confirm path is covered by `checkout-bot-guard` integration tests.

Doctor return shape preserved (`result.confirm.status / redirects / location`) for downstream consumers; values are now `null` and `probeDisabled: true` flag set. Test rewritten with a regression guard: throws if any future fetch from the doctor includes `confirm=1`.

5/5 doctor tests pass. Public-landing tests pass.
