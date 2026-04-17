---
"thumbgate": patch
---

Welcome email v2: consolidate the trial welcome email through the `scripts/mailer/resend-mailer.js` module and upgrade the template. Adds personalized greeting (first name from Stripe `customer_details.name`), explicit trial-end date (from Stripe `subscription.trial_end`), branded header mark, founder signoff, quickstart P.S., `reply_to: hello@thumbgate.app`, and a CAN-SPAM footer (business name, physical address, unsubscribe mailto) on every send. `handleWebhook` now threads `customerName` and `trialEndAt` through to the mailer. The legacy inline transport remains as a fallback and its `no_api_key` skip reason is normalized to `missing_resend_api_key` so dashboards and support tooling see a stable vocabulary regardless of which transport produced the skip.
