---
"thumbgate": patch
---

feat(seo): add /guides/chatgpt-ads-trust page and ChatGPT-ads FAQ

New SEO/GEO guide page threading the "pre-action gates" thesis
against the ChatGPT ads rollout (CPC bidding went live 2026-04-21
per Digiday; ads test started 2026-02-09 per TechCrunch).

Adds a JSON-LD `FAQPage` entry on the homepage answering *why does
the ChatGPT ads rollout matter to ThumbGate?*, and links the new
guide from the ChatGPT GPT section with a "Why ChatGPT ads need
gates" CTA.

Canonical URL pinned to `https://thumbgate.ai/guides/chatgpt-ads-trust`.
Pre-existing guide files still use the legacy `usethumbgate.com`
domain that 301-redirects to apex but drops the path — a separate
PR sweeps those.
