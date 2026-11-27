---
"thumbgate": patch
---

The spend guard no longer hard-blocks read-only web research. WebFetch, WebSearch and MCP fetch/search tools that read documentation, forum or blog pages mentioning billing, checkout, plans or upgrades are allowed. Live payment hosts (Stripe Checkout, Payment Links, billing portal, Apollo app, Paddle, PayPal) and commerce paths such as `/checkout` or `/billing` on product sites stay denied, and a fetch that sends a body or a write method still gets the full rules.
