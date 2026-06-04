---
"thumbgate": patch
---

site: landing-page plan clarity + retire Team from the primary buyer surfaces (Free / Pro / Enterprise)

The landing page made buyers infer plan differences from long cards, still sold a
retired Team tier, and the README contradicted the enforced free-tier limits.

- **Landing page comparison matrix** — adds an at-a-glance Free / Pro / Enterprise
  table to `public/index.html` so buyers see plan differences without parsing cards.
- **Free / Pro / Enterprise** — retires the Team tier across the primary buyer
  surfaces (landing page, `/pricing`, guide, compare, pro, README, COMMERCIAL_TRUTH,
  product-hunt kit, docs landing) and the CLI/dashboard upgrade messaging
  (`commercial-offer`, `rate-limiter`, `pro-features`, `org-dashboard`). "Regulated"
  folds into the Enterprise contact-sales tier (audit trail, VPC/SSO, regulatory
  templates + shared lesson DB / org dashboard / shared enforcement).
- **Consistent, truthful free-tier limits** — README/cards/matrix now all state what
  `scripts/rate-limiter.js` actually enforces (5 captures/day, 25 total, 3 active
  rules), replacing stale "unlimited captures / 5 rules" copy.
- **Drift guards** — `check-congruence` now requires Enterprise + forbids the retired
  `$49/seat` anchor on buyer surfaces (regex tightened to catch markup-split prices);
  a new `public-landing` test pins the matrix + enforced free-tier numbers.

Deliberately scoped: the dormant Team Stripe price ID / seat-checkout plumbing
(`billing.js`, `metered-billing.js`) and a long tail of deep content pages
(`public/guides/*`, `public/learn/*`, `llm-context.md`, `compare/agentix-labs.html`)
still reference Team and are a separate follow-up — they are invisible to the primary
pricing flow and do not break CI.
