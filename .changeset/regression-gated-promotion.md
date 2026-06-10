---
"thumbgate": minor
---

Add regression-gated rule promotion (Self-Harness stage 3). Before a feedback-derived rule auto-activates as a hard `block`, `auto-promote-gates` now replays it against the audit trail's prior `allow` decisions; if the candidate would have blocked actions that were previously safe, it is quarantined to `warn` instead of `block`. Prevents a noisy 3× capture from hard-blocking an over-broad pattern that degrades known-good behavior.
