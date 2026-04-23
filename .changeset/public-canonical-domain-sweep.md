---
"thumbgate": patch
---

fix(public): canonicalize remaining public pages to thumbgate.ai

Replace `usethumbgate.com` with the canonical `thumbgate.ai` domain on
4 live public pages and the SEO helper constant that were missed by
the earlier guide-page sweep:

- `public/learn.html` — 8 guide ItemList URL entries
- `public/compare/mem0.html` — og:url, canonical, JSON-LD url /
  publisher.url / mainEntityOfPage
- `public/compare/speclock.html` — same fields as mem0
- `public/llm-context.md` — 8 marketing / guide link entries
- `scripts/seo-gsd.js` — `PRODUCT.homepageUrl` constant

No content or layout changes beyond the domain swap.
