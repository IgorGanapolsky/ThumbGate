---
"thumbgate": patch
---

Add `scripts/external-customer-audit.js` — Stripe truth filtered by owner email.

Background: The unified revenue rollup (#2090) shipped raw Stripe totals: lifetime net, MRR, active subscription count. Those numbers count the operator's own purchases and subscriptions as if they were external customers. On a small operator-run product that's a meaningful confound — the difference between "1 active subscription" and "0 real customers" is whether the operator subscribed to test billing.

This script splits Stripe activity into `owner` vs `external` buckets and reports external-only counts as the headline number. Owner emails come from `THUMBGATE_OWNER_EMAILS` (comma-separated env var) with a default of `iganapolsky@gmail.com,igor.ganapolsky@gmail.com`. Wired into the Daily Revenue Loop workflow as a separate step alongside the unified rollup; outputs `reports/revenue/external-audit.{md,json}` plus a GitHub job-summary section.

The script's headline always reports three external-only numbers explicitly so they cannot be confused with owner-inclusive totals:
- Real, non-owner paying customers lifetime
- Real, non-owner net revenue lifetime
- Real, non-owner active subscriptions (+ MRR)

11 unit tests with an injected fake Stripe client cover: missing-secret gap, owner/external partitioning by email match, case-insensitivity, refunded-charge exclusion, billing_details fallback when customer object has no email, subscription MRR split, checkout completion split, and the headline markdown rendering.
