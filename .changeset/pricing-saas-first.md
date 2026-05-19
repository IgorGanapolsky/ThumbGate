---
"thumbgate": patch
---

`/pricing` rebuilt SaaS-first. The previous version led with the **$1,500 Workflow Hardening Sprint as the hero card** and demoted Pro/Team to `cta-secondary` styling — actively working against $19/mo self-serve conversion. A buyer who clicked "Pricing" in the nav landed on a consulting upsell.

New structure:

- Hero card (blue accent, "Most popular" badge): **Pro $19/mo** with primary CTA
- Flanking cards: **Free CLI** ($0) and **Team** ($49/seat)
- Consulting ($499 diagnostic / $1,500 sprint / $97 kit) collapsed into a `<details>` element below the grid

Self-serve checkout on every paid plan — the lede now reads "Three tiers. Pick the one that matches your scale. Self-serve checkout on every paid plan — no calls" instead of "Six paths to ThumbGate. Pick by what you need."

All 126 existing tests in `tests/api-server.test.js` still pass, including the `pricing page is the single source of truth` test that pins every tier name + price + CTA route. No revenue surface lost — the $499/$1,500/$97 paths still convert through the same mailto and Stripe Payment Link, just behind one click.
