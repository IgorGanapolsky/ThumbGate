---
"thumbgate": patch
---

fix(billing): preserve marketplace attribution (e.g. utm_source=aiventyx) across external Stripe Payment Links via client_reference_id, so paid diagnostics are credited/reported instead of landing as source=unknown.
