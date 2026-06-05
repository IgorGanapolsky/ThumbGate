---
"thumbgate": patch
---

dashboard: make "Chat with your data" intent-aware (lists, time windows, real listings)

The local-first chat (#2501) routed every question to one of 5 canned per-topic
paragraphs — so "how many gates are activated today?" and "what mistakes were
blocked today?" both returned the same `Active gates: N. Blocked: M.` line.
Two underlying bugs:

1. Classifier order — `/block/` hijacked "what **mistakes were blocked** today" into
   the gates topic. Feedback-specific words ("mistake", "lesson", "feedback",
   "thumbs", "negative", "positive", "wins", "what went wrong") now run FIRST.
2. Section answers ignored intent — "what" got the same line as "how many", and
   "today" was never filtered. Now the section builder parses intent
   (`wantsList` vs count, `windowMs`: today/yesterday/this-week/this-month) and
   reads the feedback log directly to list real mistakes/wins for the requested
   window, instead of a canned all-time count.

Examples that now answer distinctly (all still local, no cloud):
- "how many mistakes today?" → `Feedback today: 3 (1 positive, 2 negative).`
- "what mistakes today?" → enumerated list of today's negative contexts.
- "show me wins this week" → enumerated list of positive entries from 7d.
- "what gates do we have?" → enumerated list of active gates with severity.
