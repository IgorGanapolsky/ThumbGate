---
"thumbgate": minor
---

Add `scripts/stripe-bootstrap-saas-catalog.js` + dispatch workflow that idempotently creates the persistent `ThumbGate Pro` / `ThumbGate Team` / `ThumbGate Free` products + prices in the live Stripe Product Catalog. Why: Checkout Sessions today use inline `product_data` (which works and ships per-tier thumbnails), but the dashboard Product Catalog only shows legacy consulting SKUs — no ThumbGate-branded SaaS rows. That blocks (a) the Stripe Customer Portal plan-switcher, (b) Payment Links wired to stable prices, and (c) the CEO view of "what we sell." Bootstrap is keyed by `metadata.thumbgate_tier`, prices by `lookup_key` (`thumbgate_pro_monthly`, `thumbgate_pro_annual`, `thumbgate_team_per_seat_monthly`) — re-runs are no-ops once converged. Workflow is manual-dispatch only.
