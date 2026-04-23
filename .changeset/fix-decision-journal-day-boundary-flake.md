---
"thumbgate": patch
---

fix(decision-journal): pin clock in metrics test to remove day-boundary flake

`computeDecisionMetrics` now accepts an optional `options.now` and threads it into `initializeDaySeries`, so the rolling 14-day window is driven by an injectable clock rather than a fresh `new Date()` at aggregation time. The metrics test pins both the synthetic event base and the aggregator clock to the same reference timestamp, removing the race where CI crossing UTC midnight between event inserts and aggregation dropped events out of the window and failed `metrics.days.some((day) => day.evaluations > 0)`.
