---
"thumbgate": patch
---

Fix `/pricing` contradiction: the previously shipped page collapsed two distinct products ("Sprint Diagnostic" $499 and "Workflow Hardening Sprint" $1500) into a single "$499 Sprint" card. Buyer arriving from the homepage hero — which correctly distinguishes "$499 diagnostic, $1500 sprint, $3,997 governance setup" — would see different numbers on adjacent pages.

This rewrites `/pricing` as the single source of truth with all six paid paths visible:

- **$1,500** Workflow Hardening Sprint (full engagement, hero card)
- **$499** Sprint Diagnostic (proof-pack on-ramp)
- **$0** Free CLI
- **$19/mo · $149/yr** Pro
- **$49/seat/mo** Team (3-seat min, $147/mo)
- Micro-purchase row: $1 first failure rule, $19 quick read, $99 workflow teardown

Each card has a direct Stripe Payment Link (or `/go/*` tracked-link router) so a buyer landing from any inbound channel can complete checkout in one click without leaving the pricing page.
