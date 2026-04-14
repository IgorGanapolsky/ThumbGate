---
'thumbgate': patch
---

Fix Stripe webhook handler silently dropping all paid events when STRIPE_WEBHOOK_SECRET is not configured. When no webhook secret is set, skip stripe.webhooks.constructEvent (which always throws on empty secret) and parse the raw body directly — consistent with verifyWebhookSignature which is already lenient in this case.
