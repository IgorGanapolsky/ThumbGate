---
"thumbgate": patch
---

Wire `/pricing` and `/case-studies` into the homepage top-nav so buyers landing on `thumbgate.ai` can reach the canonical pricing and proof surfaces in one click. Previously the "Pricing" link pointed to an in-page anchor (`#pricing`) — the dedicated `/pricing` page shipped in PR #2068 was reachable only via direct URL. `/case-studies` (PR #2067, currently Aiventyx-only) had no entry at all.
