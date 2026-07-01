---
"thumbgate": minor
---

Add opt-in autonomous fail-closed mode for approval gates. When `THUMBGATE_AUTONOMOUS=1`, an `approve` (human-in-the-loop) gate now fails CLOSED (deny) instead of deferring — because in an autonomous agent loop there is no human to sign off, and the actions that most need approval must not slip through unattended. Interactive and existing CI behavior is unchanged (opt-in only); applies to both the sync and async evaluation paths.
