---
"thumbgate": patch
---

Observability: surface the checkout objection-reason breakdown (price_unclear / need_more_proof / need_team_plan / not_urgent) and a bot-excluded `qualifiedTraffic` view (human visitors/checkoutStarts after bot/internal/test exclusion) in the billing summary and the `revenue-status` report. This data was already captured but never reported — now we can see *why* buyers bail and read an honest, bot-filtered human funnel instead of the bot-inflated raw counts. Additive only: the existing `trafficMetrics` block is unchanged so no consumer breaks.
