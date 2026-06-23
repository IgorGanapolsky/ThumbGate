# Payment Rails

Status: current
Updated: June 18, 2026

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

3. **Digital Merchant of Record**
   - Use Lemon Squeezy or Paddle for low-friction digital products and productized services where tax/VAT/compliance friction matters.
   - First product: `$97` Snapshot.
   - Configure with:
     - `THUMBGATE_MOR_PROVIDER`
     - `THUMBGATE_MOR_SNAPSHOT_CHECKOUT_URL`

## Daily Revenue Target

Target: `$300/day after tax`.

Operational planning number: one paid `$499` Diagnostic per day, or three `$1500` Sprints per week.

Pro remains useful as a self-serve trust path, but it is not the daily cash engine.

## Close Rule

Use the smallest paid path that matches buyer intent:

- Buyer has a concrete repeated workflow failure but scope is unclear: sell the `$499` Diagnostic.
- Buyer has an owner, a workflow, and urgency: sell the `$1500` Sprint.
- Buyer wants DIY tooling: send Pro.
- Buyer wants a small proof artifact first: send the `$97` Snapshot on the MoR rail.

Do not send a payment link cold. First confirm the failure mode, then offer Stripe or PayPal.
