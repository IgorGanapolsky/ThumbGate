---
"thumbgate": minor
---

Adds the `/broker-audit` public landing page route serving `src/api/static/broker-audit.html` — the wedge surface for the real-estate broker cold-outreach campaign.

The route serves a free-audit-primary, $49-fast-lane-secondary funnel that matches the offer in the in-flight 65-broker cold email batch. Trust signals (refund language, no-call-required, response-time SLA) ride above the fold; the $49 Stripe link routes to a verified payment_link on the Saas Growth Dispatch account with `after_completion` → `/success`.

Cleanly scoped: only `src/api/server.js` (+19 lines for the route handler) and the new static file. No other routes touched. Plays alongside existing `/checkout/pro` and `/pricing` paths without modification.
