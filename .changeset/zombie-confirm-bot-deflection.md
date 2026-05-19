---
"thumbgate": patch
---

Stop bots from burning `cs_live_*` Stripe sessions by following the `confirm=1` link inside the checkout interstitial.

2026-05-19 audit found 2,210 of 2,251 lifetime Stripe Checkout sessions (98%) were zombies — expired, no email, no payment attempt. Root cause: the interstitial HTML renders a `<a href="/checkout/pro?confirm=1...">` link for the "Pay $19/mo with Stripe →" CTA, and bot crawlers discovered/followed it, bypassing the bot-deflection check on raw GETs and triggering Stripe session creation per crawl.

Two-layer fix:

1. **Server-side:** bot UA + `confirm=1` (alone) no longer treated as confirmed checkout — deflects back to the interstitial. POST requests still proceed (form submissions). A `customer_email` query param also bypasses the bot check, because no real crawler fabricates customer emails on discovered URLs.

2. **HTML-side:** the confirm link in the interstitial now carries `rel="nofollow noindex"` so well-behaved crawlers (Google, Bing, ClaudeBot, GPTBot) stop following it in the first place.

Expected outcome: 30d Stripe session count should drop from ~250 zombies/mo to humans-only volume.
