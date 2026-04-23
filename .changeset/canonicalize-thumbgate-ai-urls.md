---
"thumbgate": patch
---

chore(canonical): thumbgate.ai across public pages and seo-gsd

Replaced stale `usethumbgate.com` references with the canonical `thumbgate.ai` domain in `public/learn.html`, `public/compare/mem0.html`, `public/compare/speclock.html`, `public/llm-context.md`, and `scripts/seo-gsd.js`. PR #1202 attempted this fix and was closed as duplicate of #1201, but #1201 only shipped Multica guide content — the URL replacements never landed. Every canonical link, `og:url`, schema.org `url`, and llm-context reference on these pages now points at the active domain.
