---
"thumbgate": patch
---

Stop crawler / link-preview traffic from inflating the checkout-start metric and creating zombie Stripe sessions. Stripe API shows 50 sessions created in last 24h, **0 paid, 0 email captured** — a signature of bot/preview fetches not human buyers. Two fixes: (a) add `rel="nofollow noopener noreferrer" target="_blank"` to all `<a href="https://buy.stripe.com/...">` anchors on landing surfaces (7 anchors updated across `public/index.html`, `public/guide.html`, `public/pro.html`), so search engines + social-preview fetchers stop following them and creating sessions; (b) add `Disallow: /checkout/` and `Disallow: /v1/billing/` to `robots.txt` for both default `User-agent: *` and the explicit AI-crawler stanzas. Real humans still reach checkout via JS-driven button clicks, which crawlers don't execute.
