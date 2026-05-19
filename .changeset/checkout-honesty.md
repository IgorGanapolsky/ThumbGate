---
"thumbgate": patch
---

Removes false trust claims from the live `/checkout/pro` interstitial. Verified ground truth via the existing audit (`~/.openclaw/memory/current-revenue-state.md` 2026-05-15) + the npm registry API:

- "6 paying customers" → **0** real external customers (only Stripe charge was a founder self-purchase)
- "18,000+ installs verified on npm" → **5,257** real downloads in the last 30 days (per `api.npmjs.org/downloads/range/last-month/thumbgate`)

Both claims were live on the buyer-facing checkout page. Per the CLAUDE.md Honesty Protocol, removed and replaced with a verifiable claim: "5,200+ npm installs in the last 30 days (npm-stat verifiable)." Conservative round-down so the claim survives normal week-over-week noise.

Adds a regression test in `tests/public-static-assets.test.js` that asserts `/checkout/pro` never contains a `\d+ paying customers` pattern or `18,000+ installs` claim. The existing landing-page banned-claims test already exists for `public/*.html` files but didn't cover the server-rendered interstitial — this closes that gap.
