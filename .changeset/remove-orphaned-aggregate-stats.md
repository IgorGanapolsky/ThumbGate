---
"thumbgate": patch
---

chore: remove orphaned scripts/feedback-aggregate-stats.js (+ its unit test). The statusline aggregation that ships is feedback-aggregate.js (computeAggregateFeedbackStats); the feedback-aggregate-stats module from PR #2545 was superseded by a parallel implementation that landed concurrently and is referenced nowhere. Dead code removed; bundle file count decreases (within existing ceilings).
