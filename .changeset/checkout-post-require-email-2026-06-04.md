---
"thumbgate": patch
---

Fix /checkout/pro zombie sessions: require customer_email on POSTs. The earlier 401 fix unblocked POST traffic, but 3 of 4 fresh POST-flow sessions then reached Stripe with customer_email=null, creating un-recoverable zombie sessions (no email = no recovery campaign possible). Now POSTs without a customer_email query param fall through to the email-capture interstitial instead of auto-confirming. GET-with-confirm=1 behavior is unchanged.
