---
"thumbgate": patch
---

Put the Pro pricing card INSIDE the homepage hero (between subtitle and dashboard preview) so `$19/mo` and `$149/yr` never get buried. The card shows both Monthly and Annual plans side-by-side with dedicated "Choose monthly / Choose annual" buttons and a "SAVE 35%" pill on annual — visible in pixel #1 on any viewport, not hidden behind scroll. `/pro` is now a permanent `301` redirect to `/#pro-pitch` (the id of the in-hero pricing card), so every README, plugin manifest, guide, and compare page link still works and passes link equity onto a single canonical landing page. `/pro` also removed from the sitemap entry list and from the JSON root-endpoint listing so search engines index `/` directly instead of chasing the redirect.
