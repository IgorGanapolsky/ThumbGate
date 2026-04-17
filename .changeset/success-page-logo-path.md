---
"thumbgate": patch
---

Fix broken logo on /success (Context Gateway Activated) page. After PR #932 moved brand assets to `/assets/brand/`, the HTML templates from PR #931 still referenced the legacy `/brand/thumbgate-mark.svg` path — which Railway's route guard now returns 401 for. Migrates all 15 customer-facing surfaces (landing, dashboard, lessons, pro, learn hub + 5 learn articles, post-checkout success page, SEO-GSD generator) to the correct `/assets/brand/thumbgate-mark.svg` path (serves 200). Also migrates favicon link from the 401ing `/favicon.svg` to the 200ing `/thumbgate-icon.png`, and `og:image` from `/brand/thumbgate-og.svg` to `/og.png`, with correct MIME types. Updates brand-assets test suite to pin the new paths so this can't regress.
