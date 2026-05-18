---
"thumbgate": patch
---

Funnel collapse on `/`. The workflow-sprint section (paid consulting: $97 kit, $499 diagnostic, $1500 sprint, $3997 setup, $297/mo retainer) is now wrapped in a `<details>` element collapsed by default. A cold visitor scrolling the landing page sees only the three coherent SaaS tiers (Free $0, Pro $19/mo, Team $49/seat/mo) instead of 11 competing price points.

Verified counts:
- Before: 11 distinct price points visible on default scroll
- After: 6 visible (`$0`, `$19`, `$19/mo`, `$49`, `$49/seat/mo`, `$147/mo`) — all SaaS tier prices, no mixed signals
- Consulting prices still present, one click away, no revenue surface lost

Addresses the 2026-05-18 strict assessment finding: "Eleven distinct price points on one page, with three separate purchase paths. A cold buyer cannot tell what to buy. This is the biggest single problem."

Zero changes to: server routes, Stripe links, telemetry hooks, anchor IDs (`#workflow-sprint-intake` still resolves), form submission flow. Pure HTML restructure.
