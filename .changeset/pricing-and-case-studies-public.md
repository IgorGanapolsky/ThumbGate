---
"thumbgate": minor
---

feat(public): add `/pricing` and `/case-studies` public pages.

- **`/pricing`** ships a single motion ($499 Workflow Hardening Sprint) to kill the prior 4-prices-across-2-motions funnel confusion. Pro/Team self-serve remain wired via `/checkout/pro` but no longer surfaced on the marketing pages.
- **`/case-studies`** ships 3 anonymized incident-class examples (force-push to main, .env commit, hallucinated npm install) drawn from prevention-rule telemetry — not fabricated customer quotes.
- Both pages routed through `servePublicMarketingPage` for UTM + landing-page-view telemetry. Sitemap updated.
- Companion audit in `docs/audit-stripe-payment-links-2026-05-14.md` flags 15 unique `buy.stripe.com/*` references in the repo for CEO-side consolidation in the Stripe dashboard.
