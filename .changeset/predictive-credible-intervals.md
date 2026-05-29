---
"thumbgate": minor
---

Trustworthy revenue predictions: Bayesian credible intervals on the forecast.

`predictive-insights` previously emitted a point revenue forecast plus an ad-hoc
confidence heuristic (`log1p(sampleVolume)/log1p(40)`) — a number you couldn't
defend to a buyer. It now also emits a **Bayesian beta-binomial credible range**
(reusing the existing `scripts/conversion-rate-stats.js` posterior), so the forecast
is honest about uncertainty: with little funnel data the interval is wide; as N grows
it tightens toward the empirical rate.

`revenueForecast` gains (purely additive — the existing `predictedBookedRevenueCents`,
`confidence`, and `band` are unchanged, so dashboards/tests keep working):
- `range: { lowCents, expectedCents, highCents }` — booked-revenue at the 90% credible bounds.
- `rateCredibleInterval: { lower, expected, upper, level, basis, sampleSize }` — the
  posterior interval on the conversion rate and which funnel path it used
  (checkout→paid when checkout data exists, else visitor→paid).
- `statisticalConfidence` — `1 − intervalWidth`, a data-grounded confidence (narrower
  interval ⇒ higher confidence) distinct from the legacy heuristic.

New `revenueCredibleRange()` export. Degrades to a point estimate if the stats layer
errors — never throws into the forecast.
