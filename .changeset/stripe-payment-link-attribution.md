---
"thumbgate": minor
---

Adds `scripts/stripe-payment-link-update.js` — the API-reachable lever for branded checkout pages. Stripe's `business_profile` + `branding` endpoints reject own-account writes (verified HTTP 403 on 2026-05-18), but `stripe.paymentLinks.update(id, params)` works on own-account links.

Targets the 3 customer-facing Payment Links documented in `docs/audits/payment-links-2026-05-18.md`:

- **$499 Sprint Diagnostic** (`buy.stripe.com/3cI7sLgH25v8dWh5e33sI0o`)
- **$1,500 Workflow Hardening Sprint** (`buy.stripe.com/8x25kDcqMaPs9G15e33sI0p`)
- **$97 OpenClaw Governance Kit** (`buy.stripe.com/bJe14naiE9Lo7xT49Z3sI12`)

For each, sets:

1. `custom_text.submit.message` — refund window + delivery promise (the urgency/trust copy buyers see on the checkout page)
2. `metadata` — `utm_source`, `cta_id`, `attribution_version`, `offer_kind` (so paid conversions can be attributed back to the campaign)
3. `automatic_tax.enabled = true` (so international buyers see correct totals)

10 unit tests against a mocked Stripe SDK cover: empty-link planning, full-link no-op, dry-run-no-writes, missing-slug error, page-traversal in `resolvePlinkId`, applyAll across all targets, and human-readable rendering. All passing.

Workflow `stripe-payment-link-update.yml` runs `--dry-run` on every push to the branch (so every commit shows what would change before merge) and only writes on explicit `workflow_dispatch` with `mode=apply`. Concurrency-gated so two runs can't race.

The other 97 active Payment Links on the account are deliberately left alone — they're noise from past iterations and changing them risks breaking embeds we don't know about.
