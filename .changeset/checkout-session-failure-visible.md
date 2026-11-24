---
"thumbgate": patch
---

When a buyer clicks "Pay $19/mo with Stripe" and Stripe cannot open a session, the checkout page now says so ("We couldn't open the Stripe payment page just now. Nothing was charged.") instead of silently reloading the same page, and the failure is counted as a `checkout_session_failed` event with its reason code.
