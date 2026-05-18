---
"thumbgate": patch
---

Add `scripts/stripe-checkout-diagnostic.js` — answers the question raised by the external-customer-audit (PR #2095): WHY are 1000 lifetime checkout sessions producing 0 completed payments? The unified rollup reports the count but not the cause. This script pulls real Stripe API data for the cause.

Diagnostic surface:

1. Checkout session terminal-status breakdown (complete / expired / open / ...) plus payment_status distribution.
2. PaymentIntent `last_payment_error` rollup by code, type, and decline_code — distinguishes "buyer abandoned at email step" from "card declined" from "fraud rule fired."
3. Stripe Account health: `details_submitted`, `charges_enabled`, `payouts_enabled`, `requirements.disabled_reason`, `currently_due`, `past_due`, `pending_verification` arrays — the explicit fields blocking the account from normal processing.
4. Webhook endpoint inventory — flags the perception-risk case where checkouts complete on Stripe but our local ledger never sees them because no webhook is wired.
5. Recent-20-sessions table with cross-linked payment_intent error data so the operator can see the most recent failure modes in one view.

The markdown report includes a top-to-bottom diagnosis ranking: if `charges_enabled = false` it names that as the binding blocker before anything else; if zero payment intents have errors but many sessions exist, it names buyer abandonment as the diagnosis; if no webhooks are configured, it warns that "0 completions" may be undercounted.

Wired into the Daily Revenue Loop workflow alongside the unified rollup and the external-customer audit. Outputs both markdown and JSON to `reports/revenue/stripe-checkout-diagnostic.*` and a GitHub job-summary section.

9 unit tests with an injected fake Stripe client cover argument parsing, status / payment-status / error-code bucketing, the binding-blocker diagnosis path, the missing-webhook flag, recent-sessions table rendering with PI error codes, and the uniform-abandonment-without-errors diagnosis.
