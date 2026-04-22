---
"thumbgate": patch
---

fix(guides): canonicalize guide pages to thumbgate.ai

Rewrite `og:url`, `<link rel="canonical">`, and JSON-LD
`url` / `mainEntityOfPage` / `publisher.url` on the remaining 11 guide
pages from `https://usethumbgate.com` to `https://thumbgate.ai`.

The legacy `usethumbgate.com` host 301-redirects to `thumbgate.ai` but
drops the path, so Google saw every `/guides/<slug>` canonicalize to
the bare apex and collapsed the topical signal across all guides into
a single URL. Matches the chatgpt-ads-trust.html fix shipped in #1188.
