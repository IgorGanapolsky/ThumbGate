---
"thumbgate": patch
---

fix(tests): anchor decision-journal metric test timestamps to now-3d

The `computeDecisionMetrics` test used hard-coded `2026-04-09T...` timestamps while the metric aggregates over a rolling 14-day window anchored at wall-clock time. Two weeks later the fixed timestamps fell off the window and the `metrics.days.some((day) => day.evaluations > 0)` assertion failed, blocking every open PR. Switched to a `now - 3 days` base with preserved hour-offset latencies so the test is date-agnostic.
