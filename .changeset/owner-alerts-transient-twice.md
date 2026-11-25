---
"thumbgate": patch
---

Owner alert emails: "Stripe could not be read", "telemetry could not be read" and a timed-out check are sent only when the next check still sees them. A single failed read is usually the cold start right after a deploy.
