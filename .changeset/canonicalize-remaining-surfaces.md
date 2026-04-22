---
"thumbgate": patch
---

fix(guides): canonicalize remaining compare/learn/llm-context to thumbgate.ai

Extends #1191's canonicalization sweep to the four surfaces it missed: `public/compare/mem0.html`, `public/compare/speclock.html`, `public/learn.html`, and `public/llm-context.md`. Same failure mode — legacy usethumbgate.com 301-redirects drop the path, so Google saw every `/compare/*` and `/learn` surface canonicalize to thumbgate.ai root, nuking their SEO.

Rewrites `og:url`, `link rel="canonical"`, JSON-LD `url` / `mainEntityOfPage` / `publisher.url`, the ItemList entries on `learn.html`, and the ten user-facing URLs in `llm-context.md`. No remaining `usethumbgate.com` strings under `public/`.
