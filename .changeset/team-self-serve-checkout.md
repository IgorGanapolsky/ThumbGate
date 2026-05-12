---
"thumbgate": minor
---

Open the Team-tier self-serve checkout path. The Stripe price ID (`STRIPE_PRICE_ID_TEAM_MONTHLY`), the server-side checkout session creator, and the `plan_id=team&seat_count=N` URL routing were already fully wired — the landing page just hadn't exposed a button. The Team pricing card now leads with **"Start 3-seat Team — $147/mo"** (a direct `/checkout/pro` link that creates a Stripe subscription session via the existing `createCheckoutSession` flow), with the Workflow Hardening Sprint intake demoted to a secondary qualification path. Engineering Managers can now swipe a card without booking a sales call.
