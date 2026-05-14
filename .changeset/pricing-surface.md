---
"thumbgate": minor
---

Add `/pricing` as the canonical buyer-facing pricing surface. Resolves the "pricing schizophrenia" the audit flagged: `sales/pricing.json` said $49/$299, `docs/COMMERCIAL_TRUTH.md` said $19/$149, and no buyer-facing page existed to reconcile. The page lays out four tiers in priority order — Sprint ($499 one-time, sales-led, hero CTA), Free CLI ($0, npm install), Pro ($19/mo or $149/yr, self-serve recurring after the 5-rule free wall), Team ($49/seat/mo after qualification). Each CTA routes to canonical `/go/*` paths so the funnel collapses to a single source of truth. Sprint CTA is a mailto: with a structured intake template so partner-led conversations have an actionable handoff.
