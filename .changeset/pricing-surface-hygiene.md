---
"thumbgate": patch
---

Pricing surface hygiene: remove dead `.price-card.team-card` CSS left over from the retired Team tier (no element references it; the Enterprise card uses `.enterprise-card`), and correct the stale `verify-pricing-surfaces` skill so it stops flagging the intentionally plausible-only checkout interstitial as a missing-analytics bug. Prices corrected to $0/$19/$149 and the real checkout health signal (302 → live Stripe) documented.
