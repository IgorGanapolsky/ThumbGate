---
"thumbgate": patch
---

fix(brand): regenerate public/og.png to match Stripe product icon

Social card previews (LinkedIn, Twitter, iMessage) were serving the
old legacy og.png while Stripe product pages used the canonical
`thumbgate-icon-512.png`. CEO flagged the mismatch after a LinkedIn
link preview showed the old wordmark banner instead of the current
brand mark.

Regenerate `public/og.png` at the standard 1200×630 social-card
aspect, centered on the brand dark `srgb(6,16,21)` background, using
the exact same `thumbgate-icon-512.png` that Stripe product images
point at. One canonical visual identity across the marketing surface
and the checkout surface.

No HTML changes — every page that referenced `/og.png` inherits the
new card automatically as social-platform caches refresh.
