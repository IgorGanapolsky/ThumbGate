---
'thumbgate': minor
---

New `thumbgate improve`: a daily self-improvement cycle. Each learned gate is checked against its own evidence. A block gate that would have blocked earlier safe actions, or that a person overrode in a third of 6+ fires, is proposed for warn; a warn gate that keeps firing, is never overridden and has strong trigger evidence is proposed for block. Gates change only with `--apply`; `THUMBGATE_SELF_TUNE=apply` applies tightening on its own but never loosens a gate. Hand-made gates are never changed, and the agent unlocking its own block does not count as an override. Each cycle appends a daily snapshot of the repeat-miss rate to `self-improvement-history.jsonl` so the trend is measurable. `session-start` starts the cycle in the background once a day and tells the agent what the last cycle found; `THUMBGATE_SELF_IMPROVE=0` turns that off.
