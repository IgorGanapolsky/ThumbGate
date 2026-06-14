---
"thumbgate": patch
---

Complete the Team-tier retirement across the public marketing surface. The buyer-facing pricing page retired the Team tier in favor of Free/Pro/Enterprise (#2488, #2557), but 50 SEO/comparison/guide pages still advertised the dead `Team $49/seat/mo` tier, and several tests still asserted it as "current." This sweeps every public page from `Team $49/seat/mo` to the live `Enterprise` third tier (keeping `Pro $19/mo or $149/yr`), and updates the page-copy assertions in `seo-guides.test.js` and `competitive-positioning-marketing.test.js` to match.

Scope note: this is the buyer-facing copy reconciliation only. The dormant Team SKU still wired into the Stripe catalog, the `planId=team` checkout path, and the 24 active `$49` Stripe prices (0 customers ever) are intentionally left untouched here — that billing-infra decommission is a separate change.
