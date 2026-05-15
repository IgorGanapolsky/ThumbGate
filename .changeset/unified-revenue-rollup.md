---
"thumbgate": patch
---

Add `scripts/unified-revenue-rollup.js` — single script that joins Stripe live status (cash, MRR, lifetime revenue, checkout completion) with Plausible web analytics (visitors, pageviews, traffic sources) and projects the join onto the seven public revenue surfaces (`/`, `/pricing`, `/case-studies`, `/compare/heidi`, `/learn/spec-driven-development`, `/pro`, `/go/teams`).

Closes the audit gap surfaced on 2026-05-15 where the previous `revenue-status.js` only did a binary "is Plausible installed on the page" check and `analytics-latest.md` had gone two days stale. The new rollup is wired into the Daily Revenue Loop workflow (`.github/workflows/daily-revenue-loop.yml`) so a fresh `reports/revenue/unified-rollup-latest.md` is produced every run, and the markdown is also surfaced into the GitHub Actions job summary for at-a-glance review.

The script degrades gracefully when STRIPE_SECRET_KEY or PLAUSIBLE_API_KEY are missing — every absence becomes a labelled gap line, never a crash — so the same script is safe to run locally or in CI with partial secrets.

Diagnostics flag "funnel leak" patterns: traffic-on-/pricing-with-$0-balance and traffic-on-/case-studies-with-zero-checkouts. These are info-level signals, not warnings — they describe state, they do not claim revenue.

14 tests cover: surface list completeness, arg parsing, Plausible-page-to-surface join with zero-fill, diagnostics-firing-rules, markdown rendering (positive and degraded paths), and the gather/build wiring with a fake Plausible API + injected stripe-live-status module.
