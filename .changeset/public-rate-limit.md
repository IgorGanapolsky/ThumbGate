---
"thumbgate": minor
---

Add per-IP rate-limiting + bot-pattern detection to six previously unprotected public HTTP endpoints. New `scripts/public-rate-limiter.js` implements an in-memory sliding-window limiter keyed on `(action × client IP)`, with X-Forwarded-For support for Railway-proxied requests and a memory cap (50k tracked keys, LRU-evict half on overflow). Wired into `/v1/telemetry/ping` (120/min), `/v1/intake/workflow-sprint` (5/hour + bot-pattern UA rejection — lead-pipeline spam vector), `/v1/billing/checkout` (20/min), `/v1/billing/session` (60/min), `/v1/intents/plan` (30/min), and `/v1/jobs/harness` (30/min). On limit, returns `429` + `Retry-After` header + `application/problem+json` body. Bypassable in dev/test via `THUMBGATE_NO_RATE_LIMIT=1`.
