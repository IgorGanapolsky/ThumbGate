---
"thumbgate": patch
---

Billing portal routes (`GET /portal`, `/billing`, `POST /v1/billing/portal`) now open a Stripe portal only with proof of ownership (API key or checkout session id). A bare email or customer id, and a caller-supplied return URL, are ignored.
