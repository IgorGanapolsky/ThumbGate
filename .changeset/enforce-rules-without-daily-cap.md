---
"thumbgate": patch
---

A rule that denies now denies every time. The free tier used to turn a deny into a warning once a user passed a daily block quota (`FREE_TIER_DAILY_BLOCKS`, `applyDailyBlockCap`); that quota and the per-day block counter are removed. Free-tier limits now apply only to how many auto-promoted rules load and how many feedback captures a free user can make. The warn-by-default posture (`THUMBGATE_STRICT_ENFORCEMENT`) is unchanged.
