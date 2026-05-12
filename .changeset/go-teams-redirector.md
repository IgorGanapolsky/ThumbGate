---
"thumbgate": minor
---

Add `/go/teams` to the tracked-link redirector — was returning HTTP 404 + "Tracked link not found" since the slug wasn't registered in `TRACKED_LINK_TARGETS`. Real impact: Aiventyx marketplace's Teams listing (5 clicks on 8 views ≈ 62% CTR — our strongest-performing external listing) had every click landing on a 404 page after our integrator swapped to the canonical `https://thumbgate.ai/go/teams?utm_source=aiventyx&...` URL. Now redirects to `/checkout/pro` with `plan_id=team&seat_count=3&billing_cycle=monthly` defaults — the 3-seat ($147/mo) self-serve Stripe Team checkout path. UTM params from caller flow through (Aiventyx-attributed clicks remain traceable end-to-end into Stripe). Two regression tests added pinning the redirect contract.
