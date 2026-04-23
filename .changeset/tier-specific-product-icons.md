---
"thumbgate": patch
---

feat(billing): differentiate ThumbGate Free/Pro/Team with tier-specific product icons

CEO flagged that the Stripe product catalog renders "ThumbGate Team" and "ThumbGate Pro" with the same icon. Root cause: `scripts/billing.js` always shipped `thumbgate-icon-512.png` in `product_data.images` regardless of plan, so Stripe had no way to draw them differently.

- Added `public/assets/brand/thumbgate-mark-{pro,team}.svg` and rendered 512×512 PNGs. Pro adds a gold PRO ribbon to the upper-right; Team adds a violet pill with three stacked member dots. The core TG gate glyph is unchanged so cross-surface brand continuity holds.
- Introduced `resolveTierIconUrl(planId, appOrigin)` in `scripts/billing.js`; `buildCheckoutProductData` now accepts `planId` and picks the right icon per plan.
- Added `scripts/stripe-sync-product-images.js` (idempotent) to patch the `images` field on existing dashboard Products so already-created Team/Pro rows stop rendering as twins. Must run post-deploy once the PNGs are live on the public shell.
- Regression test in `tests/billing.test.js` pins three distinct URLs for free/pro/team checkout payloads; `tests/public-static-assets.test.js` confirms the public shell serves the two new PNGs.

Follow-up (not in this PR): the core TG monogram still has no thumb silhouette despite the product name. Separate design session to consider integrating the thumb gesture into the primary mark.
