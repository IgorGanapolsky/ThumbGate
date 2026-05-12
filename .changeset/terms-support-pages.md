---
"thumbgate": minor
---

Add `/terms` and `/support` public HTML pages (sibling to existing `/privacy`). Required so Stripe's Business → Public details form can be fully populated — "Terms of service URL" and "Customer support URL" both currently 401 on thumbgate.ai. The terms page covers payment, refunds (7-day Pro/Team window, refund-on-request for one-offs), acceptable use, warranty disclaimer, limitation of liability, and governing law. The support page surfaces email, GitHub Issues, the `/health` status path, refund instructions, and a security-disclosure note. Both pages cross-link to each other and `/privacy` to keep the legal triangle navigable.
