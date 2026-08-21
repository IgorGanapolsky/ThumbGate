---
"thumbgate": patch
---

Add a cross-surface claim consistency test that mechanically pins product name, category claim, npm package, repo URL, app origin, pinned version, and commercial terms across README, llm-context.md, llms.txt, the landing page, and the pricing page — deriving every expected value from package.json and the Stripe revenue catalog instead of duplicating them. Also names the managed workflow gate offer in the served `.well-known/llms.txt`, and removes the unreachable `public/llms.txt` duplicate that the `/llms.txt` route shadowed.
