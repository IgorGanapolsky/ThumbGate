---
"thumbgate": patch
---

Drop the hardcoded `Stripe-Version: 2025-09-30.acacia` header from `scripts/stripe-bootstrap-saas-catalog.js`. That version doesn't exist — Stripe rejected every request with HTTP 400 "Invalid Stripe API version" when the freshly-merged catalog bootstrap was first dispatched. Removing the explicit header so requests use the version pinned to the account, which is Stripe's documented correct default.
