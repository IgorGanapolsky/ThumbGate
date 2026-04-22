---
"thumbgate": patch
---

chore(brand): add 1280x640 GitHub social preview asset

Add `public/assets/brand/github-social-preview.png` at GitHub's
1280x640 spec, rendered from the same `thumbgate-icon-512.png`
that Stripe product thumbnails and the homepage og.png reference.
One canonical visual identity across marketing, checkout, and the
repo social preview.

Upload is a manual follow-up: Settings → General → Social preview.
GitHub's REST and GraphQL APIs do not expose an upload endpoint
for this field.
