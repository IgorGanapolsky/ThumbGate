---
"thumbgate": patch
---

feat(checkout): add email capture to checkout interstitial

The checkout interstitial now collects the visitor's email before
redirecting to Stripe Checkout. Previously the "Pay $19/mo" button was
a plain anchor — visitors who abandoned Stripe were lost with no way to
follow up. The form pre-fills the Stripe receipt email and fires a
telemetry beacon on submit so the email is captured even if the visitor
never completes payment.

Side-effect: the confirm=1 trigger moved from a crawlable `<a>` to a
`<form>` hidden input, which is inherently bot-safe (crawlers don't
submit forms) and eliminates the zombie-session vector more cleanly than
the previous `rel="nofollow"` approach.
