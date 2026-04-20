---
"thumbgate": patch
---

Mailer module now accepts `THUMBGATE_RESEND_API_KEY` as a fallback for the bare `RESEND_API_KEY`, matching the dual-read behavior already implemented in `scripts/billing.js`. Prevents a silent "skipped: no_api_key" regression if an operator sets only the prefixed variable name. Adds a positive unit test that sends with only the prefixed variant set.
