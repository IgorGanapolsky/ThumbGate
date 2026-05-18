---
"thumbgate": minor
---

Closes the largest known funnel leak: **Stripe checkout pages render unbranded** because `account.business_profile.support_email`, `business_profile.product_description`, `settings.branding.logo`, and `settings.branding.icon` are all unset. PR #2100 verified this; the 100-lifetime-sessions-zero-completions pattern is consistent with "buyers reach the Stripe page, see a generic form, bail."

This was previously framed as "CEO must upload logo behind 2FA in the dashboard." It is not. The Stripe API exposes `account.update` and `file_uploads` for every missing field, and we hold `STRIPE_SECRET_KEY` in GH Actions secrets.

New surfaces:

- `scripts/stripe-branding-apply.js` — idempotent applier. Uploads `public/assets/brand/thumbgate-logo-1200x360.png` (logo) and `thumbgate-icon-512.png` (icon) via `files.create`, sets `business_profile.support_email` to `igor.ganapolsky@gmail.com`, and writes a 280-char `product_description` covering the product + pricing + refund policy. Re-running is a no-op. `--dry-run` plans without writing.
- `tests/stripe-branding-apply.test.js` — 7 tests against a mock Stripe SDK: empty-account plan, full-account no-op, dry-run plans without writing, human-readable rendering, disk-asset presence guard. All passing.
- `.github/workflows/stripe-branding-apply.yml` — `workflow_dispatch` with `mode: dry-run | apply` input. Probes current state → applies (or dry-runs) → re-probes. Concurrency-gated so two runs can't race.

Trigger: `gh workflow run stripe-branding-apply.yml -f mode=apply`. The first run after merge will write the four missing fields; subsequent runs are no-ops.
