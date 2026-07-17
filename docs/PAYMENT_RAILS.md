# Payment Rails

Status: current
Updated: July 16, 2026

ThumbGate uses three payment rails so buyers can pay with the least practical friction.

## Rails

1. **Stripe primary**
   - Use for the live Pro checkout and the existing paid service checkout links.
   - Keep it first when the buyer is comfortable with card checkout.
   - Current verified service offers in code:
     - `$499` Workflow Hardening Diagnostic
     - `$1500` Workflow Hardening Sprint

2. **PayPal fallback**
   - Use when the buyer hesitates on card entry, asks for PayPal, or needs the fastest trust shortcut.
   - Close copy should say: `Pay by Stripe or PayPal, whichever is easier.`
   - Configure with:
     - `THUMBGATE_PAYPAL_DIAGNOSTIC_CHECKOUT_URL`
     - `THUMBGATE_PAYPAL_WORKFLOW_SPRINT_CHECKOUT_URL`
     - `THUMBGATE_PAYPAL_CLIENT_ID`
     - `THUMBGATE_PAYPAL_CLIENT_SECRET`
     - `THUMBGATE_PAYPAL_WEBHOOK_ID`
     - `THUMBGATE_PAYPAL_WEBHOOK_URL`
     - `THUMBGATE_PAYPAL_WEBHOOK_LEDGER_PATH`
   - Register `/v1/billing/paypal-webhook` on the same PayPal REST app for capture-completed, refunded, and reversed events. The endpoint remotely verifies PayPal's signature and acknowledges only after durable evidence storage.

3. **Digital Merchant of Record role**
   - The production configuration currently names `PayPal` as `THUMBGATE_MOR_PROVIDER`; it is not a separate processor from the PayPal fallback rail.
   - First product: `$97` Snapshot, configured with `THUMBGATE_MOR_SNAPSHOT_CHECKOUT_URL`.
   - Paddle or Lemon Squeezy would become a separate evidence provider only after the production configuration changes to one of them.

## Revenue Target And Proof Boundary

North-star target: `$1,000/hour`, represented as at least `$24,000` gross and current refund-adjusted charge-cohort net on every one of 30 consecutive local calendar days. That is a control threshold, not a forecast or a traction claim.

The first operating milestone remains one provider-confirmed external `$499` Diagnostic payment. One payment validates the close path; it does not prove the north-star target. Pro remains useful as a self-serve trust path, but it is not the daily cash engine.

Run `node scripts/revenue-target-control.js` for the fail-closed target verdict. Stripe is reconciled through its product-attributed API audit. PayPal is probed through its read-only API when configured. With all webhook settings present, the probe also authenticates the webhook registration and recent event history, then reconciles current capture/order, attribution, payer ownership, and refund state. That closes the reporting-delay gap for individual payment milestones but not for global arithmetic: the event lane does not enumerate every balance-affecting movement or prove subscriptions, so PayPal `revenue` remains unknown. Any distinct Merchant-of-Record processor and GitHub Marketplace enter through fresh provider-origin financial evidence documented in `docs/PROVIDER_REVENUE_EVIDENCE.md`. GitHub signed plan-change webhooks are retained and re-verifiable but do not replace its official Transactions CSV. The control validates and date-aligns every processor's USD gross, refund-adjusted net, and recurring slice before summing global revenue. Collection roles sharing one processor reuse its audit but never duplicate its dollars. A missing provider audit is `evidence_incomplete`, never zero revenue.

When an exact external ThumbGate payment appears in an authenticated audit, credit it to one sales lead with `npm run sales:reconcile-payment -- --lead <lead-id> --payment <paypal-capture-id>` for PayPal or add `--provider stripe --payment <stripe-charge-id>` for Stripe. Stripe reconciliation requires a live charge, external payer identity, paid Checkout Session, and ThumbGate-only line items to agree. The reconciler derives the refund-adjusted amount and cryptographic provider-evidence digest, rejects owner tests and unattributed payments, and prevents the same provider payment from being credited to multiple leads. Re-run it after provider-state changes: partial refunds lower booked revenue, while a verified full refund retires the paid lead and its booked revenue. Manual `sales:pipeline --stage paid` commands are intentionally disabled.

## Close Rule

Use the smallest paid path that matches buyer intent:

- Buyer has a concrete repeated workflow failure but scope is unclear: sell the `$499` Diagnostic.
- Buyer has an owner, a workflow, and urgency: sell the `$1500` Sprint.
- Buyer wants DIY tooling: send Pro.
- Buyer wants a small proof artifact first: send the `$97` Snapshot on the MoR rail.

Do not send a payment link cold. First confirm the failure mode, then offer Stripe or PayPal.
