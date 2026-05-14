---
"thumbgate": minor
---

feat(revenue): surface $19 Quick Read offer at the moment of pain — after 3+ thumbs-downs in 24h, capture-feedback prints the existing Stripe Payment Link to stderr. Suppressed for Pro users, rate-limited to once per 24h, opt-out via `THUMBGATE_NO_UPSELL=1`.
