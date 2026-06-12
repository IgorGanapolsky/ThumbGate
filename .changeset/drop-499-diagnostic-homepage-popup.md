---
"thumbgate": patch
---

Remove the off-canon "$499 diagnostic" CTA from the site-wide revenue-assist popup. The sticky popup injected by `public/js/buyer-intent.js` was showing every anonymous visitor a "Pay $499 diagnostic" button (a one-time consulting SKU that is not part of the Free/Pro/Enterprise pricing and converted 0 times across 7 Stripe sessions). The popup now offers "Get Pro" plus a no-price "Send workflow first" intake link, matching the canonical pricing surface. The guard test now asserts the blind $499 diagnostic checkout CTA is absent.
