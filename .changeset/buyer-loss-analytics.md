---
"thumbgate": patch
---

feat(analytics): deepen buyer loss telemetry and expose loss-analysis reporting

Capture first-party buyer behavior on the public landing pages so
ThumbGate can explain lost dollars with evidence instead of anecdotes.

- track section views, CTA impressions, page exits, and buyer email
  focus/abandon behavior on the homepage and Pro page
- aggregate behavioral telemetry into funnel dropoff, inferred causes,
  explicit objections, and revenue-opportunity reporting
- expose the synthesized loss-analysis view through
  `/v1/analytics/losses` and keep the OpenAPI surfaces aligned

This release does not claim more revenue by itself. It makes the live
buyer funnel diagnosable once deployed, which closes a major blind spot
in why ThumbGate is not yet converting consistently.
