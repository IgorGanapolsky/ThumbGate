---
"thumbgate": patch
---

Emit a `stripe_redirect_started` telemetry event in `src/api/server.js` immediately before the 302 to a real Stripe Checkout URL fires, carrying the same attribution payload (`installId`, `acquisitionId`, `visitorId`, `sessionId`, `traceId`, `stripeSessionId`, UTM + creator + community + offer/cta context) as `checkout_bootstrap`. Closes the funnel-observability gap between `checkout_bootstrap` (intent declared) and `/success` (payment completed): a buyer who reaches `checkout_bootstrap` but never produces `stripe_redirect_started` means the Stripe session create failed; one who reaches `stripe_redirect_started` but never `/success` means they bounced from the Stripe-hosted page. Both drops are now individually measurable.
