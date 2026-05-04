---
"thumbgate": patch
---

Keep the legacy Stripe webhook route unauthenticated and signature-verified so older Stripe endpoints do not fail behind API-key auth. Add Stripe webhook audit and legacy-cleanup operator commands so dead `rlhf-feedback-loop` endpoints can be detected and disabled without rotating the active ThumbGate webhook secret.
