---
'thumbgate': minor
---

New `thumbgate improve`: a daily self-improvement cycle. Each learned gate is checked against its own evidence. A block gate that would have blocked earlier safe actions, or that is overridden in a third of its fires, is proposed for warn; a warn gate that keeps firing, is never overridden and has strong trigger evidence is proposed for block. Gates change only with `--apply` or `THUMBGATE_SELF_TUNE=apply`, and hand-made gates are never changed. Each cycle appends a daily snapshot of the repeat-miss rate to `self-improvement-history.jsonl` so the trend is measurable. `session-start` starts the cycle in the background once a day and tells the agent what the last cycle found; `THUMBGATE_SELF_IMPROVE=0` turns that off.
