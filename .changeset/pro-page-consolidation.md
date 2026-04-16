---
"thumbgate": patch
---

Consolidate `/pro` into `/` so Pro pricing never gets buried. The `/pro` sales page's hero-pricing layout ("One correction protects every agent on your team" + `$19/mo` monthly / `$149/yr` annual card with "Choose monthly / Choose annual" buttons) now renders inline on the homepage as the `#pro-pitch` strip, positioned directly below the free-install hero. `/pro` is now a permanent `301` redirect to `/#pro-pitch` so every README, plugin manifest, guide, and compare page link keeps working while passing link equity onto a single canonical landing page. `/pro` also removed from the sitemap entry list and from the JSON root-endpoint listing.
