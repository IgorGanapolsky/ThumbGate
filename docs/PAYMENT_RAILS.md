# Payment Rails

Status: current
Updated: July 16, 2026

Current software checkout: https://thumbgate.ai/checkout/pro. Start free or compare plans at https://thumbgate.ai/pricing. Managed services and kit offers are retired; do not create or distribute their payment links.

## Rails and historical provider configuration

1. **Stripe primary**
   - Use the first-party `/checkout/pro` path for Pro. Service checkout links are retired and must not be distributed.
   - Keep it first when the buyer is comfortable with card checkout.
   - Historical service catalog IDs (not current offers):
     - `$499` Workflow Hardening Diagnostic
     - `$1500` Setup Sprint

2. **PayPal fallback**
   - Retain for historical payment reconciliation, refunds, and reversals; not a current Pro checkout promise.
   - Do not distribute retired service checkout links.
   - Historical configuration keys (retain for evidence; no new checkout creation):
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
   - $97 Snapshot is retired. Historical Snapshot, configured with `THUMBGATE_MOR_SNAPSHOT_CHECKOUT_URL`.
   - Paddle or Lemon Squeezy would become a separate evidence provider only after the production configuration changes to one of them.

## Revenue Target And Proof Boundary

North-star target: `$1,000/hour`, represented as at least `$24,000` gross and current refund-adjusted charge-cohort net on every one of 30 consecutive local calendar days. That is a control threshold, not a forecast or a traction claim.

A provider-confirmed external Pro payment can establish a paid software transaction; it does not prove the north-star target. Historical service payments remain historical evidence, not a current acquisition plan.

Run `node scripts/revenue-target-control.js` for the fail-closed target verdict. Stripe is reconciled through its product-attributed API audit. PayPal is probed through its read-only API when configured. With all webhook settings present, the probe also authenticates the webhook registration and recent event history, then reconciles current capture/order, attribution, payer ownership, and refund state. That closes the reporting-delay gap for individual payment milestones but not for global arithmetic: the event lane does not enumerate every balance-affecting movement or prove subscriptions, so PayPal `revenue` remains unknown. Any distinct Merchant-of-Record processor and GitHub Marketplace enter through fresh provider-origin financial evidence documented in `docs/PROVIDER_REVENUE_EVIDENCE.md`. GitHub signed plan-change webhooks are retained and re-verifiable but do not replace its official Transactions CSV. The control validates and date-aligns every processor's USD gross, refund-adjusted net, and recurring slice before summing global revenue. Collection roles sharing one processor reuse its audit but never duplicate its dollars. A missing provider audit is `evidence_incomplete`, never zero revenue.

When an exact external ThumbGate payment appears in an authenticated audit, credit it to one sales lead with `npm run sales:reconcile-payment -- --lead <lead-id> --payment <paypal-capture-id>` for PayPal or add `--provider stripe --payment <stripe-charge-id>` for Stripe. Stripe reconciliation requires a live charge, external payer identity, paid Checkout Session, and ThumbGate-only line items to agree. The reconciler derives the refund-adjusted amount and cryptographic provider-evidence digest, rejects owner tests and unattributed payments, and prevents the same provider payment from being credited to multiple leads. Re-run it after provider-state changes: partial refunds lower booked revenue, while a verified full refund retires the paid lead and its booked revenue. Manual `sales:pipeline --stage paid` commands are intentionally disabled.

## Current buying path

Offer the free local CLI and current Pro plans when relevant to the buyer's needs. Pro is individual software, not managed implementation. Never treat a checkout link, inquiry, or draft as payment. Existing refund, attribution, and contract controls remain applicable to prior service orders.
