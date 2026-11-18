---
"thumbgate": patch
---

Funnel counts stop including bots: /success counts a visit only when its session_id is paid in Stripe, and billing-summary checkout starts count only Stripe sessions that got past raw (an email entered or a payment attempted).
