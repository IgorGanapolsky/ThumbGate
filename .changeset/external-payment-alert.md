---
"thumbgate": minor
---

Add real-time alert when an external (non-owner) customer pays.

**Problem.** The Stripe webhook handler logs paid sessions to the funnel ledger and revenue ledger, but the operator's only way to *learn* a real customer just paid is the next daily revenue loop run — up to 24h lag. For a business at $0 external lifetime revenue, that lag is unacceptable; the first paid customer deserves immediate notice.

**Fix.** New `emitExternalPaymentAlert` helper invoked from `handleWebhook` on `checkout.session.completed`. Three transport channels, all best-effort, all non-blocking:

1. **Slack** — POSTs to `THUMBGATE_SLACK_ALERT_WEBHOOK_URL` if configured.
2. **Resend email** — sends to `THUMBGATE_OPERATOR_ALERT_EMAIL` (fallback: `igor.ganapolsky@gmail.com`) if `RESEND_API_KEY` is set. Uses the existing mailer.
3. **Structured stderr log** — always fires as a Railway-log fallback so something lands even if no transport is configured.

Filters:
- Skips if `customerEmail` is missing.
- Skips if `customerEmail` matches `THUMBGATE_OWNER_EMAILS` (defaults to `iganapolsky@gmail.com,igor.ganapolsky@gmail.com`).
- Alert failure is swallowed — Stripe webhook ack must not depend on alert delivery (or Stripe retries the whole webhook and we double-provision).

On success, also writes an `external_payment_alert_sent` funnel event to the ledger with the channel list so daily audits can verify the alert path stayed healthy.

**Tests:** `tests/external-payment-alert.test.js` — 12 tests covering owner-email skip, Slack happy path, Resend happy path, no-transport log fallback, both transport-failure branches, malformed amount handling. All green.

Pre-existing 3-test failure in `tests/billing.test.js` is unrelated to this PR (verified by stashing changes and re-running on `origin/main`).
